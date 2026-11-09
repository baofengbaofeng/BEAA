import Foundation
import CloudKit
import CryptoKit

/// Only sanitized summaries and explicit command envelopes enter this database.
@MainActor final class CloudService {
    let container: CKContainer
    let zoneID = CKRecordZone.ID(zoneName: "BEAAFamily", ownerName: CKCurrentUserDefaultName)
    init(containerIdentifier: String) { container = CKContainer(identifier: containerIdentifier) }
    var database: CKDatabase { container.privateCloudDatabase }
    func prepare(parentAllowed: () -> Bool = { true }) async throws {
        guard try await container.accountStatus() == .available else { throw RemoteError.accountUnavailable }
        guard parentAllowed() else { throw RemoteError.unauthorized }
        _ = try await database.save(CKRecordZone(zoneID: zoneID))
    }
    /// A zone subscription is a wake-up hint; foreground polling remains the delivery fallback.
    func ensureCommandSubscription(deviceID: String) async throws {
        let subscription = CKRecordZoneSubscription(zoneID: zoneID, subscriptionID: "BEAA.commands.\(deviceID)")
        let notification = CKSubscription.NotificationInfo()
        notification.shouldSendContentAvailable = true
        subscription.notificationInfo = notification
        _ = try await database.save(subscription)
    }
    func root(parentAllowed: () -> Bool = { true }) async throws -> CKRecord {
        let id = CKRecord.ID(recordName: "family", zoneID: zoneID)
        do { return try await database.record(for: id) }
        catch let error as CKError where error.code == .unknownItem {
            guard parentAllowed() else { throw RemoteError.unauthorized }
            return try await database.save(CKRecord(recordType: "Family", recordID: id))
        }
    }
    func share(parentAllowed: () -> Bool = { true }) async throws -> CKShare {
        let root = try await root(parentAllowed: parentAllowed)
        if let reference = root.share {
            guard let existing = try await database.record(for: reference.recordID) as? CKShare else { throw RemoteError.invalid }; return existing
        }
        let share = CKShare(rootRecord: root)
        share.publicPermission = .none
        share[CKShare.SystemFieldKey.title] = "BEAA Family" as CKRecordValue
        guard parentAllowed() else { throw RemoteError.unauthorized }
        let result = try await database.modifyRecords(saving: [root, share], deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: true)
        for value in result.saveResults.values { _ = try value.get() }
        return share
    }
    func accept(url: URL, parentAllowed: () -> Bool) async throws {
        let metadata = try await container.shareMetadata(for: url)
        guard parentAllowed() else { throw RemoteError.unauthorized }
        _ = try await container.accept(metadata)
    }
    func participants() async throws -> [CloudParticipant] {
        // Polling never creates a share. Only the authenticated invitation action may do so.
        let root: CKRecord
        do { root = try await database.record(for: CKRecord.ID(recordName: "family", zoneID: zoneID)) }
        catch let error as CKError where error.code == .unknownItem { return [] }
        guard let reference = root.share else { return [] }
        guard let share = try await database.record(for: reference.recordID) as? CKShare else { throw RemoteError.invalid }
        return share.participants.compactMap { participant in
            guard let id = participant.userIdentity.userRecordID?.recordName else { return nil }
            return CloudParticipant(id: id, name: participant.userIdentity.nameComponents.map { PersonNameComponentsFormatter.localizedString(from: $0, style: .short) } ?? id,
                eligible: participant.role == .privateUser && participant.acceptanceStatus == .accepted && participant.permission == .readWrite)
        }
    }
    func savePayload(_ data: Data, name: String, type: String, revision: Int) async throws {
        let id = CKRecord.ID(recordName: name, zoneID: zoneID)
        let record: CKRecord
        do { record = try await database.record(for: id)
            guard (record["revision"] as? Int ?? -1) <= revision else { throw RemoteError.conflict }
        } catch let error as CKError where error.code == .unknownItem { record = CKRecord(recordType: type, recordID: id) }
        record["payload"] = data as CKRecordValue
        record["revision"] = revision as CKRecordValue
        record.parent = CKRecord.Reference(recordID: try await root().recordID, action: .none)
        let result = try await database.modifyRecords(saving: [record], deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: true)
        for value in result.saveResults.values { _ = try value.get() }
    }
    func publish(_ summary: CloudSummary) async throws {
        try await savePayload(JSONEncoder().encode(summary), name: "summary-\(summary.deviceID)", type: "Summary", revision: summary.revision)
    }
    func records(type: String, database source: CKDatabase? = nil, zone: CKRecordZone.ID? = nil) async throws -> [CKRecord] {
        let db = source ?? database
        var records: [CKRecord] = []
        var page = try await db.records(matching: CKQuery(recordType: type, predicate: NSPredicate(value: true)), inZoneWith: zone ?? zoneID)
        while true {
            for (_, result) in page.matchResults { records.append(try result.get()) }
            guard let cursor = page.queryCursor else { break }
            page = try await db.records(continuingMatchFrom: cursor)
        }
        return records
    }
    func sharedZones() async throws -> [CKRecordZone] { try await container.sharedCloudDatabase.allRecordZones() }
    func summaries(zone: CKRecordZone.ID) async throws -> [CloudSummary] {
        var result: [CloudSummary] = []
        for record in try await records(type: "Summary", database: container.sharedCloudDatabase, zone: zone) {
            // Both immutable creator and last writer must be the child/share owner. A writable
            // invitee can otherwise modify an owner-created record while retaining its creator.
            guard record.creatorUserRecordID?.recordName == zone.ownerName,
                  record.lastModifiedUserRecordID?.recordName == zone.ownerName else { continue }
            guard let data = record["payload"] as? Data, data.count <= 64_000 else { continue }
            guard let summary = try? JSONDecoder().decode(CloudSummary.self, from: data) else { continue }
            guard (try? CloudSummaryGate.validate(summary, creator: record.creatorUserRecordID?.recordName,
                modifier: record.lastModifiedUserRecordID?.recordName, owner: zone.ownerName,
                recordName: record.recordID.recordName)) != nil else { continue }
            result.append(summary)
        }
        return result
    }
    func send(_ command: RemoteCommand, zone: CKRecordZone.ID, parentAllowed: () -> Bool) async throws {
        let record = CKRecord(recordType: "Command", recordID: CKRecord.ID(recordName: command.id.uuidString, zoneID: zone))
        record["payload"] = try JSONEncoder().encode(command) as CKRecordValue
        record.parent = CKRecord.Reference(recordID: CKRecord.ID(recordName: "family", zoneID: zone), action: .none)
        guard parentAllowed() else { throw RemoteError.unauthorized }
        _ = try await container.sharedCloudDatabase.save(record)
    }
    func uploadBank(_ data: Data, revision: Int, parentAllowed: () -> Bool) async throws {
        _ = try QuestionBank.decode(data)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try data.write(to: url, options: .atomic)
        defer { try? FileManager.default.removeItem(at: url) }
        let id = CKRecord.ID(recordName: "question-bank", zoneID: zoneID)
        let record: CKRecord
        do { record = try await database.record(for: id)
            guard revision > (record["revision"] as? Int ?? -1) else { throw RemoteError.conflict }
        } catch let error as CKError where error.code == .unknownItem { record = CKRecord(recordType: "QuestionBank", recordID: id) }
        record["asset"] = CKAsset(fileURL: url)
        record["sha256"] = Self.digest(data) as CKRecordValue
        record["revision"] = revision as CKRecordValue
        record.parent = CKRecord.Reference(recordID: try await root(parentAllowed: parentAllowed).recordID, action: .none)
        guard parentAllowed() else { throw RemoteError.unauthorized }
        let results = try await database.modifyRecords(saving: [record], deleting: [], savePolicy: .ifServerRecordUnchanged, atomically: true)
        for result in results.saveResults.values { _ = try result.get() }
    }
    func downloadBank(zone: CKRecordZone.ID, minimumRevision: Int) async throws -> (Data, Int) {
        let record = try await container.sharedCloudDatabase.record(for: CKRecord.ID(recordName: "question-bank", zoneID: zone))
        guard record.creatorUserRecordID?.recordName == zone.ownerName,
              record.lastModifiedUserRecordID?.recordName == zone.ownerName else { throw RemoteError.unauthorized }
        guard let revision = record["revision"] as? Int, revision >= minimumRevision,
              let asset = record["asset"] as? CKAsset, let url = asset.fileURL,
              let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 2_000_000 else { throw RemoteError.invalid }
        let data = try Data(contentsOf: url)
        guard data.count <= 2_000_000, Self.digest(data) == record["sha256"] as? String else { throw RemoteError.invalid }
        _ = try QuestionBank.decode(data)
        return (data, revision)
    }
    static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}

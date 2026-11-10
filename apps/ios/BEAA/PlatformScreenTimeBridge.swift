import Foundation
import Darwin

struct PlatformMonitorConfiguration: Codable {
    var generation: String
    var day: String
    var selection: Data
    var currentCycleSeconds: Int
    var baselineSeconds: Int
    var cycleMinutes: Int
    var dailyMinutes: Int
    var active: Bool
    var blocked: Bool
    var hostBlocked: Bool
    var thresholdBlocked: Bool
    var quietWindows: [PlatformQuietWindow]
    var allowanceExpiresAt: Date?
}
struct PlatformBridgeState: Codable {
    var configuration: PlatformMonitorConfiguration?
    var receipts: [PlatformUsageReceipt] = []
}
enum PlatformServiceError: LocalizedError {
    case configuration, authorization, selection, storage, staleGeneration, quietUnsupported, deadlineCapacity
    var errorDescription: String? {
        switch self {
        case .deadlineCapacity: return "短时授权到期保护需要额外监控名额，请家长将每周禁用时段总数减少到十八个以内"
        case .quietUnsupported: return "设备禁用时段需至少十五分钟，且每周时段总数不能超过十九个；请家长调整设置"
        case .configuration: return "设备管控需家长完成配置"
        case .authorization: return "未获得或已撤销系统授权"
        case .selection: return "请选择应用、类别或网站"
        case .storage: return "共享存储不可用"
        case .staleGeneration: return "监控代次已失效"
        }
    }
}
/// The same file is compiled into the app and the DeviceActivity extension.
struct PlatformScreenTimeBridge {
    static var configured: Bool { Bundle.main.object(forInfoDictionaryKey: "BEAAEnableScreenTime") as? Bool == true }
    let directory: URL
    init() throws {
        guard Self.configured,
              let group = Bundle.main.object(forInfoDictionaryKey: "BEAAAppGroupIdentifier") as? String,
              !group.isEmpty, !group.contains("$("),
              let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw PlatformServiceError.configuration
        }
        directory = url
    }
    func transaction<T>(_ body: (inout PlatformBridgeState) throws -> T) throws -> T {
        let lockURL = directory.appendingPathComponent("platform.lock")
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw PlatformServiceError.storage }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw PlatformServiceError.storage }
        defer { flock(descriptor, LOCK_UN) }
        let url = directory.appendingPathComponent("platform.json")
        var state = PlatformBridgeState()
        if FileManager.default.fileExists(atPath: url.path) {
            state = try JSONDecoder().decode(PlatformBridgeState.self, from: Data(contentsOf: url))
        }
        let result = try body(&state)
        try JSONEncoder().encode(state).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return result
    }
    func append(generation: String, event: String, seconds: Int, now: Date = Date()) throws -> Bool {
        try transaction { state in
            guard let configuration = state.configuration, configuration.active,
                  configuration.generation == generation else { throw PlatformServiceError.staleGeneration }
            let receipt = PlatformUsageReceipt(generation: generation, day: configuration.day, event: event,
                                               lowerBoundSeconds: seconds == 0 ? 0 : configuration.baselineSeconds + seconds, receivedAt: now)
            guard !state.receipts.contains(where: { $0.id == receipt.id }) else { return false }
            guard state.receipts.count < 4096 else { throw PlatformServiceError.storage }
            state.receipts.append(receipt)
            return true
        }
    }
}

import Foundation
import DeviceActivity
import FamilyControls
import ManagedSettings
import UserNotifications

final class BEAADeviceActivityMonitor: DeviceActivityMonitor {
    private let settings = ManagedSettingsStore(named: .init("BEAA.selected"))
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        if activity.rawValue.hasPrefix("BEAA.Q.") { quietBoundary(activity); return }
        if activity.rawValue.hasPrefix("BEAA.D.") { return }
        // No automatic entitlement grant or daily budget reset in the extension.
        receipt(activity: activity, event: "interval.start", seconds: 0, block: false)
    }
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        if activity.rawValue.hasPrefix("BEAA.Q.") { quietBoundary(activity); return }
        if activity.rawValue.hasPrefix("BEAA.D.") {
            do {
                let config = try PlatformScreenTimeBridge().transaction { $0.configuration }
                guard let config, let expiry = config.allowanceExpiresAt,
                      activity.rawValue == "BEAA.D.\(config.generation).\(Int(expiry.timeIntervalSince1970))" else { return }
                receipt(activity: .init("BEAA." + config.generation),
                    event: "allowance.end.\(Int(expiry.timeIntervalSince1970))", seconds: 0, block: true)
            } catch { NSLog("BEAA allowance deadline failed: %@", String(describing: error)) }
            return
        }
        // Remain conservative at day boundary until the app commits an acknowledged rollover.
        receipt(activity: activity, event: "interval.end", seconds: 0, block: true)
    }
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        do {
            let bridge = try PlatformScreenTimeBridge()
            let config = try bridge.transaction { $0.configuration }
            guard let config, let entry = PlatformUsagePlanner.events(periodMinutes: config.cycleMinutes,
                dailyMinutes: config.dailyMinutes, baselineSeconds: config.baselineSeconds, currentCycleSeconds: config.currentCycleSeconds).first(where: { $0.name == event.rawValue }) else { return }
            receipt(activity: activity, event: event.rawValue, seconds: entry.seconds, block: entry.blocks)
        } catch { NSLog("BEAA threshold bridge failed: %@", String(describing: error)) }
    }
    private func quietBoundary(_ activity: DeviceActivityName) {
        do {
            let bridge = try PlatformScreenTimeBridge()
            try bridge.transaction { state in
                guard var config = state.configuration, config.active else { throw PlatformServiceError.staleGeneration }
                let prefix = "BEAA.Q." + config.generation + "."
                guard activity.rawValue.hasPrefix(prefix),
                      let index = Int(activity.rawValue.dropFirst(prefix.count)),
                      try PlatformUsagePlanner.quietSchedules(config.quietWindows).indices.contains(index) else {
                    throw PlatformServiceError.staleGeneration
                }
                let effective = config.hostBlocked || config.thresholdBlocked || PlatformUsagePlanner.quietBlocks(config.quietWindows) || (config.allowanceExpiresAt.map { Date() >= $0 } ?? false)
                let selected = try JSONDecoder().decode(FamilyActivitySelection.self, from: config.selection)
                settings.shield.applications = effective ? selected.applicationTokens : nil
                settings.shield.applicationCategories = effective ? .specific(selected.categoryTokens) : nil
                settings.shield.webDomains = effective ? selected.webDomainTokens : nil
                settings.shield.webDomainCategories = effective ? .specific(selected.categoryTokens) : nil
                config.blocked = effective
                state.configuration = config
            }
        } catch { NSLog("BEAA quiet boundary failed: %@", String(describing: error)) }
    }
    private func receipt(activity: DeviceActivityName, event: String, seconds: Int, block: Bool) {
        do {
            let bridge = try PlatformScreenTimeBridge()
            guard activity.rawValue.hasPrefix("BEAA.") else { return }
            let generation = String(activity.rawValue.dropFirst(5))
            let fresh = try bridge.transaction { state -> Bool in
                guard var config = state.configuration, config.active,
                      config.generation == generation else { throw PlatformServiceError.staleGeneration }
                let item = PlatformUsageReceipt(generation: generation, day: config.day, event: event,
                    lowerBoundSeconds: seconds == 0 ? 0 : config.baselineSeconds + seconds, receivedAt: Date())
                guard !state.receipts.contains(where: { $0.id == item.id }) else { return false }
                guard state.receipts.count < 4096 else { throw PlatformServiceError.storage }
                let expired = config.allowanceExpiresAt.map { Date() >= $0 } ?? false
                let mustBlock = block || expired || config.hostBlocked || config.thresholdBlocked || PlatformUsagePlanner.quietBlocks(config.quietWindows)
                if mustBlock {
                    let selection = try JSONDecoder().decode(FamilyActivitySelection.self, from: config.selection)
                    config.blocked = true
                    if block || expired { config.thresholdBlocked = true }
                    settings.shield.applications = selection.applicationTokens
                    settings.shield.applicationCategories = .specific(selection.categoryTokens)
                    settings.shield.webDomains = selection.webDomainTokens
                    settings.shield.webDomainCategories = .specific(selection.categoryTokens)
                    state.configuration = config
                }
                state.receipts.append(item)
                return true
            }
            guard fresh else { return }
            if event.hasPrefix("cycle.") || event.hasPrefix("daily.") {
                let center = UNUserNotificationCenter.current()
                center.getNotificationSettings { settings in
                    guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return }
                    let content = UNMutableNotificationContent()
                    content.title = PlatformUsagePlanner.notificationText("所选范围用时提醒")
                    content.body = PlatformUsagePlanner.notificationText(block ? "所选范围已达阈值，已请求限制" : "所选范围接近用时上限")
                    center.add(UNNotificationRequest(identifier: "BEAA.system.\(generation).\(event)", content: content, trigger: nil)) { _ in }
                }
            }
        } catch { NSLog("BEAA monitor callback failed: %@", String(describing: error)) }
    }
}

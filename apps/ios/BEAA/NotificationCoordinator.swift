import Foundation
import UserNotifications
import Combine

@MainActor
final class NotificationCoordinator: ObservableObject {
    @Published private(set) var status = "通知尚未授权"
    private let center = UNUserNotificationCenter.current()
    enum Source: String { case foregroundPractice, selectedScope }
    private var observed = Set(UserDefaults.standard.stringArray(forKey: "BEAA.notificationIDs") ?? [])
    private var allowed = false
    func refreshStatus() async {
        let settings = await center.notificationSettings()
        allowed = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
        status = allowed ? "通知已获授权" : "通知未获授权"
    }
    func requestAuthorization() async {
        do { _ = try await center.requestAuthorization(options: [.alert, .sound, .badge]) }
        catch { status = "通知申请未完成" }
        await refreshStatus()
    }
    /// Driven by committed foreground learning accounting, never extrapolated to device use.
    func observe(state: LearningState, active: Bool, source: Source = .foregroundPractice) {
        guard active else { pauseAndClear(); return }
        guard allowed else { return }
        let day = PlatformUsagePlanner.day(state.dayStarted)
        let cycle = "\(day).\(state.roundID.uuidString)"
        for (kind, used, limit, identity) in [
            ("cycle", state.cycleSeconds, state.policy.periodMinutes * 60, cycle),
            ("daily", state.dailySeconds, state.policy.dailyMinutes * 60, day)
        ] {
            let milestones = [(0, "已到上限"), (60, "一分钟"), (300, "五分钟")]
            if let (remaining, label) = milestones.first(where: { used >= max(0, limit - $0.0) && limit > $0.0 }) {
                let id = "BEAA.\(source.rawValue).\(identity).\(kind).\(remaining)"
                guard observed.insert(id).inserted else { continue }
                UserDefaults.standard.set(Array(observed).sorted().suffix(4096).map { $0 }, forKey: "BEAA.notificationIDs")
                let content = UNMutableNotificationContent()
                content.title = PlatformUsagePlanner.notificationText(source == .foregroundPractice ? "当前练习用时提醒" : "所选范围用时提醒")
                content.body = PlatformUsagePlanner.notificationText(source == .foregroundPractice ? "当前练习计时：\(label)" : "所选范围阈值：\(label)")
                content.sound = .default
                center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { _ in }
            }
        }
    }
    func pauseAndClear() {
        let ids = Array(observed)
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
        // Keep dedup identity across lifecycle transitions; resuming cannot resend old thresholds.
    }
}

import UIKit
import CloudKit

/// Share acceptance remains a parent-confirmed action; callbacks only queue an invitation.
@MainActor final class AppDelegate: NSObject, UIApplicationDelegate {
    private weak var model: AppModel?
    private var pendingInvitations: [URL] = []
    func bind(_ model: AppModel) {
        self.model = model
        for url in pendingInvitations { model.receiveShare(url) }
        pendingInvitations = []
    }
    func application(_ application: UIApplication, userDidAcceptCloudKitShareWith cloudKitShareMetadata: CKShare.Metadata) {
        guard let url = cloudKitShareMetadata.share.url else { return }
        if let model { model.receiveShare(url) }
        else { pendingInvitations = Array((pendingInvitations + [url]).suffix(5)) }
    }
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        guard let model, model.cloud.enabled, CKNotification(fromRemoteNotificationDictionary: userInfo) != nil else { completionHandler(.noData); return }
        Task { @MainActor in
            await model.refreshCloud()
            completionHandler(.noData)
        }
    }
}

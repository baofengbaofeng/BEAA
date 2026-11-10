import Foundation
import ManagedSettings
import ManagedSettingsUI
import UIKit

final class BEAAShieldConfiguration: ShieldConfigurationDataSource {
    private func text(_ chinese: String) -> String {
        chinese + "\n" + (chinese.applyingTransform(.mandarinToLatin, reverse: false) ?? chinese)
    }
    private var appearance: ShieldConfiguration {
        ShieldConfiguration(backgroundBlurStyle: .systemMaterial, backgroundColor: .systemBackground,
            icon: UIImage(systemName: "lock.fill"),
            title: .init(text: text("请先完成学习与休息"), color: .label),
            subtitle: .init(text: text("请关闭此页面，手动返回学习应用查看安排。需要帮助时请联系家长。"), color: .secondaryLabel),
            primaryButtonLabel: .init(text: text("关闭"), color: .white),
            primaryButtonBackgroundColor: .systemBlue)
    }
    override func configuration(shielding application: Application) -> ShieldConfiguration { appearance }
    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration { appearance }
    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration { appearance }
    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration { appearance }
}

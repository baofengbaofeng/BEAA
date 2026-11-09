import SwiftUI

struct CapabilityView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 24) {
            PinyinText("设备能力与计时来源", large: true)
            LearningCard {
                PinyinText("当前计时", large: true)
                PinyinText(model.usageSourceDescription)
                PinyinText("已选择系统模式不等于监控正在运行；权限、配置或共享存储异常时停止新资格，等待家长处理。")
                PlatformCapabilityStatus(controller: model.screenTime)
            }
            LearningCard {
                PinyinText("系统限制与休息", large: true)
                PinyinText("系统模式仅覆盖家长选择的应用、类别和网站；阈值回执是用时下界，不能提供整台设备的精确使用时间。限制请求被系统接受，也不能代替真机效果验证。")
                PinyinText("练习模式离开应用后暂停。系统模式可恢复同次开机内、相同保护配置下的连续休息时间；保护请求不能证明没有使用其他设备或眼睛离屏。")
                PinyinText("每日额度不自动重置，新的自然日需要本机家长确认。更改日期不增加额度，答题和应急授权不能突破每日上限。")
            }
            LearningCard {
                PinyinText("通知与家庭协作", large: true)
                ServiceCapabilityStatus(notifications: model.notifications, cloud: model.cloud)
                PinyinText("通知可能被系统延迟。云端协作默认关闭，需要配置账户、容器与能力；远程指令需本机确认分享参与者，不上传凭据或原始资格账本。后台推送仅触发检查，不保证实时送达。")
            }
            LearningCard {
                PinyinText("学习与记录", large: true)
                PinyinText(QuestionBank.bundledNotice)
                PinyinText("本机加密保存学习状态；导出报告仅含汇总，不含题目、原始答案或家长凭据。保留最近一百轮记录，统计不代表完整学习生涯。")
            }
        }.padding(24).frame(maxWidth: 800).frame(maxWidth: .infinity) }.background(Color(.systemGroupedBackground))
    }
}
private struct PlatformCapabilityStatus: View {
    @ObservedObject var controller: ScreenTimeController
    var body: some View {
        PinyinText(controller.status)
        PinyinText(controller.monitoringRequested ? (controller.monitoringActive && controller.isAuthorized ? "监控请求运行中；实际限制效果待真机确认。" : "已选择系统模式，但当前监控或授权未就绪。") : "系统模式未开启，当前为应用内练习。")
    }
}
private struct ServiceCapabilityStatus: View {
    @ObservedObject var notifications: NotificationCoordinator
    @ObservedObject var cloud: CloudCoordinator
    var body: some View { PinyinText(notifications.status); PinyinText(cloud.status) }
}

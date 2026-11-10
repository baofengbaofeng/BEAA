import SwiftUI

struct SecuritySettingsView: View {
    let vault: ParentVault
    let parentAllowed: () -> Bool
    var onCredentialsChanged: () -> Void = {}
    @State private var old = ""
    @State private var new = ""
    @State private var confirmation = ""
    @State private var recovery = ""
    @State private var issuedCode = ""
    @State private var message = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PinyinText("家长安全", large: true)
                PinyinText("密码和恢复码只保存在本机。恢复密码不会重置学习额度；恢复码使用一次后失效。请离线妥善保存。")
                PinyinText("当前六位密码")
                SecureField("", text: $old).keyboardType(.numberPad).textContentType(.password)
                PinyinText("新六位密码")
                SecureField("", text: $new).keyboardType(.numberPad).textContentType(.newPassword)
                PinyinText("再次输入新密码")
                SecureField("", text: $confirmation).keyboardType(.numberPad)
                Button { run { guard parentAllowed() else { throw VaultError.locked }; try vault.changePIN(old: old, new: new, confirmation: confirmation); onCredentialsChanged() } } label: { PinyinText("修改家长密码") }
                Button { run { guard parentAllowed() else { throw VaultError.locked }; issuedCode = try vault.makeRecoveryCode(pin: old) } } label: { PinyinText("生成新的单次恢复码") }
                if !issuedCode.isEmpty {
                    PinyinText("仅本次显示，请离线保存后关闭")
                    Text(issuedCode).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                    Button { issuedCode = "" } label: { PinyinText("已保存，隐藏恢复码") }
                }
                PinyinText("忘记密码：输入恢复码和新密码")
                SecureField("", text: $recovery).textInputAutocapitalization(.characters).autocorrectionDisabled()
                Button { run { try vault.recoverPIN(code: recovery, new: new, confirmation: confirmation); onCredentialsChanged() } } label: { PinyinText("用恢复码重设密码") }
                PinyinText("生物识别默认关闭。设备中登记的指纹或面容不等于家长身份；仅适合家长独占生物识别的设备。更改登记后需要密码重新开启。")
                Button { run { guard parentAllowed() else { throw VaultError.locked }; try vault.setBiometrics(enabled: true, pin: old) } } label: { PinyinText("开启本机生物识别验证") }
                Button { run { guard parentAllowed() else { throw VaultError.locked }; try vault.setBiometrics(enabled: false, pin: old) } } label: { PinyinText("关闭本机生物识别验证") }
                if !message.isEmpty { PinyinText(message) }
            }.padding()
        }.onDisappear { old = ""; new = ""; confirmation = ""; recovery = ""; issuedCode = "" }
    }
    private func run(_ action: () throws -> Void) {
        do { try action(); message = "操作完成"; old = ""; new = ""; confirmation = ""; recovery = "" }
        catch { message = "操作未完成，请检查密码、恢复码或稍后重试" }
    }
}

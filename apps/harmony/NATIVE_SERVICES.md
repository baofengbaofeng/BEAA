# 原生宿主与提醒服务源码

本目录提供纯TypeScript服务及API10参考适配源码，**尚未经过目标SDK编译、签名、安装或真机验收**。Node实际执行的是纯服务，经TypeScript检查不等于ArkTS/HAP构建。当前输入均为模拟用时，不包含真实跨应用采样或系统限制。

## 摘要保存

`NativeSummary.ts`严格接受现有学习摘要：schemaVersion1、simulated=true、deviceControlValidated=false、合法日期/计数及最多200条记录；额外字段（包括PIN/hash/salt）、矛盾累计和超过64000码元的文本拒绝。纯服务执行UTF8短写循环、同步及关闭，关闭失败也不返回saved。取消/忙碌/失败返回有限状态，不带目标URI或底层错误。

网页调用`beaaNative.exportLearningSummary(requestId,text)`，同步accepted仅表示接受处理；随机32位十六进制请求ID对应`window.onNativeExportCompleted(id,status)`。匹配saved才显示保存确认；120秒未确认显示结果未知，迟到/错误ID不能更新当前请求。没有宿主时保留浏览器下载，有宿主但操作失败时不静默回退。`NativeSummaryFilePort.ets`使用文件选择器让持有人决定位置，网页不提供文件路径。

## 演示提醒

原生按钮“启用演示提醒”由持有人显式请求通知权限，确认isNotificationEnabled后才允许发布。桥只有三个方法：exportLearningSummary、updateReminderState、pauseReminders；不提供凭据、规则修改、任意代码、路径或限制/解除其他应用的方法。

网页成功保存后递增stateRevision，完成休息/家长重置后推进cycleSequence；来源仅取已提交快照。损坏、写失败或缺已确认来源请求暂停；不伪造AVAILABLE。所有输入强制simulated=true，scope固定web-preview。后台/来源异常清空宿主缓存，暂停已发通知；恢复等待新页面快照，不靠旧通知恢复使用资格。

`ReminderDelivery.ts`共用于Node实际测试与候选原生宿主：当前有效5分/1分/到期提示，稳定且不复用的整数ID；CAS、30秒租约、独立发布/取消退避（1秒起至60秒）、前后来源/权限复核、持久重试及取消。普通发布报错也可能已生效，保留为sending/待确认，来源变化必须取消，不能当从未发布直接丢弃。每次CAS竞争重读后重新检查退避。submitted仅为API确认提交，不代表已显示/已读，不保证恰好送达一次。

原生通知使用固定演示文案、固定label、isAlertOnce、最多每10秒一次提交及60秒自动清理配置；这些平台行为仍须实测。取消失败保留待办；超时后的迟到结果再清理，不能误删新工作者仍有效的同ID通知。来源回放停止新发布并保留队列；时钟回拨暂停新发布并清理。已取消历史最多保留256条，未确认在途项不淘汰，总量上限512，满时明确拒绝，不复用旧ID。空闲轮询不反复改写数据库。

## 存储边界

`NativeReminderStore.ets`申请S3/encrypt:true的私有RDB，仅存提醒队列，使用固定文件名、版本/格式标记、事务CAS和完整JSON校验。加密不支持或格式不符时拒绝，不删除数据、不降级为明文；目标SDK对初始内部元数据/事务/加密的实际行为未验证。原生队列格式与Node参考库使用不同application_id，不能直接互换数据库。

去重和ID连续性依赖现有队列保留；不防同UID/root篡改或旧数据库回放，不自动用旧备份覆盖现库。

这不是家长凭据或使用资格账本，不能替代原生安全认证、guardian原子后端、可信用时/日期/休息采样或设备权限。网页localStorage/PBKDF2 PIN仍是演示保护。后台计时/清理只在应用能执行时尽力处理，未实现可靠常驻后台服务；实际通知自动清理/重启行为属于真机用例。

## API来源（只作接口核对）

参考官方interface_sdk-js仓库OpenHarmony-v4.0-Release提交`a3a8fe22fbb0764d6bb2483a184966251e77b77e`：

- [文件选择器](https://github.com/openharmony/interface_sdk-js/blob/a3a8fe22fbb0764d6bb2483a184966251e77b77e/api/%40ohos.file.picker.d.ts)：API9 DocumentViewPicker无context构造参数，DocumentSaveOptions.newFileNames。
- [文件IO](https://github.com/openharmony/interface_sdk-js/blob/a3a8fe22fbb0764d6bb2483a184966251e77b77e/api/%40ohos.file.fs.d.ts)：open/write/fsync/close。
- [通知](https://github.com/openharmony/interface_sdk-js/blob/a3a8fe22fbb0764d6bb2483a184966251e77b77e/api/%40ohos.notificationManager.d.ts)：isNotificationEnabled、API10 requestEnableNotification(context)、publish/cancel。
- [通知载荷](https://github.com/openharmony/interface_sdk-js/blob/a3a8fe22fbb0764d6bb2483a184966251e77b77e/api/notification/notificationRequest.d.ts)：id/label/isAlertOnce/autoDeletedTime；[内容](https://github.com/openharmony/interface_sdk-js/blob/a3a8fe22fbb0764d6bb2483a184966251e77b77e/api/notification/notificationContent.d.ts)。
- [RDB](https://github.com/openharmony/interface_sdk-js/blob/a3a8fe22fbb0764d6bb2483a184966251e77b77e/api/%40ohos.data.relationalStore.d.ts)：S3/encrypt、事务、querySql/executeSql、rollBack。
- [Web桥](https://github.com/openharmony/interface_sdk-js/blob/a3a8fe22fbb0764d6bb2483a184966251e77b77e/api/%40internal/component/ets/web.d.ts)：javaScriptProxy的object/name/methodList/controller。

这不证明目标商业系统版本、系统能力、授权资格或运行行为。仍须在匹配工具链中实际构建，再按[真机手册](../../docs/DEVICE_POC.md)N11验证。

## Native guardian candidate (2026-11-09)

`Index.ets` now hosts a native parent panel outside ArkWeb. It opens a separate encrypted S3 RDB (`beaa-native-guardian.db`), enrolls a 6–12 digit native PIN, authenticates, and rotates credentials. Native and preview PINs are independent; no credential/auth/write route is exposed to JavaScript. UI hides clear PIN after each operation; authorization stays in service memory for 120 seconds and is discarded on panel toggle/page hide/disposal or credential rotation. Five failures cause a persistent five minute cooldown. Wall-clock rollback refuses operations until the stored last accepted clock is reached; reboot does not clear failures. It does **not** resist privileged device clock advancement or filesystem rollback.

`GuardianCore.ts` supplies strict validation and revision CAS across the credential, rate limit and conservative reservation ledger. The RDB adapter checks format and uses a single transaction with affected-row confirmation; malformed data and database/encryption failures never reset data or downgrade to plaintext. This is source implementation, not target SDK compilation evidence. The native crypto candidate uses public API10 `cryptoFramework` CSPRNG and PBKDF2-HMAC-SHA256 (100,000 iterations, 32 byte salt/output). API10 lacks public `createKdf`; compatibility, latency and lifecycle cancellation need real-device testing. PIN data protection relies on encrypted private RDB and OS protection; this is not a hardware attestation/anti-rollback claim. Never log PIN/hash/salt/token.

Reservations can only increase up to 120 minutes over this candidate ledger's lifetime. They cannot grant/release OS access, cannot reset by a caller-supplied day, cannot count real usage, and are intentionally not presented as usable device time in the panel. Trusted day rollover, usage accounting, rest provenance and challenge integration remain blocked on an authorized source. This ledger must not be sold as full guardian policy implementation.

`NativeDeviceCapabilities.ts` returns explicit unavailable source/enforcement and privileged-approval provenance; sampling/restriction/release throw. There are no production mocks. Official source inspected on 2026-11-09: [OpenHarmony 4/API10 usageStatistics](https://github.com/openharmony/interface_sdk-js/blob/OpenHarmony-4.0-Release/api/@ohos.resourceschedule.usageStatistics.d.ts) marks statistics APIs `@systemapi` and requires `ohos.permission.BUNDLE_ACTIVE_INFO`; legacy bundleState is also system API. Adding a manifest permission or invoking a runtime permission prompt cannot grant system-app entitlement. No public ordinary third-party API for reliable cross-app suspension/release was established for this target. Commercial HarmonyOS 4 compatibility and any enterprise/system approval require the actual SDK, authorized identity and device evidence. No privileged import or unapproved permission is added.

API references: [cryptoFramework](https://github.com/openharmony/interface_sdk-js/blob/OpenHarmony-4.0-Release/api/@ohos.security.cryptoFramework.d.ts), [relationalStore](https://github.com/openharmony/interface_sdk-js/blob/OpenHarmony-4.0-Release/api/@ohos.data.relationalStore.d.ts). `tests/harmony-guardian.test.mjs` compiles actual portable service TypeScript and exercises security/CAS/capability gates with **test-only** storage/crypto substitutes. It does not execute `.ets`, OS encryption, notifications, permissions, device actions, SDK builds or device installation. Preflight remains blocked: missing SDK, ohpm, hvigor, hdc.

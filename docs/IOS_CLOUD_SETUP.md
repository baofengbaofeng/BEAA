# iOS 云端协作配置与接手验收

本轮交付 CloudKit/UIKit 源码与 XCTest 源文件，未进行 Apple SDK 编译、签名、真机分享、推送或云数据库测试；也未访问真实云账户。以下步骤由持有开发者账号与测试设备的接手者执行。数据库 schema 与权限必须在自己的容器中部署，源码存在不代表云端能力已开通。

## 构建与显式开启

默认 `BEAA` / Practice 使用 `Configuration/Practice-Info.plist`，`BEAAEnableCloud=false`。运行时先检查此构建开关，再检查 `BEAACloudContainerIdentifier`，未配置时不会构造云服务或申请云账户访问。仅添加容器字符串不会绕过开关。

使用 `BEAAConnected` / Connected，复制 `apps/ios/Configuration/User.xcconfig.example` 为同目录被忽略的 `User.xcconfig`，填写自己拥有的 Team、App Group、`BEAA_CLOUD_CONTAINER` 与对应 App ID。示例 `iCloud.org.beaa.learning` 不是已为接手者开通的资源。当前 Connected 同时含系统管控扩展能力；其签名与 entitlement 另见平台配置说明。

在开发者门户及 Xcode Signing & Capabilities 为应用 App ID 开启 iCloud/CloudKit 与 Push Notifications，使 provisioning profile 包含 `Configuration/Connected.entitlements` 所需容器、CloudKit 服务与 APNs 权限。`BEAA_ICLOUD_ENVIRONMENT`、`BEAA_PUSH_ENVIRONMENT` 必须与实际 development/production profile 匹配。Connected Info 已配置 `CKSharingSupported` 与 `remote-notification` 后台模式。不要通过替换 entitlement 字符串冒充服务已授权。

构建开关开启仍不自动联网。家长先完成本机认证，再在“家庭分享与远程家长”点击开启。账户可用且私有区准备成功后才保存本设备的显式 opt-in。重启可恢复此已授权选择，不要求每次重新输入 PIN；恢复仍检查构建配置及账户。关闭会清除 opt-in、停用协调器，并阻止仍在等待网络结果的启动动作重新开启它。本机确认的参与者名单不会因关闭自动删除，可逐项撤销。

## 容器、记录与 schema

儿童设备的账户拥有私有数据库自定义区 `BEAAFamily`，根记录 `Family/family`。同一账户的多台设备共用该区，但使用各自持久化 UUID 与独立控制修订。摘要、题库、指令、回执通过 `parent` 关联根记录，形成记录层级分享。家长设备通过共享数据库访问接受的区；代码不使用公共数据库，也不将云端快照恢复为本机资格状态。

在开发容器准备以下类型和字段，确认代码中的区域限定 `CKQuery` 可以查询这些类型，并配置 Dashboard 所需的查询索引。先用自己的测试设备创建和检查开发 schema，再明确将 schema 部署到 Production；生产环境不会自动创建开发字段。

| 类型 | 记录名称 | 自定义字段 |
| --- | --- | --- |
| `Family` | `family` | 无；系统 share/parent 元数据由 CloudKit 管理 |
| `Summary` | `summary-<device UUID>` | `payload`: Bytes；`revision`: Int64 |
| `Command` | `<command UUID>` | `payload`: Bytes |
| `Receipt` | `receipt-<target device UUID>-<command UUID>` | `payload`: Bytes；`revision`: Int64 |
| `QuestionBank` | `question-bank` | `asset`: Asset；`sha256`: String；`revision`: Int64 |

`payload` 为 JSON 编码数据。摘要仅含设备 UUID、控制修订、时间、答题/答对数量、当日使用秒数及可选策略配置，不含 PIN、恢复码或原始资格账本。控制修订用于策略、题库导入、跨日及授权等控制变化；每秒用时写入不会令所有远程请求立即过时。查询实现逐页处理游标；首次使用前确保所有记录类型已在对应环境部署。

修改已有记录采用 `ifServerRecordUnchanged`，有冲突时重新获取最新数据后重试，不盲目覆盖服务端版本。题库上传要求严格增加题库修订；同一修订再次上传会拒绝。

## 分享与参与者确认

儿童设备的本机家长创建分享并打开系统分享面板，仅允许私有、可写邀请，公开权限关闭。受邀家长需接受邀请。应用接收到 URL 或系统分享回调后先排队，由本机家长认证并确认后接受；网络等待后会再次检查当前认证。

儿童设备刷新参与者后，本机家长必须逐项确认身份。只有服务器返回“已接受、readWrite、privateUser”的参与者才可确认。接受分享不自动获得远程指令信任。撤销本机信任后，即使对方仍持有云端写权限，其新指令也不能通过本机门禁。需要彻底结束分享访问时，还应在系统分享面板移除参与者或停止分享。

摘要及题库同时要求服务器记录的 creator 和 last-modified user 都是共享区 owner。摘要记录名必须与载荷设备 UUID 一致，修订、数量、秒数及策略都经过校验；其他参与者创建或修改的摘要不能作为策略编辑来源。远程策略编辑从选中设备的已验证摘要初始化，保留未编辑的禁用时段、学科与题目设置；摘要缺少策略时不提供默认策略发送。

## 指令、回执与交付时机

只允许 `setPolicy`、`emergencyGrant`、`endGrant`、`requestSummary`。每条指令包含事件 UUID、目标设备 UUID、声明发送者、期望控制修订、签发与到期时间；签发不能在未来，期限最长五分钟。儿童设备核对 CloudKit creator 与最后修改者一致、声明发送者与服务器身份一致，并核对该身份仍是已接受可写参与者且已被本机家长确认。随后检查目标、修订、有效期与负载边界，拒绝重放。其他设备的指令在访问本机处理日志或生成回执前直接跳过。

处理 UUID 在执行前记录；本机应用回调必须同步完成可信存储提交后才返回。应用回调继续执行本机每日上限、禁用时段、挑战、休息与授权条件，不因云端请求重置配额。中断后可能安全拒绝已消费的请求，不能把它重新当作新授权执行。成功/拒绝回执先本机保存，再上传；失败上传在后续检查重试，成功回执不会在每次轮询重写。家长通过获取共享摘要同时取得 owner 创建且最后写入的回执；“已发送”不等于“已应用”。

开启/恢复时保存私有区的 `CKRecordZoneSubscription`，通知设置 `shouldSendContentAvailable=true`。应用注册远程通知，AppDelegate 将后台通知交给协调器；前台约每 30 秒检查也是交付路径。通知仅为唤醒提示，系统不保证后台及时运行，离线超过五分钟的指令应拒绝过期。订阅失败会显示前台检查仍可用的状态，不声称推送成功。区域订阅覆盖该区变更，因此回执采用持久化上传标记避免反馈循环。

## 题库云资产

上传需当前本机家长认证，网络等待后、写入前再次检查。JSON 限制为 2,000,000 字节，必须通过 `QuestionBank.decode`，保存 CKAsset 与 SHA-256。下载首先验证 owner 创建及最后修改身份，然后检查修订、文件大小、SHA-256 与题库结构；导入前再次检查实时家长认证，并由 AppModel 提交本机导入。每个共享区记录已导入修订，旧修订不能覆盖新导入。这里的 SHA-256 用于完整性校验；身份依据来自 CloudKit 服务器元数据。可写参与者仍可能删除或破坏共享内容，遇到此类错误应由 owner 检查分享并重新发布。

## 接手者验收

1. Apple 工具链编译 Practice、Connected 与 XCTest；确认 Practice 关闭路径不发起云账户访问，缺失配置显示需配置状态。
2. 使用两个实际测试账户，先验证 account unavailable、拒绝/取消分享和未配置推送等失败路径，再完成 owner 邀请、受邀接受与本机确认。
3. 未确认、只读、未接受参与者及载荷身份伪造均不能执行；编辑他人创建的指令、摘要或题库应被拒绝或过滤。
4. 使用同一 owner 账户的两台儿童设备，验证外设备指令不生成错误回执；验证旧修订、重复 UUID、未来签发、过期与超五分钟窗口。
5. 验证合法应急授权仍受本机禁用、休息、挑战及每日限制；进程中断或回执上传失败后不重复授予。
6. 测试题库超限、哈希错误、结构错误、降修订、未经授权导入与真实 CKAsset 下载；确认原挑战与可信状态不被云端快照替换。
7. 验证后台推送、前台轮询、重启恢复 opt-in、关闭及共享撤销。对 Production 重复对应验收，保留实际运行证据。

以上为待执行验收步骤；本文件不代表这些 Apple 行为已通过验证。

# iOS 平台能力配置与验收

本次交付包含源码、工程配置和 XCTest 源码；未运行 Apple 编译、签名、XCTest 或真机权限/限制验收。Python 工程校验只验证结构，不能证明系统限制已经生效。最低部署版本为 iOS 17。

## 选择方案

| Xcode scheme | 用途 | 连接能力 |
| --- | --- | --- |
| `BEAA` | 默认前台练习；包含 `BEAATests` 测试入口 | `Practice-Info.plist` 的设备管控、云和分享开关均为布尔 `false`；空 entitlements；不嵌入或依赖任何扩展 |
| `BEAAConnected` | 配置自己的开发者能力后进行系统接入验收 | 三项开关均为布尔 `true`；嵌入监控、限制界面、限制按钮三个扩展；请求设备管控、App Group、CloudKit 和远程通知能力 |

默认标识下两个应用方案使用同一个 App ID，不可并装。练习模式只记录本应用前台练习，离开后暂停；不得称为其他应用或整台设备用时。

## 使用自己的标识和签名

1. 将 `apps/ios/Configuration/User.xcconfig.example` 复制为同目录的 `User.xcconfig`，填写 `DEVELOPMENT_TEAM`、`BEAA_BUNDLE_IDENTIFIER`、`BEAA_APP_GROUP`、`BEAA_CLOUD_CONTAINER`。示例值不属于使用者，不可直接用来发布。
2. 在自己的开发者团队中创建下表的 App ID、App Group 和 iCloud container；将主应用和监控扩展加入同一个 App Group。为相关目标申请并配置正式 Family Controls entitlement；本地源码中的 entitlement 不能代替 Apple 审批或签名授权。
3. 在 Xcode 检查各目标 Signing & Capabilities、实际生成的 provisioning profile 及签名 entitlements。Connected 主应用还需其 CloudKit/分享和远程通知配置；完整云协作流程见相应交付文档。
4. 不直接维护生成的工程和 `Configuration` 模板。需要修改默认模板时编辑 `apps/ios/generate_project.py`，然后运行 `python3 apps/ios/generate_project.py`。`User.xcconfig` 保留个人覆盖配置。

| 目标 | Bundle ID | 生成的 Info / entitlements | 源码成员 |
| --- | --- | --- | --- |
| `BEAA` / `BEAAConnected` | `$(BEAA_BUNDLE_IDENTIFIER)` | `Practice-*` / `Connected-*` | `BEAA/*.swift` |
| `BEAADeviceActivityMonitor` | `$(BEAA_BUNDLE_IDENTIFIER).monitor` | `Monitor-*` | `PlatformUsagePlanner.swift`、`PlatformScreenTimeBridge.swift`、`Extensions/DeviceActivityMonitor/BEAADeviceActivityMonitor.swift` |
| `BEAAShieldConfiguration` | `$(BEAA_BUNDLE_IDENTIFIER).shieldconfiguration` | `ShieldConfiguration-*` | `Extensions/ShieldConfiguration/BEAAShieldConfiguration.swift` |
| `BEAAShieldAction` | `$(BEAA_BUNDLE_IDENTIFIER).shieldaction` | `ShieldAction-*` | `Extensions/ShieldAction/BEAAShieldAction.swift` |

这里的 `*-*` 分别指 `Configuration/<名称>-Info.plist` 与 `Configuration/<名称>.entitlements`。两个静态限制扩展只需 Family Controls entitlement，不读取共享账本；监控扩展另外使用 App Group。主应用和监控扩展的 `BEAAAppGroupIdentifier` 必须一致。源文件夹内扩展 Info 是交付参考；实际工程使用 `Configuration` 中生成的 Info。限制按钮只返回系统 `.close`；家长/孩子须手动返回学习应用，不声称按钮能直接打开主应用或解除限制。

## 计量、禁用时段和短时授权

- 系统授权后通过系统选择器选取应用、类别和网站。限制与计量仅针对该范围；调用请求被接受仍需真机确认限制效果。
- 系统事件是累计用时阈值的**下界**。应用按当前代次、日期和事件 ID 验证，取累计最大值并安全持久化后才确认回执，不相加重复事件；它不是完整精确的整机用时报告。
- 每轮注册提前五分钟、一分钟和到期阈值，以及每日上限对应阈值。新代次以已入账每日用时和当前周期进度为基线，不能通过重启监控重新领取预算。更换策略、范围、停止监控或关闭短时授权时，对无法精确计量的剩余范围执行保守结算，可能提前消耗预算；这部分不能标注为测得的真实使用时长。
- 禁用时段按星期重复，支持跨午夜与周日到周一。每个“窗口 × 所选星期”占一个活动名额；单跨度须至少十五分钟。基础用时监控占一个名额，因此最多十九个禁用时段活动；同时使用短时授权到期保护时最多十八个。超出会显式报错，不宣称已完整配置。应用自身的禁用时段判断仍保留。
- 普通短时许可及应急授权在解除限制前注册独立到期活动：开始时间为到期前十五分钟，结束时间为到期时刻。对五分钟授权，这意味着注册一个已开始的十五分钟区间。**当前系统是否接受该注册、是否及时交付结束回调，必须在目标真机/系统版本验收。** 源码没有用前台定时器冒充后台系统保护；注册失败保留限制请求并暂停使用入口。
- 到期、周期和每日终点回执保留终止限制，直到学习状态安全处理并确认；禁用时段结束不会覆盖尚存的业务/终点限制。新的日期须家长确认，不由扩展自动重置预算。

## 接受的运行模式与休息边界

尚未请求设备监控时，运行前台练习模式。请求后会持久化这一意图；授权撤销、App Group 不可用、监控活动缺失、代次/日期不符或到期保护失败，均暂停应用使用入口，不静默退回前台练习以绕过账本。保留/重新请求所选范围限制不等于能保证撤权后的物理限制仍有效。

连接模式的后台休息补记只接受已持久化锚点：同次启动的连续时钟、相同监控代次和控制修订、有效系统授权、同一天、没有跨禁用时段，以及墙钟与连续时钟差值在容差内。重启、回拨、未知状态或条件不一致时不补发休息资格，保留之前进度。休息是这些条件下的时间记录，不能证明眼睛离屏，也不能证明未选应用或整台设备没有操作。

系统通知需独立申请权限。前台练习提醒与扩展的所选范围阈值提醒采用不同来源描述；有持久化去重和取消处理。通知被允许、已排队或已显示均不等于限制效果已经验收。

## Apple 环境验收清单（待执行）

- 构建两个 scheme，执行 `BEAA` 的 XCTest；检查三个扩展实际嵌入、bundle 标识、principal class、签名能力和 App Group 一致。
- Practice 无设备/云能力请求；Connected 分别验证授权允许、拒绝、撤销、重新授权与选择器家长授权过期。
- 用选中和未选中的应用、类别、网站核对范围；真实触发五分钟、一分钟、周期及每日终点，检查限制界面与关闭按钮。
- 在主应用后台和结束运行后测试禁用时段开始/结束、重叠、跨午夜和周日跨周；核对终点限制不会被时段结束解除。测试短跨度、十九个活动及与到期活动共存的容量错误。
- 验证五分钟短时授权的“已开始区间”注册及到期回调；后台、强制退出、锁屏、重启、时区/时钟变化、通知拒绝都应分别测试。注册拒绝须保持暂停，不能报告成功保护。
- 重放/乱序/延迟回执、提交失败后重试、停止/重启监控、策略变更及家长新日确认，均不重复计量、不降低已入账用时、不额外授予预算。
- 验证后台休息连续时钟锚点，撤权/重启/回拨/跨禁用窗口不补发资格；验证 App Group 不可访问、损坏或活动丢失后保持明确故障状态。
- 核对自定义界面及通知中文/拼音、前台与所选范围的来源说明；记录设备型号、系统版本、签名环境和每项结果。未完成上述项前，不把源码交付描述为已通过真机限制验收。

可先运行只读结构检查：`python3 apps/ios/validate_project.py`。它检查生成一致性、源码成员、扩展嵌入、能力模板和 scheme，不替代上述 Apple 验收。

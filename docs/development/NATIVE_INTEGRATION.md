# 原生集成与持久化设计（尚未构建验收）

## 当前证据与门禁

云环境具有 Node/Python/Chromium，无 hvigor、ohpm、DevEco Studio 或配套 HarmonyOS SDK；没有目标设备、签名或授权。原生目录中的 Stage/ArkUI 工程和页面源码保留，`tests/harmony-scaffold.test.mjs` 仅检查文件与资源，不是编译测试。此阶段不更改 SDK/API 版本或宣称生成 HAP。正式工程配置需要与可用 DevEco Studio 模板核对后才能构建。

## 业务与平台接口

沿用 `docs/ARCHITECTURE.md` 的 DeviceControlAdapter 和 `shared/domain/engine.mjs`。原生接入时用 ArkTS 类型适配业务契约，而非直接导入 `.mjs`。能力报告必须分别描述 usage/restriction/restore；不支持时返回 unsupported，不抛装成功，不回退为系统已锁定。计时、日期与休息只接收经设备适配器核实的事件。浏览器 demo 中的按钮、系统墙钟和 PIN 摘要不是这些可信来源。

推荐服务边界：

| 服务 | 输入 | 输出与校验 |
|---|---|---|
| PolicyStore | 经家长验证的版本化规则 | 依照 validatePolicy 范围与 requiredCorrect<=questionCount 校验 |
| QuizRepository | 年级、学科、知识点、题量 | 唯一题 ID、选项和标准答案；不接受 UI 自报 correct |
| SessionStore | 领域 session、预期修订号 | 原子写入新修订号，冲突重新读取；拒绝部分写入 |
| UsageAdapter | 正式平台授权与事件 | 核实有效使用秒数；权限撤销使能力降级并提示 |
| RestMonitor | 可信单调时间/重启标记 | 可核实休息秒数；异常时不发放资格 |

## 原生持久化迁移

SessionEnvelope 设计包含 schemaVersion、revision、policyVersion、session、quizSnapshot、restEvidence 和 audit；版本迁移逐字段校验，损坏学习记录不能清空有效使用账本。规则、账本和资格必须在同一事务内保存；对重复事件存 eventId 防止二次计入或放行。冷启动先读取已提交快照，再核对平台权限、实际限制状态和时间连续性，最后允许交互。检测到损坏或不支持版本时进入可解释的恢复状态，不默认新增使用额度。

敏感家长凭据需平台安全存储，不能复用浏览器可修改的 localStorage 作为安全边界。浏览器实现只保留最近 200 条错题/挑战和 100 条家长操作，原生保存策略应独立实现。跨日不得绕过日上限，跨日中的休息和挑战不得靠重启重复发奖。

## 人工准备后的验证命令/证据

在匹配 SDK 的 DevEco Studio 中同步 hvigor/ohpm，执行 IDE 对应的 assembleHap 任务（具体任务及版本由生成模板确定），保存完整工具版本、命令和退出状态；仅使用本地签名配置。安装后按 `docs/DEVICE_POC.md` 与 `tests/ACCEPTANCE.md` 收集型号/系统子版本、权限、横竖屏、后台/重启/分屏和撤权证据。只有这些证据齐全才允许更新原生构建/真机门禁。

## 已实现的SDK无关规则恢复契约

`shared/domain/snapshot.mjs`提供schemaVersion=1/revision/session的规则载荷、严格校验和JSON编解码；配合现有engine使用。原生SessionEnvelope可承载该规则状态，policyVersion、quizSnapshot、restEvidence、audit和平台事务仍按前述设计实现，本轮未实现ArkTS/Preferences后端。

冷启动顺序：由平台存储认证并读取完整记录，解码验证规则状态，再核对平台授权/实际限制及可信日切换、休息证据，最后决定是否调用系统适配器。未知或损坏快照应进入恢复流程，保留账本，不能默认放行。

跨日仅清零日累计，不重置周期/挑战/休息。每日锁下保留的已通过挑战，在日切换后回到待核验休息状态，由原有可信restEvidence判断是否满足要求；日期变化本身不能充当休息证明。revision是存储方元数据，快照函数不实现CAS、原子写入或抗回放。

## 共享题库与测验快照

`shared/quiz/bank.mjs`提供题库校验与年级/学科/知识点组卷；`shared/domain/quiz-service.mjs`提供固定题目快照、标准答案查验、公开题目及已答复习视图。QuizAttempt快照封装既有DomainSnapshot和quizSnapshot，恢复时核对每条评分、题序、年级/科目及阶段关联，不依赖当前题库文件。

标准答案快照归可信controller/store管理；原生界面只获取公开题目和已作答反馈。请求事件ID、期望revision/CAS、存储认证与系统权限仍由平台集成层处理。该共享JS组件尚未接原生UI/Preferences，未通过ArkTS编译。

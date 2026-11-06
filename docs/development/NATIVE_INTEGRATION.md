# 原生集成与持久化设计（尚未构建验收）

## 当前证据与门禁

云环境具有 Node/Python/Chromium，无 hvigor、ohpm、DevEco Studio 或配套 HarmonyOS SDK；没有目标设备、签名或授权。原生目录中的 Stage/ArkUI 工程和页面源码保留，`tests/harmony-scaffold.test.mjs` 仅检查文件与资源，不是编译测试。此阶段不更改 SDK/API 版本或宣称生成 HAP。正式工程配置需要与可用 DevEco Studio 模板核对后才能构建。

## 业务与平台接口

沿用 `docs/ARCHITECTURE.md` 的 DeviceControlAdapter 和 `shared/domain/engine.mjs`。原生接入时用 ArkTS 类型适配业务契约，而非直接导入 `.mjs`。完整设备动作接入必须分别验证 usage/restriction/restore；本轮只读状态契约仅包含 usage/restriction，见[平台状态契约](../../shared/domain/DEVICE_CONTROL.md)，restore（解除限制能力）在未来动作服务中单独定义与验收，不能由reported_ready推断；不支持时返回 unsupported，不抛装成功，不回退为系统已锁定。计时、日期与休息只接收经设备适配器核实的事件。浏览器 demo 中的按钮、系统墙钟和 PIN 摘要不是这些可信来源。

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

## 共享学习历史契约

`shared/domain/learning-history.mjs`已提供独立的完成测验归档、保留窗口去重、错题查询、按日期/年级的学科与知识点统计和版本化JSON校验。默认保留最近200轮（可设1–200），原题快照和原阈值保证后续题库/规则修改不改变历史评分。统计只覆盖保留窗口，不表示终身累计。

原生控制层必须在最后一题提交时生成并持久化稳定attemptId/completedAt，同事务保存完整attempt与历史（或可靠outbox事件后重试），并在跨日或新测验前归档。损坏历史的恢复与使用账本隔离，不能以历史通过结果重新发放资格。窗口外事件仅返回outside_window，保留窗口内同ID冲突拒绝，长期去重及存储认证仍由平台实现。含标准答案与儿童记录的历史不能向未授权界面整体暴露；家长/孩子的查询范围由控制层授权。

`encodeLearningHistory`/`decodeLearningHistory`仅定义载荷和校验，不实现ArkTS、Preferences、事务或可靠队列。SDK、签名、设备权限及实际安装验收门禁保持不变。

## 单轮答题与学习归档的原子端口

共享`quiz-progress.mjs`已把每题推进、末题完成与历史归档合成单个状态快照；完成恢复会重新核对题目、答案、日期、原阈值及完成事件的历史关联。`quiz-controller.mjs`捕获提交命令，读取已提交快照，校验轮次/期望revision，然后调用一次`compareAndSwap({attemptId,revision}, newText)`；只在确认提交后返回feedback，或通过已提交记录确认duplicate。写前失败、并发冲突与应答丢失后的重试已有内存端口故障注入证据。

**仍需原生实现**：read返回完整已提交记录；CAS必须在同一原子操作中比较两个字段并持久化全部文本，false表示未写，异常可表示提交结果未知（上层重读后以相同命令重试）。未经互斥保护的先读后写无法替代CAS。真实存储认证、持久性、跨进程争用及进程/设备重启测试尚未实现或验证。demo只有单进程独占临时文件的同步比较/rename，不证明断电可靠性。

progress的revision等于本轮已答数量，attemptId必须跨轮唯一。该聚合结束于已完成测验，休息/跨日和新轮建立应以可信生命周期事务迁移，不能重新包装旧状态并重置修订号来绕过事件保护。旧ID不能因学习记录被淘汰而复用；平台层需保证长期唯一/防回放。业务阶段和学习通过结果都不能代替实际系统限制状态核验。

## 休息证据与时钟连续性

`shared/domain/rest-progress.mjs`已提供SDK无关的RestMonitor载荷与纯迁移。输入为可信适配器确认的完整resting/active/unknown区间、启动标识和单调毫秒；不能把前台计时器、墙钟差或两个空闲采样点当作整个区间的休息证明。当前云环境尚未实现这些设备证据的采集，也不承诺目标平台API可用。

同启动连续resting才保留连续休息；活动、未知条件、间隙和时钟不连续按文档保守处理。恢复后的ready只描述已存证据；新完成必须传入当前可信bootId/单调检查点，换启动或时间倒退拒绝，不按日期差补时长。完成receipt派生既有finishRest结果并保持日累计；重复完成只返回原结果，不重复发资格。设备重启后即使有已完成receipt，仍须重新核对权限和实际限制，不能依赖历史phase直接恢复系统操作。

原生控制层需绑定通过事件ID与restId，长期不复用；原子保存休息progress及生命周期迁移/学习历史，使用revision进行CAS、串行处理观察事件，并在保存成功后才操作设备。当前quiz-controller是单轮答题端口，不能直接用它提交休息状态。共享quiz→rest→下一轮的统一状态迁移现已提供（见下）。真实日切换/策略更新协调、原子存储后端与设备恢复测试仍需平台实现。demo现统一为一个临时文件，但仍不构成原生崩溃/断电恢复证据。

## 已实现的共享生命周期聚合

`guardian-lifecycle.mjs`把普通session、测验、休息以判别联合放进单快照，顶层学习历史只存一次。全局revision跨阶段持续递增，round持久计数生成不复用的测验ID；不能在新轮或历史淘汰后把revision/ID重置。末题通过的归档与rest创建、休息完成的新session和历史均在一次迁移内产生；最近完成回执保留休息及通过测验证明用于恢复关联校验。

`lifecycle-controller.mjs`统一调用`read()`/`compareAndSwap({lifecycleId,revision},wholeText)`，只有端口确认或已提交回执重复才返回公开视图/反馈。原生端口必须同一原子操作比较两字段并持久写全部数据，不能先读后无条件写。真实后端、认证、防回放、跨进程锁与持久性尚未实现；本轮只验证符合契约的注入式端口及单进程文件示例。

可信日切换在普通/进行中测验更新session；完成测验和休息保留原完成日期/题目关联，calendarDay记录可信当前日期，查询/休息结束派生新日累计。日切换不会证明休息，不改变历史归档日。题库作为可信上下文用于新轮组卷，当前题目只暴露公开字段，状态载荷仍含私有答案。

原生集成应优先使用统一生命周期端口；旧的单轮模块保留为业务组件/单元接口。共享策略更新及家长认证参考现已实现（见后）；临时授权、真实Usage/Rest/Calendar适配、权限核对及系统操作仍需平台服务。示例已从两个阶段文件改为一个临时JSON，不等于原生SDK、断电恢复或设备管控验收。

## 云端 SQLite 原子存储参考（非原生后端）

`apps/node-reference/sqlite-store.mjs`通过Python标准库SQLite实现统一生命周期read/CAS契约；BEGIN IMMEDIATE在真实独立进程间比较lifecycleId+revision、写完整快照后提交。使用DELETE journal/FULL同步、固定格式版本、摘要/metadata核对及私有目录/文件限制，未知或损坏数据库拒绝恢复，不自动重建。

新增真实数据库并发、锁超时、已提交应答丢失重开、COMMIT前/后SIGKILL恢复证据；测试writer独立于生产helper，没有给生产接口加入故障开关。`npm run demo:sqlite`运行该参考适配器，输入时间/休息仍为合成值。

此参考实现要求Node20+/Python3.11+/POSIX，不能直接用于ArkTS/HAP。它可作为原生SQLite/Preferences事务适配的行为基准；平台仍需实现受保护存储/认证、防回滚及备份迁移，验证文件系统持久性、真实断电/设备重启、权限撤销和系统限制。SHA256是损坏检测而非认证，POSIX权限不防同UID恶意修改。

## 参考存储的一致备份边界

SQLite参考端口现提供Online Backup API一致备份与只读检查，覆盖未提交writer/并发提交情况下的完整快照、独占新目标及metadata摘要返回。copy目标权限和祖先信任要求同主库；inspect使用只读连接，不改主库或备份。原生备份实现可参考这些行为测试，但不能直接导入Node/Python代码。

本轮不提供restore或自动failover。旧副本即使结构一致，也可能遗漏后续使用累计/权限变更，不能拿来覆盖当前账本或重新发放资格。未来恢复需单独设计与验证授权、版本迁移、防回滚和不可丢失额度记录。备份失败残留目标保留诊断，检查不能证明最新性/真实性；平台受保护存储、加密及真实断电/设备迁移仍未验收。

## 家长身份参考与报告授权接口

新增通用`getParentLearningReport(store,authorizer,token,query)`，在读取前后调用可信authorizer，核对lifecycleId/credentialVersion，拒绝跨家庭、失效/注销和读取中凭据变更；只返回已完成记录，不改使用资格。不能把用户传入proof/boolean或Python内部协议当作验证入口。

Linux参考服务使用独立auth SQLite、PBKDF2-HMAC-SHA256 600k、随机盐、事务失败计数/冷却与实例内短时token，换PIN按凭据版本撤销其他实例授权。凭据库不属于guardian备份格式；不存在/损坏不自动重置。Node/Python传输复用同一限时/错误隔离实现，PIN不进argv/日志、token不落盘。

原生仍需自己的可信初始化、密钥库/安全存储与身份实现；该参考不能直接导入ArkTS，也不证明操作者为成年人或阻止同UID修改/回滚。token时钟与真实后台/休眠恢复需平台验证，恢复时宜清理授权。家长设置更新现见后文授权网关；临时使用授权、账户恢复和设备权限仍未接入；M2门禁不变。

## 家长设置网关与累计账本迁移

`parent-policy.mjs`新增仅set_policy的验证入口：前后authorizer核对家庭scope/凭据版本，编码后再校验授权并CAS。普通controller不接受家长设置命令，UI不能直接暴露纯reducer或传入伪造proof。两独立数据库无跨库原子撤销，最后一次授权为接受点；后端异常/冲突必须重读，不能无条件重试覆盖。

配置在普通/日锁/失败测验阶段立即应用；正在答题/休息固定当轮旧策略，pending在失败或原休息完成边界生效，不追溯改变历史判分。返回active/pending/effect，原生设置页需解释待生效，不能显示系统已解锁。

schema2根policy/dailyUsageSeconds/pendingPolicy保留权威实际累计；领域session仍schema1并存min(actual,cap)投影。展示/保存实际累计必须用根账本或view，不能以投影替代，否则降低再提高上限会丢已用时间。仅可信日切换清零，周期/原休息/历史保持。

旧schema1由冻结只读validator严格校验后内存升级，身份/revision/round不变；SQLite表user_version1不变，下一成功CAS写payload2。旧版程序读payload2应拒绝，不得丢字段降版。参考SQLite/PIN真实验证已覆盖迁移/应答丢失/注销拒写，原生格式迁移、事务、权限和真机仍需验收。

## 独立题库目录与测验题源

共享`catalog.mjs`与`question-bank-service.mjs`现提供按lifecycleId归属的版本化目录、家长验证前后检查、CAS导入和从目录开始测验的可信入口。Node/Python专用SQLite参考目录与guardian/auth库格式隔离；目录变更不写使用账本。测验开始固定原题，之后答题/恢复/归档不读取当前目录；最近开始命令重试优先恢复已提交回执。新轮读取时若题量不足或目录无效应保留挑战状态，不重复凑题或默认放行。详见[目录契约](../../shared/quiz/CATALOG.md)。原生应实现同等端口行为、可信初始化和家长授权，不直接导入Node/Python模块；课程完整性、原生存储/UI及设备门禁尚未验收。

## 参考库格式隔离与热日志恢复边界

Linux参考guardian/auth/bank库现统一在SQLite连接之前核对受保护文件头部的专属application_id、user_version和DELETE读写标记，再以既有完整校验确认表、摘要/凭据和领域载荷。头部不承担认证或防回滚；所有支持writer保持这些格式标记不变。新文件初始化/备份新目标不套用既有文件头检查，仍需独占创建。

家长status不执行凭据更新，但允许正确库的未提交热日志恢复，保持最后提交的PIN、版本与失败次数；不得将此描述成自动登录或重置失败计数。guardian的严格只读inspect与备份内部源快照阶段遇需恢复的热日志应失败且不改变源，不生成误导性目标。正常打开主库后才继续检查/备份。真实断电、设备重启和原生持久性须另行验收，本轮没有迁移原生存储实现。

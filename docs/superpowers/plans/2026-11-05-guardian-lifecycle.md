# Guardian Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 使用→答题→归档/休息→下一轮及跨日全部在一份快照内迁移，避免分阶段载荷提交断层。
**Architecture:** guardian-lifecycle.mjs复用engine、quiz-progress和rest-progress；顶层学习历史只存一次，stage为session/quiz/rest判别联合，测验progress的history通过顶层注入校验。lifecycle-controller.mjs统一read/CAS，比较稳定lifecycleId+全局revision。无新依赖，不改已验收浏览器MVP。
**Tech Stack:** Node20+ ESM/node:test，无SDK依赖。
**Spec:** 以下设计契约，延续docs/development/NATIVE_INTEGRATION.md。

## Design / Approaches

采用单一阶段聚合和全局revision。相比逐文件保存或outbox，它直接复用已有小型本地载荷并减少阶段事务缺口。用户已授权连续开发，以下为工程实现决策，不等待例行确认。

格式：{schemaVersion:1,lifecycleId,revision,round,calendarDay,history,stage,lastReceipt}。
- lifecycleId为可信层创建的不复用标识（<=96字符），round为持久递增的测验序号；roundId=`lifecycleId/round/N`，历史淘汰不会复用ID。顶层revision每个合法新事件+1，全生命周期不重置，耗尽明确拒绝。
- createGuardianLifecycle(lifecycleId,policy,dayKey)只用于首次建立账本，不能用来替代失败恢复。
- stage={kind:'session',session}（AVAILABLE/CHALLENGE_REQUIRED/DAILY_LOCKED、无挑战）；或{kind:'quiz',progress:省略history的QuizProgress}（active或完成未通过）；或{kind:'rest',quiz:省略history的完整通过QuizProgress,progress:未完成RestProgress}。休息sourceSession必须匹配通过测验，restId=roundId。完成休息原子切换为普通session，保留顶层history。
- calendarDay是可信日期服务已核实的最新日期。普通session/进行中quiz实际rollDay；完整失败测验与休息的固定原日期保持以核对历史，getGuardianSession按calendarDay派生日累计。休息完成后落地当前日期session，跨日本身不完成休息。
- command严格为{lifecycleId,eventId,expectedRevision,type,payload}。最近同命令重试返回duplicate，冲突或旧revision拒绝；更早命令不承诺重复成功。eventId由可信层稳定生成且不复用。lastReceipt保存规范化命令与已答feedback（其他命令为null），与最新阶段关联校验。
- record_usage:{seconds}只在普通AVAILABLE阶段；可信秒数0..86400，日硬上限由engine保障。
- begin_quiz:{knowledgePoints:[]}只在确需挑战时，context.bank提供可信题库（不塞进事件/receipt）。新round ID确定性生成，重试不重新组卷。
- answer:{questionId,chosen,completedAt,restAnchor}委托submitProgressAnswer；非末题时间和anchor均null，末题有有效时间及{bootId,monotonicMs}。通过则同次归档并创建rest聚合；失败保留完整失败quiz，可再练习；输入原子提交失败时不部分迁移。
- observe_rest:{bootId,fromMs,toMs,condition}委托已有区间校验；complete_rest:{checkpoint:{bootId,monotonicMs}}委托新检查点完成，并切换普通session。roll_day:{nextDay}只接受真实公历的前进日期，保留挑战/休息证据与历史完成日。
- validate/encode/decodeGuardianLifecycle严格校验字段、版本、阶段、round ID、历史关联、rest源状态及receipt。文本最多8,000,000 UTF16码元；损坏不创建新账本。校验不证明时间、题库、身份或存储真实性。
- getGuardianView返回公开phase/日期/累计/待生效资格、当前公开题目与休息状态，不暴露未答题答案或完整存储。
- commitGuardianCommand(store,command,context?)捕获输入后read/校验/迁移/编码，再一次compareAndSwap({lifecycleId,revision},完整JSON)。仅在确认提交或已存receipt重复时返回公开视图/反馈；CAS冲突不自动重试，读写异常不返回成功。端口必须自己提供持久原子性/认证。
- demo迁移为一个独占临时文件，覆盖部分答题恢复、通过即休息、半程休息恢复、重复完成和新轮；仅单进程同步比较/rename，无多进程锁/fsync或设备证据。原生ArkTS/SDK/签名/权限门禁不变。

## Global Constraints

- dev基线7cb306f，PR15已合并，独立feature分支，不修改或合并master。
- 不宣称存储端口、合成区间或Node文件测试证明原生事务/计时/设备限制。
- 时间/区间/日切换/题库/创建与命令身份均由可信控制层提供；不会自动读取墙钟。

## Review Focus

- 末题到休息与完成休息到普通session必须和history一起提交，无部分保存。
- 多轮累计达120分钟后即DAILY_LOCKED，不可答题/重试放行。
- 跨日不伪造休息，不改变已完成测验原日期，不丢部分答题。
- 相同题ID在新轮不能接收旧命令，全局revision及ID淘汰后仍不倒退。
- 损坏阶段/receipt/历史关联及提交结果未知不能默认重建或反馈成功。

### Task 1: Lifecycle reducer and snapshot

**Files:** shared/domain/guardian-lifecycle.mjs, shared/domain/guardian-lifecycle.test.mjs, tests/helpers/guardian-fixture.mjs。
**Interfaces:** GuardianError, createGuardianLifecycle, validateGuardianLifecycle, applyGuardianCommand(input,command,context={}), getGuardianSession, getGuardianView, encodeGuardianLifecycle, decodeGuardianLifecycle。
- [x] 写全闭环/多轮上限/失败重练/跨日/保留ID/旧命令与损坏恢复的行为测试并确认失败。
- [x] 复用现有组件实现聚合，针对与完整npm test通过。

### Task 2: Commit coordinator and delivery

**Files:** shared/domain/lifecycle-controller.mjs, shared/domain/lifecycle-controller.test.mjs, shared/domain/demo.mjs, README/集成文档/里程碑/测试报告与原始日志。
**Interface:** commitGuardianCommand(store,command,context={})。
- [x] 写跨阶段写前/写后应答丢失、并发、非法端口、命令/题库异步捕获测试并确认失败。
- [ ] 实现统一read/CAS；单文件demo运行、独立整分支审查、修复、全套测试后PR至dev及CI、源码打包。

## Execution ledger

- 基线npm test123/123通过；旧独立组件接口保持不变，统一聚合不重复保存顶层history。新全局revision与旧内部答案/休息revision分开，注入调用时使用对应内部revision。

- 设计细化：complete_rest的lastReceipt额外保留restCompletion，只保留最近完成证明；恢复时据此校验新session与原账本/休息结果一致，下个新事件淘汰该证明。避免只校验最终AVAILABLE而丢失账本关联。

- 恢复自检补充：初始revision0必须空账本；最近完成receipt同时保留通过quiz与restCompletion，恢复重新关联顶层history。两项损坏回归先实际失败，再修复，防止阶段切换后丢失学习归档关联。

- Task1/2 code verification: reducer15 + controller8，新增23项绿色；全量146项与单文件demo通过（原123项仍通过）。独立审查进行中。

- Final review: no blocking findings; independent npm test146/146, zero failures。单文件demo通过。准备功能提交、dev PR/CI及源码交付。

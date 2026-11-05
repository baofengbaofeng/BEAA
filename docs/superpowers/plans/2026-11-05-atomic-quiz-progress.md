# Atomic Quiz Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 最后一题与学习历史归档产生同一个可校验快照，避免分步保存造成漏记；提供面向原子存储端口的提交服务。
**Architecture:** 保留现有engine/quiz/history接口，新增quiz-progress.mjs作为单轮聚合与校验、quiz-controller.mjs作为异步读/CAS协调。存储端口负责原子性与持久性；不新增原生存储假实现或扩展浏览器MVP。
**Tech Stack:** 现有Node20+ ESM、node:test，无新依赖。
**Spec:** 本文件下方设计契约，延续docs/development/NATIVE_INTEGRATION.md。

## Design / Approaches

本轮由工程判断选用单聚合快照：比起先存测验再存历史，它能让合格的原子端口一次提交两者；可靠outbox同样可行，但当前两个小型本地载荷无需引入后台队列。遵循用户连续执行授权，不等待例行设计确认。

- QuizProgress = {schemaVersion:1,revision,attemptId,attempt,history,completion}。只能以未作答的active attempt建立，revision等于本轮已答数量，attemptId由可信控制层生成且跨轮不可复用。
- completion为null或{completedAt,archiveOutcome}。仅完整答题有completion；以attemptId归档，outcome为added或outside_window（输入历史不允许已有同轮ID）。恢复时重新核对当前测验与已存历史关联；不补写/清空损坏数据。历史题与测验题的knowledgePoints必须显式存在。
- submitProgressAnswer(progress,command)命令严格为{attemptId,expectedRevision,questionId,chosen,completedAt}。非末题completedAt=null，末题为可信完成毫秒时间。预期revision对应本轮答题索引；旧索引且原题/原选项/完成时间完全相同可返回duplicate；冲突选择、未来revision或其他attemptId拒绝。无需持久化额外答案副本。不同轮即使题ID相同也拒绝旧命令。
- 合格末题在同一次纯迁移调用recordCompletedQuiz；未通过也归档。休息/日累计由现有规则决定，学习历史不提供使用授权。返回{progress,duplicate,feedback}，输入不变。
- encode/decodeQuizProgress仅接受完整已知字段及一致数据，文本上限6,000,000 UTF16码元。revision只是本轮递增序号；不宣称自行实现CAS、认证或抗回放。
- commitQuizAnswer(store,command)：read()->JSON文本；compareAndSwap({attemptId,revision},newText)->boolean，比较与写入整个聚合必须由端口原子完成。CAS false报CONFLICT，不自动重试其他答案。读/写异常和非布尔结果报STORE_FAILURE，不向界面返回未提交反馈；已写但应答丢失后，同命令读取恢复并返回duplicate。结果只含outcome/revision/feedback/phase/archiveOutcome，不暴露题库答案。
- 本模块只覆盖单轮答题与归档。下一轮、跨日、休息迁移需要可信controller另行管理；不得直接修改正在保存的progress。原生后端、设备权限、签名/构建仍未验收。

## Global Constraints

- dev基线73f12a0（PR12已合并），独立feature分支；不合并或改写master。
- 不修改浏览器MVP，不声称模拟CAS/文件示例代表原生持久化、设备计时或系统限制。
- 命令与包含私有标准答案的快照由可信服务/受保护存储持有；真实时间、身份和事件真实性由平台层验证。

## Review Focus

- 末题写入前异常应同时保留旧答案和旧历史。
- 写入成功但应答丢失后的重试只返回已提交结果，不二次统计。
- 同题ID跨轮或并发不同选项不得错误命中幂等处理。
- 恢复不能接受测验已完成却缺少对应历史（真实outside_window除外）。
- revision耗尽、未知字段/版本、缺失知识点及超长载荷不能导致默认新建或放行。

### Task 1: Combined progress and checked submission

**Files:** shared/domain/quiz-progress.mjs, shared/domain/quiz-progress.test.mjs
**Interfaces:** createQuizProgress(attemptId,attempt,history?), validateQuizProgress(input), submitProgressAnswer(input,command), encodeQuizProgress(input), decodeQuizProgress(text); QuizProgressError带code。

- [x] 写初始化、部分/末题提交、失败归档、重复/冲突与跨轮命令、损坏关联恢复、真实文件恢复的行为测试；先运行观察失败。
- [x] 实现上述契约；运行针对测试再跑npm test，确认所有阶段/累计不被历史改变。

### Task 2: Store commit coordination and integration

**Files:** shared/domain/quiz-controller.mjs, shared/domain/quiz-controller.test.mjs, shared/domain/demo.mjs, shared/domain/README.md, docs/development/NATIVE_INTEGRATION.md, docs/MILESTONES.md, docs/testing/ATOMIC_QUIZ_PROGRESS_REPORT.md。
**Interfaces:** commitQuizAnswer(store,command)使用Task1编解码/迁移，store为上述原子端口。

- [x] 写并发同/异答案、写前故障、写后应答丢失、读失败、损坏/缺失存储、不合格端口的故障注入测试；先运行观察失败。
- [x] 实现单次读取/CAS协调，不自动重试。运行npm test与demo，demo实际保存/读取完整快照。
- [ ] 更新边界与测试报告；独立整分支审查、必要修复、完整测试后提交feature PR至dev，等CI完成；打包源码。

## Execution ledger

- 基线npm test89/89通过；任务1/2接口：submitProgressAnswer返回progress供controller encode，revision和attemptId均参与CAS，未发现冲突。

- Task 1: complete — 新增9项红/绿测试，完整npm test98/98通过；revision严格对应答案前缀。
- Task 2: controller新增9项红/绿测试通过，完整npm test107/107；故障注入为测试端口，非设备崩溃证据。

- Final review: independent reviewer found no blocking findings; targeted18/18 verified independently. Full107/107 and file demo passed after integration/docs.

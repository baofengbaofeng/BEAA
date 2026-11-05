# Verified Rest Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 提供可恢复的休息证据状态，避免墙钟变化、重启、未知间隙或重复事件误完成休息。
**Architecture:** 延续engine.finishRest可信秒数契约，新增rest-progress.mjs，接收平台适配器已核实的单调时钟区间；不读取Date.now，不实现平台证据采集。独立单轮聚合包含原REST_REQUIRED session、稳定restId、revision及已核实的连续区间；原生存储仍需认证/原子写入。
**Tech Stack:** 现有Node20+ ESM和node:test，无新依赖。
**Spec:** 本文件设计契约及docs/development/NATIVE_INTEGRATION.md RestMonitor。

## Design / Approaches

采用可恢复的已核实连续区间，而非根据系统日期差补时间，也不重复实现任意UI秒数累计。用户已授权连续执行，工程判断采用保守的连续休息：active/unknown、重启或时钟不连续不能继续沿用旧休息时长。缺失的区间不计；新间隙之后的确证区间可开始新连续段。平台能力不足时报告无法核验，不自动把前台倒计时当作有效证据。

RestProgress={schemaVersion:1,restId,revision,sourceSession,bootId,cursorMs,restStartedMs,lastInterval,completion}。
- createRestProgress(restId,session,{bootId,monotonicMs})仅允许REST_REQUIRED+pendingGrant的合法原session；起始已核实休息为0。稳定restId应关联通过测验事件、不可跨轮复用。
- observeRestInterval(progress,{restId,expectedRevision,bootId,fromMs,toMs,condition})消费可信平台的完整区间，condition为resting/active/unknown，毫秒均非负安全整数，单区间最多86,400,000ms。严格字段校验，不接受wallClock/自报verifiedSeconds。
- 同boot连续resting累计；active/unknown清零连续休息。from>cursor间隙后从本次已核实区间重新开始；boot改变或from<cursor的时钟/重叠异常丢弃旧连续段及本次区间，从toMs重新建立观察边界，不放行。
- revision每次合法新事件+1。最近原命令同内容重试无副作用；内容冲突、旧/未来revision或其他restId拒绝。较早历史事件不承诺幂等，须重新读取；从未默认重放成新事件。
- lastInterval={command,resetReason}，resetReason为null/boot_changed/clock_discontinuity/gap，恢复时检查它与cursor/当前连续段/完成标志的一致性。不以序列化校验证明事件真实性。
- getRestStatus返回verifiedSeconds（向下取整）、remainingSeconds（向上取整）、ready/completed/phase等公开状态。0分钟规则可立即完成；计时单位/边界不得提前放行。
- completeVerifiedRest(progress,{bootId,monotonicMs})要求当前检查点与证据同boot且monotonicMs>=cursorMs；检查点不额外贡献休息时间，换boot/倒退拒绝STALE_EVIDENCE。仅ready时调用既有finishRest，返回{progress,session,duplicate}；保存completion检查点并增加revision，重试返回相同session不再增加revision。源session保留以核对账本，getRestSession根据completion标志推导当前session；完成后新区间拒绝；重复完成返回原完成receipt，不再次发放资格。
- JSON整体上限1,000,000 UTF16码元，未知字段/版本、损坏来源状态、证据矛盾、超长/非法数字拒绝，不默认建立新休息或放行。revision耗尽明确拒绝。
- 不改quiz-progress的单轮结束契约；可信生命周期层须在一个存储事务中保留学习历史、结束quiz聚合、建立/提交rest聚合，休息后再建立下一轮，核对真实日期和系统权限。本文不提供原生后端、真实计时或签名/设备验收。

## Global Constraints

- dev基线4e6cd36（PR13已合并），独立feature分支，不合并master。
- 不扩展已验收浏览器MVP、不假定系统权限、不将合成区间描述为实际休息测量。
- 不使用墙钟差作为休息证据；时间、bootId、区间条件由可信平台提供。

## Review Focus

- 599,999ms不得达到10分钟；拆分/重复区间不能多计。
- 设备重启、active/unknown或时钟退回即使发生在ready后也必须先消除旧证据。
- 恢复不能接受completed但不足休息、答案未通过或账本矛盾。
- 源session与所有输出隔离，完成不清零日累计；原休息ID不能用于其他轮次。
- 畸形命令/版本/数值/revision耗尽不触发放行，最近重试和完成重试须稳定。

### Task 1: Rest evidence state and recovery

**Files:** shared/domain/rest-progress.mjs, shared/domain/rest-progress.test.mjs
**Interfaces:** RestProgressError, createRestProgress, validateRestProgress, observeRestInterval, getRestStatus, getRestSession, completeVerifiedRest, encodeRestProgress, decodeRestProgress。

- [x] 写连续/边界、active/unknown/间隙/重启/时钟异常、重复/冲突、完成及损坏恢复测试，先观察失败。
- [x] 最小实现；针对测试与npm test通过，检查日累计/原session不变。

### Task 2: File demonstration, report and delivery

**Files:** shared/domain/demo.mjs, shared/domain/README.md, docs/development/NATIVE_INTEGRATION.md, docs/MILESTONES.md, docs/testing/VERIFIED_REST_REPORT.md及原始日志。
- [x] demo用合成区间验证半程文件恢复、完成与重复完成，明确无真实设备测量。
- [ ] 独立审查、修复实际问题、完整测试/demo、文档与功能提交、PR至dev及CI、更新源码包。

## Execution ledger

- 基线dev4e6cd36，npm test107/107通过；接口保持现有quiz/controller不变，本轮只引入休息证据载荷与纯迁移。

- 测试修正：冲突重试夹具误把当前fromMs与旧toMs组合，生成了非法负区间；改为原命令仅更改toMs，准确验证同revision内容冲突，未放宽生产校验。

- Task 1 complete: 新增15项先红（模块不存在）后绿；修正冲突夹具后全量npm test122/122通过。完成要求新检查点，检查点不补计未核实间隔。

- Final review fixed: 首个区间可损坏起点虚增证据 — pending/completed首段损坏回归实际RED→GREEN，首段必须等于fromMs。最终休息16项/全量123项，见测试报告。

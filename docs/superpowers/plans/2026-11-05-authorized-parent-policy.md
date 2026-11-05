# Authorized Parent Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 家长验证后可实际持久修改规则，保留已用累计和当前测验/休息，不通过调整限额或迁移丢额度。
**Architecture:** Guardian生命周期schema2增加active policy、pendingPolicy和权威dailyUsageSeconds；领域session仍为schema1，作为min(actual,newCap)投影兼容引擎。冻结v1只读校验器后严格迁移；SQLite表格式不变。parent-policy网关前后授权+scope/version校验再一次CAS写入。
**Tech Stack:** 现有Node20+/ESM、Python参考SQLite，无新依赖。
**Spec:** 以下契约，沿用现有parent-auth/guardian约束。

## Design / Approaches

采用安全边界生效+独立实际累计，而非直接改题目策略或把累计夹到新限额后遗失差值。新规则在普通使用/日锁/失败测验阶段可立即生效；正在答题或休息则明确待生效，当前轮仍按固定原规则结束，下一次允许使用前应用新规则。父母明确增加周期可调整剩余额度，但已用秒数从不减少。

- schema2根新增policy、pendingPolicy(null或完整合法policy)、dailyUsageSeconds(0..36000)；其余history/stage/global revision/round保持。view.dailySeconds显示权威实际累计；getGuardianSession返回符合现有引擎上限的投影，不可用于替代实际账本展示。
- set_policy命令payload严格为{policy}，七个现有规则及可选version1，不接受额外字段/非法门槛/科目。一般commitGuardianCommand拒绝该类型PARENT_AUTH_REQUIRED；可信纯reducer内部仍可迁移，UI必须经家长网关。
- 普通session立即更新policy、按actual+cycle重新计算AVAILABLE/CHALLENGE_REQUIRED/DAILY_LOCKED。限额低于已用即锁，但权威累计不截断；再次提高限额不会取回已用额度。
- quiz active/rest保存pending，当前题目/评分/通过阈值和休息要求不变；最后失败时应用pending但保留原失败quiz/历史，新测验用新规则；通过后待原休息完成再应用。待生效可替换，提交与active相同规则可取消。
- 已失败quiz可保留原policy的固定快照，与新的active policy并存；当前派生session清理已归档挑战后按新policy/实际累计计算。合法使用事件可从该完成状态迁移为普通session，不重记历史。
- complete_rest回执原证明保持原policy；恢复时按当前active policy与权威累计投影，与新session核对。record_usage仅在实际允许时按engine实际计入delta更新actual；roll_day只清权威日累计，保留周期/当前题目/休息/pending。
- getGuardianPolicyStatus返回activePolicy/pendingPolicy/effect，effect=active/after_current_challenge/after_current_rest；公共view增加policyPending。学习历史分数/原通过阈值不随设置修改。
- schema1先由冻结只读validator严格验证，再在内存补policy/actual/pending并转schema2；ID/revision/round/历史不变。read/inspect/backup不重写旧库；下一次成功CAS写schema2。旧版本无法读schema2应失败，不新建账本。SQLite guardian表仍user_version1，payload metadata支持1/2。
- commitParentPolicyChange(store,authorizer,token,command)：只允许set_policy；捕获输入、授权scope检查后读已提交状态，迁移+编码，第二次授权核对scope/version，然后CAS(lifecycleId,revision)。确认后返回公开view+settings；原命令重试无双写，写后应答丢失重读receipt。两个数据库之间无跨库授权事务；CAS前的最后成功授权为授权检查点，不承诺撤销已被接受的提交。
- 不增加HTTP/系统恢复或父母临时放行；native存储/SDK/真实平台输入仍未验收。默认120分钟不变，周期/上限改变必须来自验证后的家长请求。

## Global Constraints

- dev6d9eb22（PR21已合并），独立feature分支，不合并master。
- 不改已验收浏览器MVP、原生UI或领域session/quiz/rest schema1。
- 不接受client proof boolean，不把相同成绩按新门槛追溯判成通过。

## Review Focus

- 降限再升限/多次改规则不减少已用秒数，不多发资格。
- 题目/阈值或休息中改配置只影响下一轮，原休息未完成不能放行。
- 跨日/pending/失败重练/历史仍关联原日期/原策略，无丢题或重记。
- 旧库迁移严格校验、不改revision/ID，不接受损坏schema2或使旧备份自动恢复额度。
- 无授权/跨家庭/读取中撤销、并发设置和提交未知不得写设置或反馈成功。

### Task 1: Policy lifecycle and migration

**Files:** shared/domain/guardian-lifecycle.mjs、guardian-legacy.mjs（冻结只读v1）、lifecycle-controller.mjs、guardian-policy.test.mjs；旧版本测试将未知version更新为3；sqlite_worker.py支持payload1/2。
- [x] 写立即/待生效/取消/失败/原休息/限额反复/跨日/严格迁移/损坏测试，先失败。
- [x] 实现schema2及安全投影，完整原业务回归通过。

### Task 2: Authorized commit and real reference integration

**Files:** shared/domain/parent-policy.mjs/.test.mjs、tests/sqlite-policy.test.mjs、apps/node-reference/parent-demo.mjs、文档/报告。
- [x] 写拒绝普通入口、前后授权/家庭scope、并发CAS/应答丢失、真实凭据+旧SQLite迁移测试，先失败。
- [ ] 实现并接现有demo:parent；独立审查/修复、全量测试/示例、dev PR/CI、源码交付。

## Execution ledger

- 基线npm test188/188通过；策略变更生效时机为本轮工程决定，输出明确active/pending供UI解释；不回溯修改已答评分或已有休息证据。

- 全量回归修复：缺失schemaVersion的损坏记录被误分类为UNSUPPORTED_VERSION，既有controller测试捕获；恢复为INVALID_LIFECYCLE，未知显式版本仍拒绝，未更改旧验收期望。

- Task1/2 code: 新增规则10/网关7/真实SQLite3，共20项；全量208/208。旧库只读与备份原文不变，成功CAS后才schema2；真实PIN写入/应答丢失重试/注销拒绝已验证。

- Final review: no blocking findings; 独立20项通过，并额外验证active quiz跨日pending的通过/失败和序列化。文档/报告已完成，待最终示例/PR/CI。

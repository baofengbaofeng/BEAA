# SQLite Recovery Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, with a final independent review.

**Goal:** 修复凭据库中断恢复，保证拒绝其他库前不改变其文件。
**Architecture:** 复用题库已有格式初筛，集中到SQLite共享辅助函数，各worker显式指定自身appid/版本/错误码；保留全量后校验与明确只读inspect。
**Tech Stack:** Node20+ tests、Python3.11+/Linux SQLite现有参考端口，无新增依赖。
**Spec:** docs/superpowers/specs/2026-11-06-sqlite-recovery-isolation-design.md

## Global Constraints
- schema/公开API不变，不重置账本/凭据/题库，不自动认证家长；M1与原生源码不变。
- 恢复仅正确格式的既有库；新文件仍exclusive创建；inspect不恢复热日志。
- 误传库在连接前拒绝；头部不是认证，仍做完整表/内容校验。

## Review Focus
- parent状态查询中断后无法重新打开：真实热日志+原PIN/失败次数保持回归。
- 3类库错误方向：6种组合校验数据库及journal哈希保持。
- 共用helper误伤新文件初始化/备份：既有创建/备份全量回归。
- 只读检查误触恢复：自有热日志inspect不变，正常打开后可检查。
- 未知schema/WAL与错误码：各类库分别拒绝且不创建辅助文件。

### Task 1: 三库连接前隔离和凭据恢复
**Files:** apps/node-reference/sqlite_worker.py、parent_auth_worker.py、question_bank_worker.py；tests/sqlite-recovery-isolation.test.mjs与helpers/sqlite-hot-journal.py；接口/测试文档。
**Interfaces:** validate_header(path,application_id,schema_version=1,corrupt_code='CORRUPT_STORE',unsupported_code='UNSUPPORTED_STORE')，没有新公开服务API。

- [x] 先补实际凭据热日志/跨库错误打开测试，运行并复现问题。
- [x] 提取通用格式初筛并接入各worker；parent状态读支持恢复；保持只读inspect和新目标创建；针对测试通过。
- [x] 完整Node/浏览器回归与既有示例、实际SDK预检；独立审查并补必要红绿修复，保存证据。
- [ ] 提交dev功能PR并验证CI；不合并或部署。

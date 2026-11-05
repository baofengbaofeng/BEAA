# SQLite Backup and Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为SQLite参考存储增加并发安全的一致备份和只读检查，不自动回滚现有使用账本。
**Architecture:** 复用既有安全路径/格式/摘要校验，SQLite Online Backup API从已验证读事务复制到独占新文件；Node完整codec再核验。检查使用mode=ro，仅返回ID/revision/快照摘要，既有controller/CAS契约不变。
**Tech Stack:** Node20+、Python3.11+/标准库SQLite、POSIX，无新增依赖。
**Spec:** 以下契约，延续apps/node-reference/README.md。

## Design / Approaches

采用SQLite备份API，而非文件复制（避免活跃事务/journal半状态）或JSON重建数据库（保留格式并由SQLite保证一致性）。本轮只做备份/检查，旧副本不自动替换较新账本；真正恢复需独立解决已用额度、防回放与授权，防止恢复旧额度。

- 存储端口增加backup(targetPath)，不更改源revision/回执。目标必须新文件，同样要求私有目录与可信祖先链；既有文件、源自身、符号/硬链接路径均不得覆盖。
- Node先完整读取/验证来源，Python在一个固定读事务中核验来源摘要/metadata，再用Connection.backup复制至独占0600目标文件；核对目标内容等于该事务快照，Node再完整解码。来源忙/损坏/不安全或目标错误明确拒绝。
- inspectSqliteLifecycleBackup(path,options={})使用只读SQLite连接，不提交领域事件或写数据库，只返回{lifecycleId,revision,snapshotSha256}；不输出题目/答案/学习记录。摘要用于一致性检查，非认证/加密。
- Python新增backup(target)/inspect协议，复用无shellstdin、10秒超时/32MiB限制与固定错误码。失败/超时可能留下不完整目标，保留诊断、不覆盖、不自动重试或恢复。
- CLI：backup:sqlite -- --source PATH --target NEW_PATH；inspect:sqlite -- --source PATH。严格参数，成功stdout只含JSON metadata，错误stderr仅固定代码/消息，不回显载荷/路径。
- 备份可能落后当前revision；检查成功仅表示该副本一致，不证明它是最新、真实或允许继续使用。无restore/failover功能，不提供旧副本自动建账或放行。
- npm run demo:sqlite增加实际备份/只读检查；所有数据库仍临时清理，不打包用户数据。原生/设备/断电门禁不变。

## Global Constraints

- dev基线d0ebe56（PR19已合并），独立feature分支，不改/合并master。
- 不改浏览器MVP或原生UI，不宣称云端备份即原生备份/恢复。
- 仍要求可信本地调用者、私有路径；权限与摘要不防同UID/root修改或回放。

## Review Focus

- 有未提交writer时备份应读一致的旧提交，不能抄入半成品。
- 并发已提交更新与备份应对应同一完整revision，来源不被改写。
- 既有目标/源文件/链接不覆盖；不安全目标和损坏来源不默默生成可用副本。
- 只读检查不得修改数据库或泄漏私有内容，旧副本检查不得回滚当前账本。
- CLI缺失/重复/非法参数、备份超时/失败不能伪装成功或执行自动恢复。

### Task 1: Backup API and real database tests

**Files:** apps/node-reference/sqlite-store.mjs, apps/node-reference/sqlite_worker.py, tests/sqlite-backup.test.mjs。
**Interfaces:** store.backup(target), inspectSqliteLifecycleBackup(path,options?)。
- [x] 写完整备份/并发/未提交writer/只读/目标拒绝/损坏来源测试并观察失败。
- [x] 实现SQLite事务备份和codec校验，针对与全量测试通过。

### Task 2: CLI and delivery

**Files:** apps/node-reference/backup.mjs, apps/node-reference/demo.mjs, package.json, README/集成/里程碑/报告与原始输出。
- [x] 写CLI参数/metadata/错误隔离测试并先失败，再实现；示例实际备份/检查。
- [ ] 独立审查、必要修复、全量测试/示例、dev PR与CI、源码打包。

## Execution ledger

- 基线npm test160/160通过；保留存储schema1、初始create仅revision0和既有CAS接口，不新增自动恢复。

- 测试夹具修正：创建0755目录受当前umask收紧成0700，显式chmod0755后准确验证不安全目标；未修改生产权限要求。

- Task1/CLI complete: 新增10项与全量170项通过，SQLite示例备份8、主库12未回滚。独立审查进行中；备份失败保留目标，不新增恢复入口。

- Final review: no blocking findings; independent new10/10 + existingSQLite14/14通过，文档/报告完成。准备dev PR、CI和源码打包。

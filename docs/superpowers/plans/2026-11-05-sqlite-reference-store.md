# SQLite Reference Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为统一生命周期提供可运行的云端SQLite参考端口，验证真实多进程CAS与提交前/后进程中断恢复。
**Architecture:** apps/node-reference/sqlite-store.mjs通过无shell的Python标准库helper调用SQLite。每次CAS在BEGIN IMMEDIATE内读取/核对lifecycleId+revision、更新整份JSON并COMMIT；持久化配置DELETE journal和synchronous=FULL。共享业务接口不变，参考适配器不冒充原生后端。
**Tech Stack:** Node20+、POSIX、Python3.11+标准库sqlite3，无新npm依赖。
**Spec:** 以下设计契约及docs/development/NATIVE_INTEGRATION.md生命周期端口。

## Design / Approaches

相较自行维护文件锁和stale-lock恢复，选SQLite事务来处理真实跨进程竞争；相较Node内建sqlite（需新Node版本）或原生npm扩展，Python标准库兼容当前Node20与现有云/CI。用户授权连续实现，本轮限于参考存储及其实际证据，不改平台权限/产品决策。

- createSqliteLifecycleStore(path,initial,{python='python3'}={})仅创建新文件、initial必须合法且revision0。已有文件绝不覆盖；创建失败保留文件供诊断，不自动重建。openSqliteLifecycleStore验证已有数据库，缺失/损坏/未知schema拒绝。
- 返回端口read()->完整JSON、compareAndSwap({lifecycleId,revision},text)->boolean；新快照先由共享codec严格校验，必须同lifecycleId且revision=expected+1。端口内部事务再次核对当前身份/修订号，冲突false；异常提交结果可能未知，由controller重读同命令重试。
- Python helper只接收固定initialize/read/cas JSON协议，状态走stdin而非argv；SQL使用绑定参数，stdout仅协议JSON，错误固定代码不泄露载荷/路径/原始SQL。Node无shell启动、总超时10秒、输出/输入限32MiB，进程失败不当作成功。
- 数据库application_id与user_version固定，单行guardian_state(lifecycle_id,revision,payload,sha256)；完整UTF16文本上限8,000,000。读/CAS核对摘要与JSON metadata一致，再由Node完整解码。SHA256仅检查损坏，不是认证或防回滚。
- 私有目录必须当前UID拥有、无group/other权限，非符号链接；数据库必须同UID普通单链接文件、无group/other权限，新建0600。拒绝不安全路径/硬链接/符号链接，不自动改用户权限。受保护原生存储/加密与授权仍需平台实现。
- SQLite DELETE journal、FULL同步、busy timeout2秒；数据库元数据/row缺失或不匹配明确报错，无默认初始化/清空逻辑。SQLite忙和helper超时不自动重试。
- 原生生产存储、真实Usage/Rest/Calendar输入、SDK/签名/设备验收不在本轮。进程SIGKILL不是断电/硬件持久性验收；FULL取决于文件系统实现。

## Global Constraints

- dev基线2942d10（PR17已合并），独立feature分支，不合并master。
- 不修改浏览器MVP、guardian业务契约或原生UI，不声称参考数据库即原生可用。
- 所有测试数据库位于私有临时目录；不修改外部用户数据库。

## Review Focus

- 多个独立Python进程竞争同一revision只能一个提交，不能丢历史/休息迁移。
- 写后响应丢失需从真正数据库读取回执，不能二次归档或放行。
- 提交前SIGKILL保留旧快照，提交后SIGKILL恢复新快照；两者日累计/历史一致。
- 缺失/损坏/未知数据库或不安全路径不自动重建、不覆盖已有内容。
- Node/Python协议、Unicode、超时、数据库锁或非法新revision不能被当作CAS成功。

### Task 1: Reference backend and real transaction tests

**Files:** apps/node-reference/sqlite-store.mjs, apps/node-reference/sqlite_worker.py, tests/sqlite-store.test.mjs, tests/helpers/sqlite-crash-writer.py。
**Interfaces:** SqliteStoreError, createSqliteLifecycleStore, openSqliteLifecycleStore。
- [x] 写创建/权限/打开/损坏、并发/真实ACK丢失、SIGKILL前后恢复、非法revision、锁争用等测试，确认先失败。
- [x] 实现Node端口与Python事务helper，针对/全量npm test通过，保留真实Python/SQLite版本与测试输出。

### Task 2: Runnable reference demo and delivery

**Files:** apps/node-reference/demo.mjs, apps/node-reference/README.md, package.json, .github/workflows/domain-tests.yml, 根README/原生集成/里程碑/测试报告。
- [x] 新增npm run demo:sqlite，使用单个真实数据库跑答题/休息/恢复与重复回执；CI执行该命令。
- [ ] 独立审查、必要修复、完整测试/两种demo、文档及源码交付，dev PR/CI，不合并。

## Execution ledger

- dev PR17已合并；基线npm test146/146通过，环境Python3.12.14/SQLite3.53.1。保持Node20兼容及现有共享controller接口。

- 兼容性明确：Python3.11+，因为SQLite结构化错误码用于锁争用诊断；当前验证3.12.14，不承诺3.9/3.10。初始创建仅revision0，测试通过真实controller事件推进到故障边界，没有绕过该约束植入任意版本。

- Task1 complete: 新增13项真实SQLite/进程测试通过，含10秒helper超时；全量159/159、两种demo均通过。Task2独立审查中。

- Final review fixed: ancestor trust — 可写非sticky祖先与中间符号链接回归实际RED→GREEN；验证整个祖先链信任root/根挂载所有者/当前UID且共享可写须sticky，直接父目录继续私有。最终14项SQLite/全量160项。

- 环境兼容：云环境/与/tmp显示UID65534（用户命名空间映射），不是数值0；可信祖先身份从进程根挂载所有者建立根信任，同时保留0/当前UID。可写非sticky目录仍拒绝；不防根挂载所有者/同UID攻击。实际模式/UID已核查。

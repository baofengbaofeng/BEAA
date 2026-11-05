# Parent Authentication Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增加可验证的本地家长PIN/短时授权参考服务，并以真实授权保护学习报告查询。
**Architecture:** 独立auth SQLite数据库保存PBKDF2摘要/失败冷却/凭据版本，Python事务核对PIN与并发失败计数；Node内存仅保存随机token摘要和单调到期信息。共享parent-report.mjs消费authorizer接口，前后核验授权及账本scope；不改变guardian状态/schema/额度。
**Tech Stack:** Node20+ crypto/performance、Linux Python3.11+ hashlib/sqlite3及/proc启动标识，无新依赖。
**Spec:** 以下契约与既有家长验证/学习报告要求。

## Design / Approaches

沿用已有6–12位数字PIN和5分钟授权习惯；参考后端采用PBKDF2-HMAC-SHA256 600,000次、随机16字节salt、32字节摘要；5次失败冷却5分钟。相比浏览器localStorage方案，计数由真实数据库事务持久化，授权token不落盘；相比假定可用的原生安全API，本轮明确限定Linux参考实现，保留通用authorizer接口。

- createParentAuthService(path,lifecycleId,pin,options?)独占建立新0600 auth库，仅6–12位ASCII数字；openParentAuthService(path,options?)读取既有合法库，损坏/缺失不自动初始化或重置。
- auth库application_id与guardian不同、user_version1；单行记录绑定lifecycleId、credentialVersion>=1、salt/digest、failures0..5、bootId、lastSeenMs、blockedUntilMs。复用私有目录/祖先链检查。PIN仅stdin传输，不存明文或进argv/日志。
- login(pin)：BEGIN IMMEDIATE内校验记录、当前Linux启动ID/单调时间，锁定时不校验PIN；匹配后清失败，否则递增计数并持久提交，5次锁定。进程重开不能重置失败计数；启动改变且已锁定，或单调回退，保守重建完整冷却，不按墙钟跳过。
- 冷却基于Python time.monotonic与/proc/sys/kernel/random/boot_id，不接收UI时间，不退化为Date.now。auth参考限定Linux；SQLite生命周期端口仍保留POSIX范围。
- 成功login返回256bit随机opaque token、expiresInSeconds300。仅当前service实例持有SHA256 token索引，最多16个，Node单调clock计5分钟；重开服务/进程不恢复旧token。clock作为可信依赖可注入测试，非用户命令；回退清授权并拒绝。
- authorize(token)在读取credentialVersion前后核对token存在/到期、scope与版本；logout删除当前实例token，读取中的logout也需被看见。changePin(token,newPin)需有效授权及期望credentialVersion事务更新，版本+1使其他实例旧token也失效；成功后当前实例清所有token。无未授权重置入口。
- 返回身份只含{lifecycleId,credentialVersion}，不返回PIN摘要/salt/冷却内部状态。服务不是系统账号/原生安全存储，不能防同UID/root读取或篡改数据库/回放。
- shared/domain/parent-report.mjs的getParentLearningReport(store,authorizer,token,query={})前后authorize，检查scope与凭据版本，返回completed history的stats/records/wrongAnswers及账本revision，不暴露未答题快照。授权失败不得读或返回报告，异步读取期间失效/注销/换PIN拒绝。
- Node/Python子进程通用传输抽出为内部python-worker.mjs，保留既有限时/限制/错误固定化；原SQLite端口行为不变。auth worker复用路径/连接基础设施，不复用guardian schema、备份或恢复接口。
- demo:parent使用两个临时私有DB跑登录/受保护报告/注销或换PIN，不打印PIN/token/hash；时间/学习数据仍为合成。原生SDK/密钥库/身份授权/设备门禁不变。

## Global Constraints

- dev8ad47df（PR20已合并），独立feature分支；不改master、不扩展已验收浏览器MVP。
- 不新增HTTP/RPC或外部账号，不让儿童提供auth proof boolean/时间作为认证。
- 同UID/root、备份回放、密码遗忘恢复和生产账户管理未解决；不宣称原生安全验收。

## Review Focus

- 并发错误PIN与重开服务不能绕过持久5次冷却；正确PIN在锁定中也不能登录。
- token到期、注销、跨实例、换PIN、单调回退或异步读期间失效不能释放报告。
- 家长凭据绑定生命周期ID，不能拿A家授权读取B家历史；未答题答案不泄漏。
- 凭据损坏、后端异常、版本耗尽、输入非法不能清空失败或初始化替代库。
- PIN/salt/hash/token不得出现在演示输出或报告；凭据DB不进入guardian备份/源码包。

### Task 1: Credential/token reference and tests

**Files:** apps/node-reference/parent-auth.mjs, parent_auth_worker.py, python-worker.mjs（共享内部传输）, sqlite-store.mjs小幅重用；tests/parent-auth.test.mjs。
**Interfaces:** ParentAuthError, createParentAuthService, openParentAuthService；service.login/authorize/logout/changePin。
- [x] 编写KDF/盐/失败/并发/重开/冷却与启动变化、token到期/撤销/换PIN、损坏/范围/时钟测试，先失败。
- [x] 实现实际事务与短时token，再跑针对及完整npm test。

### Task 2: Authorized report and delivery

**Files:** shared/domain/parent-report.mjs/.test.mjs, apps/node-reference/parent-demo.mjs, package.json/CI、README/集成/里程碑/验证报告。
- [x] 编写无授权不读报告、跨scope、读取中撤销与已答题数据边界测试，先失败再实现。
- [ ] 实际参考auth+ledger示例，独立审查/修复、完整验证、dev PR/CI及源码交付。

## Execution ledger

- 基线npm test170/170通过；既有guardian/schema与SQLite文件格式不变，auth独立新文件，授权不增加使用资格。

- Task1/2 code: auth12/report6新增18项，全量188/188；双库demo通过，不输出秘密。独立审查目标18/18通过，无阻断问题。文档完成，待最终验证与PR/CI。

- Final review: no blocking findings within trusted-local reference scope；独立auth/report18/18通过。原有demo/demo:sqlite均通过，家长示例已接CI。准备dev PR/CI及源码交付。

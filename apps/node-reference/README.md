# SQLite 生命周期参考存储

这是Node/Python云端参考适配器，用真实SQLite事务实现共享生命周期的原子存储端口。**不是原生客户端、ArkTS模块或设备管控后端**，所有演示使用/休息输入仍为合成数据。

## 环境与运行

要求Node.js20+、Python3.11+（含标准库sqlite3）及POSIX文件权限。本轮在Linux、Python3.12.14/SQLite3.53.1验证；未验证Windows或原生平台。

仓库根目录运行：

```bash
npm ci
npm test
npm run demo:sqlite
```

demo自动创建0700临时目录及0600数据库，使用真实controller完成答题/休息、重开数据库恢复与最近命令重试，结束清理。没有新增npm/Python依赖；原有`npm run demo`仍演示单进程JSON文件端口。CI也执行SQLite示例。

## API

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuardianLifecycle } from '../../shared/domain/guardian-lifecycle.mjs';
import { commitGuardianCommand } from '../../shared/domain/lifecycle-controller.mjs';
import { createSqliteLifecycleStore, openSqliteLifecycleStore } from './sqlite-store.mjs';

const directory = mkdtempSync(join(tmpdir(), 'guardian-private-'));
const path = join(directory, 'guardian.sqlite3');
const initial = createGuardianLifecycle('unique-ledger-id', policy, trustedDayKey);
const store = await createSqliteLifecycleStore(path, initial);
const result = await commitGuardianCommand(store, trustedCommand, { bank: trustedQuestionBank });
const reopened = await openSqliteLifecycleStore(path);
const text = await reopened.read();
```

- `createSqliteLifecycleStore(path, initial, {python='python3'}={})`只创建新文件，initial须通过共享快照校验且revision为0。已有文件报ALREADY_EXISTS，绝不覆盖。不得用create替代失败恢复；创建中断留下的空/不完整文件也保留，需诊断处理。
- `openSqliteLifecycleStore(path, options)`打开并完整校验现有数据库；不存在、损坏或未知schema不自动创建/清空。
- 返回`read()`和`compareAndSwap({lifecycleId,revision},newText)`端口；新文本须同lifecycleId且revision恰为expected+1，并通过完整共享业务校验。SQLite事务内再核对当前身份与revision，匹配才写整份文本并COMMIT，不匹配返回false。
- 题库、命令身份、使用/日期/休息真实性仍由可信应用服务管理。数据库含标准答案和儿童学习记录，应放在当前UID拥有的私有目录；长期数据建议使用已忽略的`local-data/`子目录并限制权限，勿提交数据库或备份。

## 实现与失败处理

Node通过无shell子进程调用固定Python helper，状态从stdin传输，不放在argv；SQL使用绑定参数。每次调用独立连接，CAS用`BEGIN IMMEDIATE`串行化真实跨进程写入，DELETE journal与`synchronous=FULL`，锁等待2秒。数据库持有固定application_id/user_version及单行payload、lifecycleId、revision、SHA256；读和CAS核对摘要/metadata，Node再校验完整领域载荷。

新文件0600；父目录必须当前UID拥有、没有组/其他用户权限、非符号链接；文件也必须同UID、普通单链接且无组/其他用户权限。不自动修正用户现有权限。整个祖先链也必须为root或当前UID拥有的真实目录，组/其他用户可写的共享祖先只有设置sticky位才接受；拒绝任何祖先符号链接或可被其他UID替换的路径。此检查防止意外暴露/路径误用，不防能修改目录/数据库的同UID攻击者；摘要仅检测损坏，**不是认证、加密或防回滚**。

Node总超时10秒、协议输入/输出上限32MiB，载荷沿用8,000,000个UTF16码元限制。错误仅固定代码/消息，不返回原始SQL、载荷或路径。`SqliteStoreError.code`包含INVALID_REQUEST、INVALID_SNAPSHOT、ALREADY_EXISTS、STORE_MISSING、UNSAFE_STORAGE、UNSUPPORTED_STORE、CORRUPT_STORE、STORE_BUSY、STORE_IO、BACKEND_UNAVAILABLE、STORE_TIMEOUT、PROTOCOL_ERROR、UNSUPPORTED_PLATFORM。

CAS异常/超时可能发生在提交前，也可能是提交后响应丢失；不要默认重建账本。保留原命令，使用统一controller重读并重试；若最近receipt已提交返回duplicate。冲突/锁等待不自动换答案或重复事件。操作系统实际限制/恢复必须等确认提交并核对权限后再执行，duplicate不能重复发资格。

## 已验证与边界

测试使用独立Python进程并发CAS；真实事务在COMMIT前SIGKILL后恢复旧状态，在COMMIT后SIGKILL恢复完整新阶段/历史/回执。另覆盖锁争用、已提交应答丢失后重开、损坏/版本拒绝、不安全路径、非法metadata和辅助进程故障/超时。

SIGKILL事务边界由**测试专用writer**控制，不是生产helper的故障开关。它验证Linux/SQLite的实际事务恢复，不能证明真实断电、磁盘控制器缓存、文件系统失效或目标平板行为。FULL同步仍依赖底层文件系统；本轮不提供生产备份/迁移、加密、认证、防回放、原生SDK、签名或真机验收。

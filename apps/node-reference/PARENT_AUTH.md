# 家长PIN与短时授权参考服务

本地Linux/Node参考实现，为共享学习报告提供真实PIN校验和短时授权；不是系统账号、原生安全存储或设备管理员认证。本轮没有改浏览器MVP，也未接原生UI或设置写入/临时放行。

## 运行

需要Node20+、Linux、Python3.11+、标准库sqlite3及可读的`/proc/sys/kernel/random/boot_id`：

```bash
npm test
npm run demo:parent
```

示例用私有临时目录创建独立guardian/auth数据库，演示未授权拒绝、登录查询、注销、换PIN撤销及重新登录；不打印PIN、token、盐或摘要，结束清理文件。学习/使用记录是合成数据。

## API与接入

```js
import { createParentAuthService, openParentAuthService } from './parent-auth.mjs';
import { getParentLearningReport } from '../../shared/domain/parent-report.mjs';

// 仅由可信首次家长设置流程调用；不得把open失败自动转换为create。
const auth = await createParentAuthService(newPrivateAuthPath, lifecycleId, parentPin);
const reopened = await openParentAuthService(existingPrivateAuthPath);
const login = await auth.login(parentPin);
const report = await getParentLearningReport(guardianStore, auth, login.token, { grade: 3 });
auth.logout(login.token);
```

- PIN为6–12位ASCII数字，不裁剪或接受全角数字。PBKDF2-HMAC-SHA256固定600,000次、每份凭据随机16字节盐/32字节摘要；明文PIN只作为当前请求输入，经stdin传递，不落盘/argv/日志。
- 独立auth SQLite文件0600，私有目录与可信祖先规则沿用主库。不同application_id/schema防止当成学习账本读取或导出；不提供凭据备份/恢复/遗忘PIN重置入口。哈希、盐、失败计数等不通过服务API返回。
- `login(pin)`在事务内核对PIN，成功返回`{token,expiresInSeconds:300}`；五次错误后冷却五分钟，锁定期间正确PIN也拒绝。计数真实持久化，重开服务不重置；并发失败在同一事务序列中累计。
- 冷却使用Linux启动标识和Python单调时间，不接受UI时间或墙钟差；已锁定记录遇启动变化重建完整冷却，单调回退保守锁定。测试通过模拟持久化时钟状态验证这些分支，没有实际重启/睡眠五分钟。
- token为32字节随机值，服务实例仅持有其SHA256索引、scope/version及单调到期时间，最多16个；授权不续期，重开实例/进程不恢复旧token。持有原token视为持有短时访问能力，应由可信界面内存保管。
- `authorize(token)`读取当前凭据版本并在异步读取前后检查到期/注销，返回`{lifecycleId,credentialVersion}`。失败冷却不撤销此前已验证的短时token；token仍受到期、注销、版本变化约束。
- `changePin(token,newPin)`先验证当前授权，再以期望凭据版本事务更新，版本+1后其他实例旧token也被撤销；当前实例清所有token。新PIN需重新登录。此操作仅更改凭据，不更改使用账本或学习记录。
- `logout(token)`删除当前实例对应token。授权过程中发生注销也不能继续返回成功。`options.clock`是可信单调时钟依赖（默认performance.now），仅供平台接入/测试，绝不能从用户请求传入；回退或非法值会清授权并拒绝。

`ParentAuthError.code`包含INVALID_PIN、PARENT_PIN_INVALID、PARENT_LOCKED、PARENT_UNAUTHORIZED、PARENT_EXPIRED、PARENT_REVOKED、PARENT_CLOCK_ERROR、PARENT_VERSION_EXHAUSTED及固定存储/协议错误。缺失、损坏、未知凭据库不会清空失败计数或初始化替代凭据；更改结果未知时不能假定旧授权仍有效。

## 受保护的学习报告

`shared/domain/parent-report.mjs`的authorizer是可信服务依赖，不是UI提供的boolean或自报proof。读取前后均验证scope/credentialVersion，跨家庭或读取期间失效/注销/换PIN时拒绝。报告只含已完成记录的stats、records、wrongAnswers及账本revision/日期；当前未答题快照不返回。query支持日期/年级，与原学习统计相同，异步期间改动输入不改变本次查询。

该函数不增加使用资格、不修改任何账本，也不将验证结果当作系统已解锁。未来设置写入/临时授权应经过同类可信应用服务及独立规则，不得开放Python worker协议或把自报grant当作认证。

## 安全与验收边界

私有文件/摘要不提供加密、同UID/root隔离或防回滚；数字PIN熵有限，不能替代原生密钥库与系统身份。此服务不验证操作者年龄，首次设置需要可信家长初始化流程；删除/修改本地文件的同UID攻击不在参考安全边界内。

token按当前实例的单调时钟到期，未验证真实设备休眠/恢复行为。原生移植需选择满足生命周期语义的可信时钟，或在后台/恢复时主动清授权，并核对平台能力；不能凭云端测试宣称支持真机安全存储、设备重启、断电或权限防绕过。Linux /proc时钟也不是HarmonyOS/iPadOS已验证API。

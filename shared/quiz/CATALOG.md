# 受保护的离线题库目录

共享题库的`validateQuestionBank/selectQuestions`负责内容结构与组卷；`catalog.mjs`增加按家庭使用账本归属的版本化离线目录。`question-bank-service.mjs`提供家长验证后的原子导入，以及使用目录开始新一轮测验的可信服务入口。Node20+ ESM原型，不是ArkTS或原生安全存储实现。

## 目录和保存格式

```js
import {createQuestionBankCatalog,encodeQuestionBankCatalog,decodeQuestionBankCatalog} from './catalog.mjs';
const initial=createQuestionBankCatalog(lifecycleId,validatedBank);
const text=encodeQuestionBankCatalog(initial);
const restored=decodeQuestionBankCatalog(text);
```

schemaVersion=1，字段为lifecycleId/revision/bank/lastImport。lifecycleId为1–96码元无首尾空白字符串，eventId最多128码元；revision为非负安全整数。初始revision0/lastImport=null，后续lastImport含eventId/expectedRevision，后者必须等于revision-1。严格拒绝未知目录字段、不支持版本、空/损坏题库与不一致回执；规范化JSON编码按对象键排序，数组顺序保留，避免把不同题目顺序当作同一内容。

完整目录编码最多2,000,000 UTF16码元；每道题和1–2000题总量限制沿用[题库格式](README.md)。题目仍需可信内容审核，结构通过不代表答案正确、难度适宜或覆盖完整课程。内置只有三年级5道流程样例，不是完整小学题库。

## 导入服务

```js
import {commitParentQuestionBank} from '../domain/question-bank-service.mjs';
const result=await commitParentQuestionBank(bankStore,authorizer,parentToken,{
 lifecycleId,eventId:'unique-import-id',expectedRevision:0,
 type:'replace_bank',payload:{bank:newBank}
});
```

bankStore必须提供read()→已提交目录文本，以及compareAndSwap({lifecycleId,revision},wholeText)→boolean。CAS同一原子操作比较两个字段并保存完整下一版，不能先读后无条件写。目录初始化只能由可信宿主完成；后续UI/RPC入口必须使用家长网关，不能暴露存储端口或纯reducer。

authorizer是可信服务依赖，authorize(token)返回经实际身份验证的{lifecycleId,credentialVersion}，不是调用者自报boolean/proof。网关在读取前和提交前验证授权、家庭和凭据版本；捕获输入避免验证期间被调用者修改。最后一次授权为接受点，独立凭据库与目录不是跨库事务，不能撤回已经接受的写入。保存不读写使用账本，不清除进度、错题、休息或每日累计。

最近一次相同eventId/expectedRevision/规范化bank重试返回duplicate且不再次写入；同ID不同内容报EVENT_REUSE，过期修订或CAS竞争报CONFLICT。这里只保存最后一次回执，不是永久幂等日志；宿主必须保持eventId唯一，较早重试需重读确认，不能无条件覆盖。提交应答丢失报STORE_FAILURE，重读并用**同一命令**重试。授权过期/换PIN后重试仍需重新验证，不能拿旧回执绕过家长认证。

结果只含outcome、lifecycleId、revision以及题量/各年级学科覆盖数，不导出标准答案或凭据。summarizeQuestionBank也可单独获取六个年级的语数英题量；零覆盖表示没有对应题，不是自动补题。

## 开始测验和正在答题的快照

```js
import {beginQuizFromQuestionBank} from '../domain/question-bank-service.mjs';
const view=await beginQuizFromQuestionBank(guardianStore,bankStore,beginQuizCommand);
```

只允许既有begin_quiz命令。先检查已提交账本是否有该开始命令的最近回执；若有，由现有controller核对完整命令后返回duplicate，不依赖之后的目录是否可读。新的开始请求一次读取、校验并固定目录题库，再交给既有controller按策略/知识点组卷并CAS。跨家庭、目录损坏、题数不足或账本冲突不改账本，不默认放行，不重复凑题。

之后答题、恢复和归档**只用已固定题快照**，不再查询可变目录。目录读取后并发导入允许本轮继续使用已读取版本，下一次新开始读取新版；这不是题库与账本的跨库事务。返回原有公开测验视图，不把当前目录revision误标为原测验历史来源版本；当前模型没有持久化这一版本关联，固定题目与答案才是评分依据。

## 参考SQLite和运行

`apps/node-reference/question-bank-store.mjs`提供createSqliteQuestionBankStore(path,initial)与openSqliteQuestionBankStore(path)。专用question_bank表、独立application_id=0x42454151、schema user_version1，不能与guardian/auth数据库混用。使用已有私有路径检查、独占新文件、0600、DELETE journal、FULL同步、BEGIN IMMEDIATE CAS与SHA256损坏检测。读取前先通过三类参考库共用的辅助函数核对受保护文件的SQLite头部、专属application_id/版本/DELETE格式，再用可恢复连接读取：必要时由SQLite回滚未提交事务，之后完整校验表与目录。误传其他应用的热日志数据库时，在连接前拒绝，不触发其恢复。逻辑读取可发生事务恢复，不能描述为物理只读。损坏/未知/缺失不自动初始化或覆盖；同UID恶意篡改或回滚不在这些保护能力内，摘要不是认证。

`npm run demo:bank`需要POSIX、Node20+、Python3.11+，会创建并清理独立的guardian/auth/bank临时数据库，实际PIN验证后导入并重开，原轮按旧题完成，新轮使用新版，累计使用与历史保留。使用和休息都是合成输入，没有真实跨应用管控。演示不打印PIN/token或生成可发放额度的授权。

原生题库/安全存储/UI接入、真实设备权限与课程内容审核仍待验证；本轮不修改浏览器演示或承诺原生可安装。

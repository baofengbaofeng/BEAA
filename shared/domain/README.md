# 业务规则原型（Node.js）

这是纯 JavaScript 领域逻辑与单元测试，不是已经可安装的HarmonyOS应用，也不具备系统锁定权限。运行：仓库根目录执行 `npm test` 或 `npm run demo`（Node.js 20+）。

## 规则引擎

支持使用周期、每日硬上限、按题序判定、通过阈值、待生效资格与休息要求。计时事件、标准答案、日期和已验证休息秒数由可信设备/题库服务提供。

`rollDay`只清零日累计，保留当前周期、答案和休息约束；每日锁解除后仍按保留状态恢复挑战/休息，日切换不代表休息已完成。日期采用真实公历YYYY-MM-DD（0001–9999），相同/回退日期被拒绝。

`recordUsage`接收已核实秒数，单次跨周期事件可先触发挑战或日上限；平台适配器应按事件边界采样并及时执行限制。

## 版本化规则快照

`snapshot.mjs`提供SDK无关的数据契约：

```js
import { encodeSession, decodeSession, SnapshotError } from './snapshot.mjs';
// session来自engine.mjs；revision由持久化适配器管理。
const text = encodeSession(session, 7);
const recovered = decodeSession(text);
// recovered: { schemaVersion: 1, revision: 7, session: 独立深拷贝 }
```

- `validateSession(session)`检查已知字段、规则、日/周期计数、日期、题序和通过条件，返回独立副本。
- `encodeSession(session, revision=0)`产生JSON文本；`decodeSession(text)`校验版本与内容后返回封装。revision必须为非负安全整数。
- 格式为`{schemaVersion:1, revision, session}`。策略仅允许引擎使用的七个字段及可选的`version:1`；拒绝额外字段，避免将不属于规则契约的数据写入快照。
- `pendingGrant`仅允许与完整通过的`REST_REQUIRED`共存。每日上限、阶段和计数必须一致；每日锁可保存被覆盖的挑战进度，跨日后重新核对休息证据。
- 损坏、未知版本或矛盾状态抛`SnapshotError`，不会创建替代会话、归零累计或夹取非法计数。错误码：`INVALID_SNAPSHOT`、`UNSUPPORTED_VERSION`、`INVALID_SESSION`、`SNAPSHOT_TOO_LARGE`。文本最多1,000,000个UTF-16码元。

快照只验证数据一致性，不证明答案、时间或存储内容的真实性。认证/防篡改、修订号比较与CAS/原子写入、旧快照回放防护由平台存储适配器负责；revision字段本身不提供这些能力。上层遇到解码错误应保留原始记录并进入恢复流程，不能以新建会话代替失败恢复。

`npm run demo`实际使用临时文件保存/读取答题及休息快照，然后继续引擎流程并清理文件；时长和答案仍为演示输入。该模块尚未接入浏览器单文件原型或原生Preferences，也不能直接作为ArkTS模块使用；原生移植、可信休息证据及权限状态核对仍需匹配SDK和平台实现。

## 共享答题应用服务

`quiz-service.mjs`在规则引擎与共享题库之间提供纯状态迁移：

- `startQuiz(session, bank, options)`在CHALLENGE_REQUIRED时组卷，返回`{session,questions}`的attempt，固定本轮题目/答案副本。
- `getCurrentQuestion(attempt)`只返回当前题公开字段；待答题不暴露标准答案或解释。
- `submitQuizAnswer(attempt,{questionId,chosen})`从固定快照查标准答案，返回新的attempt和本题feedback；不接受客户端自报correct/expected。一次合法作答推进一题，错题本轮仍计错；通过条件由原策略决定。
- `getQuizReview(attempt)`仅返回已答题的选择、评分和解释，供复习或学习记录使用。
- `encodeQuizAttempt(attempt,revision=0)`及`decodeQuizAttempt(text)`保存/恢复规则与题目快照，恢复后不依赖当前题库文件。返回值为`{revision,attempt}`；重新核对每条已存评分与固定答案的一致性。

测验JSON为`{schemaVersion:1,domain:规则快照,quizSnapshot:{version:1,questions:题目快照}}`，长度上限仍为1,000,000码元。题库更新不改变已开始的测验。休息完成后用finishRest得到普通session，结束当前attempt；长期学习记录由记录服务保存。

attempt和测验JSON含标准答案，只由可信应用服务/受保护存储持有；界面取得公开题目、feedback和已答复习数据。该函数层不是认证RPC。原生控制层仍负责请求/事件去重、期望修订号核对、原子提交与认证，之后才能调用设备适配器。

`npm run demo`已改为从共享样例实际组卷、使用模拟选项调用服务判分、保存并恢复测验文件，再完成休息。没有直接把同一变量当作用户选项和标准答案。

## 学习记录、错题与统计

`learning-history.mjs`提供独立的教育记录接口，不读取或发放使用资格：

```js
import { createLearningHistory, recordCompletedQuiz, getLearningStats,
  encodeLearningHistory, decodeLearningHistory } from './learning-history.mjs';
// attempt必须已经答完，元数据由可信完成事件提供并在重试时保持相同。
const result = recordCompletedQuiz(createLearningHistory(), attempt, {
  attemptId: 'stable-completion-event-id', completedAt: 1793836800000
});
const text = encodeLearningHistory(result.history, 1);
const { history } = decodeLearningHistory(text);
const stats = getLearningStats(history);
```

- `createLearningHistory(limit=200)`建立独立历史，limit为1–200整数。按完成时间、事件ID升序保留最近limit轮；列表查询返回最新在前。提前到达的较旧事件不会挤掉较新记录，返回`outside_window`。
- `recordCompletedQuiz(history,attempt,{attemptId,completedAt})`仅接收答完且通过关联校验的attempt，保留题目快照、所选答案、完成日及当时通过阈值。同一保留ID/内容重试返回`duplicate`，同ID冲突抛`CONFLICT`；新增返回`added`。输入不修改。
- `listLearningRecords(history,{dayKey?,grade?})`计算每轮正确数与学习通过结果；`getWrongAnswers(history,{dayKey?,grade?,subject?,knowledgePoint?})`返回每次错答的题目、所选答案、标准答案与解释，不合并重复错答。
- `getLearningStats(history,{dayKey?,grade?})`汇总保留窗口内的轮数、通过轮数、作答/正确数、整数百分比准确率以及各学科/知识点分布。无作答准确率为null；多知识点题在每个标签各计一次，因此标签合计可能超过作答总数。过滤范围无记录时返回空统计。
- `validateLearningHistory`严格核对完整有序记录；正确率和通过结果从所选答案及原题快照计算，不保存可自报的评分字段。恢复不会查询现有题库或改变历史题答案。
- JSON格式`{schemaVersion:1,revision,history:{schemaVersion:1,limit,records}}`，最多5,000,000个UTF-16码元。即使单条合法，累计文本超过限制也会明确拒绝编码，调用方必须处理，不能静默丢记录。错误类`LearningHistoryError`，代码`INVALID_HISTORY`、`INVALID_METADATA`、`INVALID_QUERY`、`CONFLICT`、`UNSUPPORTED_VERSION`、`SNAPSHOT_TOO_LARGE`。

必须在测验刚完成、跨日或下一轮测验之前归档，dayKey取本次完成时的session日期。completedAt是显式提供的非负毫秒时间戳（不超JavaScript Date范围），不是模块核实的可信时间。外层需稳定保存完成事件ID/时间，把最后一题提交和归档放入原子事务或可靠事件队列，防止崩溃漏记。保留窗口内去重不等于长期事件去重；外层仍负责认证、CAS、长期去重和防回放。学习通过只是教育统计，不表示休息已完成、设备已解锁或日额度增加。

历史含题目标准答案和儿童学习数据，应由受保护存储/家长授权查询管理。解码失败应保留原始数据并报告恢复错误，不能清空使用账本或默认放行。`npm run demo`已实际写入、读取学习历史临时文件并输出统计；尚未接原生UI或平台持久化后端。

# 使用到期预提醒接口

`usage-reminders.mjs`根据统一生命周期计算5分钟、1分钟提示和到期事件。只有共享计算与Node/SQLite参考示例；尚未接入浏览器M1、原生UI、通知服务或真实使用采样。

## 读取提示

```js
import {getUsageGuidance, readUsageGuidance, getUsageReminderEvent}
  from './usage-reminders.mjs';
const guidance = await readUsageGuidance(store); // store.read()返回已提交生命周期JSON
// 或 getUsageGuidance(可信生命周期快照)
```

返回字段：

| 字段 | 含义 |
|---|---|
| lifecycleId / revision / round / dayKey / phase | 本次读取的账本、全局修订、测验轮次、日期与阶段；round不是通知次数 |
| cycleUsedSeconds / dailyUsedSeconds | 当前周期已用、根账本实际日累计；日累计不会因降低上限而截断 |
| cycleRemainingSeconds / dailyRemainingSeconds | 各自规则余量，最低0；阶段被阻塞时仍可有规则余量 |
| remainingUsageSeconds | AVAILABLE时取两种余量较小值；其他阶段为0 |
| limitingRule | cycle或daily_limit，相等取daily_limit；仅解释余量，不代表quiz/rest等其他阻塞原因 |
| level | none、five_minutes（剩余≤300秒）、one_minute（≤60秒）、blocked（非AVAILABLE） |
| usageSecondsUntilNextBoundary | 距下一300/60/0边界的**有效使用秒数**；blocked时null |
| advisoryOnly | 始终true，不能作为设备解除限制或使用授权 |

`usageSecondsUntilNextBoundary`不是`setTimeout`的墙钟延迟。用户息屏或使用不计入的应用时，应由可信采集源决定是否累计；本模块不采集时间，不读取`Date.now()`。休息/答题期间不安排可用时间倒计时。待生效策略沿用现有安全边界，日切换不清空周期或满足休息。

## 已提交使用迁移的事件

`getUsageReminderEvent(before,after)`接收同账本的完整快照。可信宿主应捕获before、提交原使用命令并确认持久成功，再取得与命令相符的after。读到更晚修订时不能凑成相邻迁移，需按宿主的并发策略处理。参考流程见`apps/node-reference/reminder-demo.mjs`；不是原生通知控制器。

- 相同规范化快照返回null；不同快照必须修订号相邻。跨账本、跳号拒绝。
- 只有`record_usage`生成事件；复用原reducer回放并比较整个after，防止只检查阈值而误收不对应的累计/回执。其他命令返回null，不宣称验证了其完整迁移。
- 返回null或一个事件：`five_minutes`、`one_minute`、`time_up`。一次批量采样跨多个阈值时，只取当前最紧急的一项；到期后不补发过期的5分钟/1分钟提醒。
- 新周期初始余量已≤5分钟/≤1分钟时，在首个正使用样本给相应提醒；同区间后续样本、零使用量与重复快照不再产生事件。策略修改/跨日本身不产生使用事件，界面可读取当前guidance。
- 事件只含`reminderId,lifecycleId,revision,round,dayKey,kind,remainingSeconds,limitingRule,phase,advisoryOnly`，不含答案、历史、PIN或token。

`reminderId=JSON.stringify([lifecycleId,revision,kind])`对同迁移稳定，可供宿主关联重试，但不是原生通知整数ID，也不是授权凭据。模块不记录已送达状态：重算同一对快照仍返回同一事件，不能声称“恰好送达一次”。进程重启只能重建当前提示，恢复待发送通知、去重/重试和过期取消需后续宿主的持久投递方案与真机验证。

## 存储与错误

读取函数只调用一次`store.read()`，不调用CAS或改写schema1；严格解码会在内存中迁移。返回的是当时修订号，后续可能变化，显示/发送前宿主仍应核对当前账本和通知权限。逻辑只读不排除SQLite在读取时恢复未提交事务。

错误类`UsageReminderError`及代码：`INVALID_LIFECYCLE`、`INVALID_STORE`、`STORE_FAILURE`、`SCOPE_MISMATCH`、`INVALID_TRANSITION`。损坏、未知版本或读取失败明确报错，不默认新建账本或放行；存储异常消息不向调用方暴露后端路径。

快照与迁移验证仅检查一致性，不能证明数据真实采集、已持久提交或通知已送达。原生通知权限、前后台投递、重启恢复以及实际跨应用管控见[真机验收N09](../../docs/DEVICE_POC.md)，当前均未验收。

运行`npm run demo:reminders`可验证真实临时SQLite的300/60/0边界、较早日上限与重开后累计保持。使用量为合成数据，没有发送通知、启动墙钟倒计时或连接设备。

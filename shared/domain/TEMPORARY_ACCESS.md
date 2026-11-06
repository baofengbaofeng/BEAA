# 有界临时使用时段

`temporary-access.mjs`是纯计算模块，浏览器构建时嵌入同一源码。它不是家长登录token、平台权限、系统解锁接口或跨应用采集器。临时时段只收紧已经符合正常规则的使用资格，不能跳过答题/休息或扩展每日总量。

- `createTemporaryAccess({permitId,minutes},context)`：context为`{nowMs,phase,cycleRemainingSeconds,dailyRemainingSeconds}`，分钟数1–30且不超过两种余量，phase须AVAILABLE。宿主必须先做家长验证；函数自身不能验证身份/来源。
- `validateTemporaryAccess(value)`：严格检查version1、ID、时间/预算/已用及终止原因，返回副本。无宽松修复。
- `observeTemporaryAccess(value,{nowMs,usedSeconds})`：记录非负整数使用样本；超预算拒绝，耗尽终止，过期或回拨使时段终止。终止后只允许零样本读取，不再计入使用。
- `getTemporaryAccessStatus(value,context)`：输出active/reason/remainingSeconds与预算/已用/截止时间；可用余量取墙钟期限、使用预算、当前周期和日余量最小值。阶段被阻塞时无可用余量。所有结果advisoryOnly=true。
- `closeTemporaryAccess(value,nowMs)`：家长取消的纯状态迁移，同一终止状态重复调用无奖励。

宿主拥有认证、真实时间、采样、并发、持久化和长期去重；必须同时记录普通周期/日累计，不能只扣临时预算。模块没有隐式“过期后退回普通放行”：浏览器保留已结束时段，直到家长处理。修改当前政策不能恢复此时段预算。

浏览器使用模拟分钟输入，在单HTML内将主累计与时段保存在同一文本，并复用既有Web Locks/版本检测；没有原生安全存储或防篡改保证。墙钟回拨被观察后永久终止本时段；未被观察的系统时间篡改不能由本模块证明不存在。它没有接入guardian控制器/SQLite后台或设备控制，不能把ESM测试当作这些集成已完成。

`npm run sync:preview`更新嵌入代码，`npm run check:sources`检查同步；修改共享模块后必须同步并回归。`shared/domain/usage-reminders.mjs`仍为更细的秒级生命周期预提醒接口；浏览器页面提示使用其既有分钟账本，不调用系统通知。

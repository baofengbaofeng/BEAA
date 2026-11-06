# 使用预提醒计算验证

日期：2026-11-06（北京时间）。基于dev c56a42503bcae11e58ae714f801043f76db8a731，分支feature/usage-reminder-guidance。

## 实现与边界

新增`usage-reminders.mjs`的严格余量投影、相邻已提交使用迁移核对与只读存储入口。默认周期到期前300/60秒产生提示，0秒到期；较早日上限优先，相等归因日上限。根实际日累计不因降限/升限减少，非AVAILABLE阶段不安排使用倒计时。阈值依据有效使用累计，不读取墙钟。

每次事件回放原record_usage并比较完整规范化快照；批量跨多个阈值只返回当前最紧急一项，短周期在首个正使用样本提示。同迁移ID稳定，但没有投递记录/确认机制，不保证恰好发送一次。接口与并发/错误约束见[契约](../../shared/domain/USAGE_REMINDERS.md)。

未修改M1/原生源码、guardian schema或controller；没有发出系统通知、采集其他应用、改变资格或调用设备限制。当前纯JavaScript不能直接当作已编译ArkTS功能。

## 实际证据

- 开始前`npm test`：300/300通过。
- 先写20项领域测试：缺失模块时报ERR_MODULE_NOT_FOUND；实现后20/20通过。
- 加入2项真实SQLite测试后22/22通过，demo:reminders通过。
- 独立审查未发现Critical/Important问题；指出空账本隐私断言覆盖不足，已补含真实固定答案和已完成学习历史的公开字段白名单测试。
- 最终针对测试：23/23；全量`npm test`：323/323，无失败/跳过。
- 浏览器完整38项：本地36通过、2项file://企业策略跳过；CI仍严格要求零跳过，本地跳过不能记为通过。
- `npm run demo:reminders`：实际临时SQLite提交300/60/0秒边界，并验证提前日锁与重新打开后累计保持；输入使用量为合成数据。
- 原生预检实际退出2：ohpm/hvigor/sdk缺失，compatibilityVerified/buildAttempted/signingVerified/deviceVerified均false。

原始输出：[Node全量](usage-reminders-node-results.txt)、[针对测试](usage-reminders-focused-results.txt)、[浏览器](usage-reminders-browser-results.txt)、[SQLite示例](usage-reminders-demo.txt)、[原生预检](usage-reminders-native-preflight.txt)。远程CI结果以对应提交的GitHub检查为准。

## 验收覆盖与剩余事项

覆盖阈值前/等于/后、较早日上限/同时到期、降限再升限、跨日保留周期、答题/失败/休息/日锁、待生效策略、下一周期、短周期、批量/零值/重复、scope/跳号/伪造回执、旧格式只读迁移、存储失败/损坏及不暴露答案/历史。真实SQLite测试另核对重开、原命令重试、旧修订冲突和只读不产生新修订。

通知API/权限、持久投递/重启去重与过期取消、实际前后台提示仍待原生接入。已在[真机手册N09](../DEVICE_POC.md)写明25/29/30分钟、暂停采样、日上限优先、撤权及恢复验证步骤；[记录模板](DEVICE_ACCEPTANCE_RECORD_TEMPLATE.md)共19个用例，初始均未执行。缺实现时记阻塞，不能用本轮Node事件代替实际通知送达。

本轮证据仅为Linux/Node/Python/SQLite业务计算及浏览器回归。原生构建/安装、可信使用/休息采集、正式管控权限和健康/教学效果均未验收，M2设备门禁不变。

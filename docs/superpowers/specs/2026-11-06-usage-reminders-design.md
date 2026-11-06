# 使用预提醒计算（SDK无关）

目标：补齐PRD的5分钟/1分钟使用预提醒计算，基于已提交可信有效使用累计，不读取墙上时钟，不修改使用/学习/休息/家长状态，不调用系统通知或设备限制。M1和原生源码不变，原生通知送达仍待SDK/真机接入。

采用独立ESM模块而非扩展guardian schema或通知outbox。现有快照格式与controller不变；函数只投影提示/使用余量，或核对相邻record_usage迁移产生一个提示事件。尚不实现通知发送/确认、跨进程投递幂等或送达历史；这些边界必须在接入文档与验收表明确标阻塞。

getUsageGuidance(state)：严格验证/迁移既有生命周期，输出lifecycleId/revision/round/dayKey/phase、cycleUsedSeconds、根dailyUsedSeconds、周期/日剩余（非负）、remainingUsageSeconds（仅AVAILABLE可大于0）、limitingRule（cycle/daily_limit；相等取daily_limit）、level（none/five_minutes/one_minute/blocked）、usageSecondsUntilNextBoundary、advisoryOnly=true。非可使用阶段不输出使用倒计时计划。<=300秒提示five_minutes，<=60秒提示one_minute；这是可继续计入的有效使用秒数，不是墙钟定时器等待值。

getUsageReminderEvent(before,after)：同快照返回null；不同家庭拒绝；不同快照必须revision相邻。只有record_usage产生事件，复用applyGuardianCommand(before,after.lastReceipt.command)核对整个after，拒绝伪造累计/回执或不对应的迁移。非使用命令不产生到期通知。正使用量跨300/60/0边界才产生five_minutes/one_minute/time_up，一次样本跨多个边界只取最高紧急程度，不补发过期提醒。新周期cycleUsed=0且起始可用时间已<=5分钟/<=1分钟，在首个正使用样本输出对应预提醒；同区间后续样本/0秒/重复快照不重复产生事件。

事件含reminderId=JSON.stringify([lifecycleId,after.revision,kind])，同迁移重算相同ID；此ID不等于原生通知ID或生命周期command.eventId，不是授权凭据。事件只带公共状态/剩余量/限制原因，无答案/历史/凭据。事件计算不证明已提交或已通知，可信宿主必须在确认存储提交后使用；并发变化需重读，不允许以提示事件放行。

readUsageGuidance(store)仅read一次已提交JSON后投影，返回revision。未知/损坏/读失败不默认AVAILABLE。只读指无领域写入，底层SQLite可能恢复未提交事务。提示在返回后可能过期，显示/发送前须按当前账本/权限复核。提交应答丢失或重启只能重建当前投影，当前模块不能恢复丢失的通知送达历史，不能宣称exactly-once。

测试：阈值前/等于/之后、300/60/0、日上限优先、schema2根实际累计/降限再升限、短周期/新周期/跨日/待生效策略、批量跨界/0秒/重算ID、真实迁移核对、非法/跨scope、读失败/快照迁移。参考demo使用真实SQLite和合成使用输入，保存/重开后提示相同且账本不变；无真实采样或通知证据。手册/模板补N09未来原生提醒验收，默认未执行。

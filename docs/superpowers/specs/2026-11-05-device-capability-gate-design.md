# 平台能力与规则状态分离

目标：实现既有 DeviceControlAdapter 契约的SDK无关状态查询与诚实降级，补齐 P3 的平台接入准备与 P4 异常状态覆盖。不修改已验收M1、不执行设备限制或解除、不申请权限、不改变使用账本，不假设原生API或跨应用能力可用。

采用现有Node ESM、无新增依赖。平台适配器由可信宿主注入并绑定一个不含应用标识的scopeId；本仓库仅提供明确unsupported的默认适配器。没有真实平台实现，所有正向能力测试用替身，不能作为真机证据。以下类型是本项目抽象数据，不是系统API。

方案比较：原生直接接入受SDK/权限门禁阻塞；模拟成功适配器容易被误当真实管控；因此实现只读契约检查及unsupported适配器，保留接入点。该选择由开发者根据连续开发要求作出，不增加产品权限或改变架构层次。

能力结果严格格式：schemaVersion=1、scopeId（1–96位非空且无首尾空白字符串）、revision（非负安全整数）、usage/restriction（supported/unsupported/unknown）、authorization（authorized/unauthorized/revoked/unknown）。restriction查询结果也携带相同scope/revision；status为ok时包含state=restricted/released/unknown，否则status只能为unsupported/unauthorized/revoked/failed，且不携带state。拒绝缺失、额外字段、错误版本、错误scope与不一致revision。

`probeDeviceControl(adapter,{scopeId,timeoutMs=3000})`：先读能力，不足时不查限制；可用时查限制，再重读能力核对权限/版本变化。优先报告revoked，其次unsupported、unauthorized、unknown。三次查询整体采用单调时钟限时（1–30000毫秒；不能中断同步阻塞，但其返回后仍拒绝迟到结果），同步异常/拒绝/非法返回/超时均不能产生reported_ready。查询结果含evidence=adapter_report与deviceControlValidated=false，任何结果均不是正式设备验收证明。适配器不得由儿童输入构造。

`createUnsupportedDeviceControlAdapter(scopeId)`保留架构六个方法；查询/请求/限制/解除均返回unsupported；observeUsage首个next明确抛UNSUPPORTED，不伪造零使用时间。

`readGuardedUsageView(store,adapter,options)`只读取生命周期快照，查询设备状态后再次读取并核对原文；期间账本变化即LIFECYCLE_CHANGED。返回rules、device、expectedRestriction和consistent；规则AVAILABLE对应released，其余阶段对应restricted。consistent只表示适配器报告与此快照一致，不能用来执行解锁或证明真实管控。整个读取流程同样有超时，不写账本、不调用requestAuthorization/restrictApps/releaseApps、不返回可授权设备操作的令牌。

失效窗口：顺序查询不是跨进程/平台事务，返回后权限或账本仍可能改变；接入时必须在每次真实动作前重新授权、核验可信事件与设备实况。本轮不实现动作协调器。

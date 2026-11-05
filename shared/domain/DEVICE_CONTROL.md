# 平台适配状态（SDK无关）

`device-control.mjs`是既有架构中`DeviceControlAdapter`的只读接入准备，运行于Node20+，不是ArkTS模块、正式系统API或已验证的设备控制实现。所有适配器依赖必须由可信宿主注入；儿童输入不能提供适配器或其能力报告。

```js
import {createUnsupportedDeviceControlAdapter,probeDeviceControl,readGuardedUsageView} from './device-control.mjs';
const options={scopeId:'family-managed-set',timeoutMs:3000};
const adapter=createUnsupportedDeviceControlAdapter(options.scopeId);
const status=await probeDeviceControl(adapter,options); // unsupported，绝不模拟支持
const view=await readGuardedUsageView(store,adapter,options);
// view.rules.phase可能是AVAILABLE，同时view.device.status仍然是unsupported。
```

## 适配器数据契约

适配器绑定单个不含具体应用列表的scopeId。`getCapabilities()`返回：

```json
{"schemaVersion":1,"scopeId":"family-managed-set","revision":7,"usage":"supported","restriction":"supported","authorization":"authorized"}
```

以上JSON只展示类型，不是实际能力。usage/restriction仅允许supported、unsupported、unknown；authorization仅允许authorized、unauthorized、revoked、unknown。scopeId为1–96码元、无首尾空白字符串；revision为非负安全整数。平台层应在权限/纳管范围/配置变化时推进revision，撤权后不得仍报告authorized。

`getRestrictionStatus()`正常响应：

```json
{"schemaVersion":1,"scopeId":"family-managed-set","revision":7,"status":"ok","state":"restricted"}
```

state只能是restricted、released、unknown。无法查询时用status=unsupported、unauthorized、revoked、failed，并省略state。不得把失败默认为released。所有响应必须有准确且相同的scopeId/revision，严格拒绝未知字段、版本、稀疏/数组/非数据属性及非法类型。

这两个方法是查询服务需要的最小端口，可返回Promise或直接数据；完整默认适配器遵循架构的Promise方法契约，还提供requestAuthorization/restrictApps/releaseApps，均明确unsupported。observeUsage返回异步迭代器，首次next抛DeviceControlError(UNSUPPORTED)，不会用空流/零秒伪装可信统计。

## 状态与时序

`probeDeviceControl`先查询能力，遇撤权、能力不支持、未授权、未知即分别返回revoked、unsupported、unauthorized、unverified，不查询限制；优先级依次如此。完整可用时查询限制，再重读能力核对scope、revision、支持与授权状态。查询期间有变化会丢弃限制观察。有效且已知的状态才返回reported_ready，未知限制仍为unverified。

所有输出含evidence=adapter_report、deviceControlValidated=false。reported_ready是适配器报告一致，不是正式平台权限、跨应用管控或设备验收证明。适配器报错内容不透传；reason仅为有限错误代码。调用配置错误（INVALID_OPTIONS/INVALID_ADAPTER）抛DeviceControlError，不以正常运行状态掩盖接入错误。

超时是**整次调用**的单调时钟预算，默认3000毫秒，范围1–30000整数；null/NaN/额外配置字段会拒绝。永不完成和迟到响应均不产生reported_ready，超时后不再发起后续查询。JavaScript不能中断阻塞事件循环的同步平台调用，但返回后仍检查单调截止时间并拒绝迟到结果；宿主必须提供非阻塞实现。

## 生命周期视图

`readGuardedUsageView`使用只读store.read()，将已有的完整生命周期解码为规则视图，查询设备后再次读取并要求文本一致。任何变化抛LIFECYCLE_CHANGED，损坏抛INVALID_LIFECYCLE，读失败抛STORE_FAILURE；整个调用超时抛TIMEOUT，不清空或改写账本。期望限制状态：AVAILABLE→released，所有其他阶段→restricted；只有reported_ready且观察与期望相同，consistent才为true。

consistent是诊断字段，不是设备操作授权。函数不会申请权限、开始计时、限制/解除其他应用、发放额度或改变学习记录，也不输出设备操作token。这里的scopeId只是适配器范围标签；家庭身份与账本归属仍由可信应用服务负责。

前后读取不是跨存储与平台的原子事务，结果在返回后可能过期；真实动作需要独立的操作服务在执行前核验身份、权限、账本和设备状态，并处理晚完成/重复动作。此版本没有实现动作协调器，也未接原生UI。

## 验证与门禁

`npm run demo:device`使用真实临时SQLite、合成使用事件及unsupported默认适配器，演示“规则允许”和“设备未验证”同时成立，检查查询不改账本且可重开。正向平台状态只在测试替身中覆盖，不是平台模拟器或真实跨应用证据。原生SDK、签名、安装及目标设备权限门禁仍待人工条件。

# 技术架构与能力边界 v0.1

## 层次
- UI：响应式横竖屏页面，不持有最终计时授权状态。
- 应用服务：学习挑战、家长授权、规则状态迁移。
- 领域逻辑：周期、日上限、休息、答题校验与授权条件。
- 本地存储：政策版本、有效使用账本、挑战进度和授权审计。
- 设备适配：使用情况、系统限制、恢复；不同平台单独实现。

## 设备适配器契约（抽象接口，**并非现成API**）
```ts
interface DeviceControlAdapter {
  getCapabilities(): Promise<CapabilityReport>;
  requestAuthorization(): Promise<AuthorizationResult>;
  observeUsage(): AsyncIterable<UsageEvent>;
  restrictApps(scope: AppScope): Promise<OperationResult>;
  releaseApps(scope: AppScope): Promise<OperationResult>;
  getRestrictionStatus(): Promise<RestrictionStatus>;
}
```
其中每项结果须明确区分不支持、未授权、权限撤销、失败和成功，失败不得当作成功解锁。

## 状态
AVAILABLE → CHALLENGE_REQUIRED → CHALLENGE_ACTIVE → REST_REQUIRED → AVAILABLE。
DAILY_LOCKED、SCHEDULE_LOCKED 由高优先级守卫条件覆盖；PARENT_OVERRIDE 限时审计；PERMISSION_MISSING 应明确告警。

## 计时与防绕过
- 有效使用时间与日累计分别持久化；息屏、旋转和应用切换不清零。
- 旋转、分屏、进程重启不得重复发奖励。
- 避免直接信任用户可回拨的系统墙上时钟；检测时间异常。
- 权限撤销、重启后的系统限制状态需重新核对。

## HarmonyOS 4 P0验证
确认目标机型子版本、可用正式SDK/API及受限权限；真机验证跨应用使用统计、施加限制、限制页跳转答题、恢复、重启、分屏及权限撤销。较新版本Screen Time Guard API**不能默认适用于HarmonyOS 4**。不具备正式管控能力时只能提供可诚实描述的降级功能。

## iPhone / iPad 原生客户端（待 Apple 验证）
已加入 SwiftUI 页面、Foundation 业务状态、本地原子文件和 Keychain 家长凭据。当前计时仅覆盖本应用前台；原生编译、模拟器、签名与设备测试未在 Linux 执行。Family Controls / Device Activity / Managed Settings 框架、entitlement 授权与审核条件仍需单独验证，不假设底层权限等价。见 apps/ios/README.md。

## SDK无关的平台状态接入准备

[device-control.mjs](../shared/domain/device-control.mjs)已提供只读严格响应契约、整体超时、权限/配置前后复核和明确unsupported的默认适配器；完整字段见[平台状态契约](../shared/domain/DEVICE_CONTROL.md)。`readGuardedUsageView`分开返回业务规则与设备报告，并拒绝查询期间变化的账本。所有结果标记为适配器报告、未通过设备控制验证；一致性诊断不能作为实际解除限制的授权。原生适配、真实操作服务和设备门禁仍未实现。

## 摘要与演示通知宿主

原生预览新增固定窄桥和同源纯TS提醒队列服务，保存脱敏摘要、接收明确模拟快照及暂停。原生文件/通知/RDB为未构建候选，Node真实SQLite提供参考恢复证据；不提供设备权限、凭据或资格账本入口。详见[宿主契约](../apps/harmony/NATIVE_SERVICES.md)与[剩余清单](REMAINING_WORK.md)。

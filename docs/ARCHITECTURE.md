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

## 后续 iPadOS
单独研究 Family Controls / Device Activity / Managed Settings 框架、entitlement 授权与审核条件。共享业务规则设计，不假设底层权限等价。

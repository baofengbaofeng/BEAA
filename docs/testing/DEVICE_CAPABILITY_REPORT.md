# 平台能力与规则状态分离验证

日期：2026-11-05（北京时间）。基于dev的29e8f3883811be8a2c1408d2a4be9d31c2f3eb12，分支feature/device-capability-gate。

## 交付

新增SDK无关只读设备适配查询、unsupported默认适配器、生命周期/设备分离视图及真实SQLite演示。完整[数据契约与接入范围](../../shared/domain/DEVICE_CONTROL.md)。没有新增依赖，不修改已验收浏览器MVP、自检页或原生UI，不申请设备权限，不执行真实限制/解除，不改变使用资格。

设备报告必须包含schemaVersion、scopeId、revision以及严格能力/权限/限制状态。支持不足、未授权、撤权、未知、错误和超时不能成为reported_ready；正向查询前后核对能力与版本。所有结果保留evidence=adapter_report、deviceControlValidated=false，consistent只是诊断字段，不是操作授权或真机证明。

## 实际验证

- 开始前npm test：209/209通过。
- 针对测试：34/34通过（32个共享服务测试、2个真实SQLite集成测试）。
- 完整npm test：243/243通过，无失败/跳过。
- 浏览器完整20项：本地18通过，2项file://因企业浏览器策略跳过；CI仍严格要求零跳过。
- npm run demo:device：真实SQLite中AVAILABLE与unsupported并存；合成1800秒后CHALLENGE_REQUIRED仍unsupported；查询前后完整快照相同，重新打开一致。
- 既有domain/SQLite/家长示例继续执行，范围仍为合成时间与真实参考存储。
- npm run native:preflight：真实退出2，缺ohpm/hvigor/sdk（hdc也未提供），buildAttempted/signingVerified/deviceVerified均false。

原始结果：device-capability-node-results.txt、device-capability-browser-results.txt、device-capability-demo.txt、device-capability-native-preflight.txt。

覆盖：不支持/未授权/撤权/未知、错误和额外字段、scope/revision不匹配、查询中撤权与原地响应修改、同步抛错与Promise拒绝、全流程超时与迟到不继续查询、同步阻塞返回后截止时间核验、六类受限业务阶段、账本损坏/读失败/查询中变更。真实SQLite并发提交日上限后，诊断拒绝旧视图，数据库保持revision1与7200秒，不回滚。

红绿过程：先写测试并观察模块缺失失败；针对null超时、同步迟到与默认适配器Promise契约的额外回归先失败，再分别修正缺省判断、单调截止检查与异步返回。独立审查未发现重要逻辑缺陷，审查时进行中的Promise回归已修复并复测34/34；原生集成说明已澄清restore是未来动作服务的独立门禁。

## 能力边界与人工条件

正向设备状态只由测试替身提供，不是原生模拟器、真实跨应用计时/限制或平台权限证据。查询是顺序观察，不是跨平台事务；返回后的撤权/账本变化仍可能发生。不能据此自动释放应用、发放时长或绕过休息。JavaScript无法中断同步阻塞的平台实现，宿主需提供非阻塞端口，服务只保证拒绝其迟到结果。

后续人工条件不变：匹配SDK/DevEco工具链与签名、目标设备及正式权限资料、实际安装与DEVICE_POC矩阵。原生存储/UI/真实动作协调器、重启/后台/撤权/分屏与健康效果均未验收，M2继续BLOCKED_HUMAN。

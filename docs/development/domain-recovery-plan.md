# 业务状态恢复与跨日守卫

基线dev ebb43fe（PR #8已合并），不扩展已验收的浏览器MVP。本轮实现shared/domain的SDK无关恢复契约，后续供原生持久化适配器使用，尚不接原生Preferences或系统权限。

1. 修复rollDay只清零日累计，保留当前周期、挑战答案和休息资格；每日锁解除后按周期累计继续守卫。校验真实公历日期，拒绝非法日切换。补充稀疏数组输入的已有校验漏洞。
2. 新增snapshot.mjs，提供validateSession、encodeSession、decodeSession。封装schemaVersion=1/revision/session；revision仅为调用方元数据，不声称提供CAS/事务。输入损坏、未知版本或状态矛盾时抛错，不回退为新会话或归零使用量。
3. 校验已知字段、规则、计数、日期、题目ID/答案顺序、通过阈值和待生效资格。仅REST_REQUIRED允许pendingGrant；每日上限与phase一致。往返恢复后继续执行真实引擎，验证不提前结束休息、不重复回答、不突破日上限。
4. demo实际使用编码/恢复后继续规则流程；完整Node测试、独立审查和dev PR/CI。文档标明该组件不是加密认证、持久存储、可信时钟或ArkTS集成；这些仍需正式平台适配。

执行方式沿用用户连续开发授权，常规实现不逐项询问。只修改独立功能分支，不合并master。

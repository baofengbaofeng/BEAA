# 规则快照恢复与跨日守卫验证

基于dev ebb43fe（PR #8已合并），不修改浏览器MVP或原生UI。本轮实现SDK无关的业务恢复接口，真实SDK构建仍未执行。

## 已修复的问题

- rollDay原先重置所有阶段和周期，答题或休息中的会话可在跨日后直接变为AVAILABLE；新增回归先复现错误，现只清零日累计，保留挑战/周期/休息约束。
- 日期校验原先只检查字符串形状，接受不存在的日期；现验证公历月份、闰年和0001–9999年份。
- 稀疏subjects/questionIds数组可绕过some()校验；新增回归后改为完整迭代验证。

## 新快照契约

新增validateSession/encodeSession/decodeSession，schemaVersion=1/revision/session。拒绝未知字段/版本、非法计数、乱序答案、不完整或未达阈值的资格、每日上限与阶段矛盾、错误或过大的JSON；失败不自动归零或新建会话。序列化前后保持规则状态，返回独立副本。

实际临时文件恢复验证涵盖：答题从第3题继续、旧题重投拒绝、休息不足599秒拒绝、满足600秒后继续、再次结束休息拒绝、日上限继续受保护、截断文件拒绝。还覆盖跨日的部分周期、挑战、失败重试、待休息资格和每日锁，以及3/5自定义通过阈值。

## 执行证据与限制

完整npm test62/62通过，npm run demo成功；原始输出见domain-recovery-node-results.txt和domain-recovery-demo.txt。独立审查未发现Critical/Important问题，并额外执行合法状态迁移检查。

这不是原生持久化后端或可信认证系统。revision仅为元数据，实际CAS/原子写入、防回滚、答案与时钟真实性、权限核对需由平台服务保证；本轮未验证ArkTS编译、Preferences、HAP、签名或真机管控。

# SQLite参考存储与进程恢复验证（2026-11-05）

基于dev2942d10（PR #17已合并），新增云端真实SQLite原子端口；共享领域接口、浏览器MVP和原生UI不变。

环境：Linux、Python3.12.14、SQLite3.53.1；Node20+兼容，当前云端Node版本见运行日志环境记录。要求Python3.11+与POSIX，无新依赖。

## 实现

Node无shell调用Python标准库helper，stdin传输载荷，BEGIN IMMEDIATE事务核对lifecycleId+revision并写完整快照。DELETE journal/FULL同步、固定格式版本、payload SHA256/metadata核对，Node再验证完整共享生命周期。新建仅revision0且不覆盖既有文件；不存在/损坏/未知版本拒绝，不自动清空。目录与文件限制为当前UID私有、无软/硬链接；错误固定代码不泄露载荷/原始SQL。

## 真实测试证据

基线146/146；新增模块先因未实现失败，完成后初始新增13项通过，审查增加1项回归后完整npm test160/160，无失败或跳过。

- 独立Python helper进程竞争同一CAS，仅一个提交。
- 两个真实controller并发末题只保存一个答案及一轮历史。
- 数据库提交后注入应答丢失，重新打开后原命令duplicate，保持1800秒日累计和1轮历史。
- 测试专用独立writer在事务UPDATE后、COMMIT前SIGKILL：生产适配器重开恢复原quiz阶段，未提前归档。
- writer在COMMIT后SIGKILL：重开恢复新rest阶段、完整历史与原回执，可原命令重试。
- 实际持有写事务时CAS等待2秒后STORE_BUSY，未更改状态；释放后旧快照仍可读取。
- Unicode载荷/含空格与?#%的文件名；未知版本、缺行、摘要/metadata不一致、非法替换、缺失数据库、不安全权限/软硬链接、backend启动/协议失败和10秒超时均明确拒绝。

故障边界writer不是生产模块，也没有生产故障开关。非零种子版本先通过真实controller从revision0推进，没有绕过初始化契约植入状态。

原始输出：[完整测试](sqlite-reference-node-results.txt)、[SQLite示例](sqlite-reference-demo.txt)、[环境](sqlite-reference-environment.json)。`npm run demo:sqlite`实际重开2题/300秒状态，末题与完成重试duplicate，休息完成累计1800秒，第二轮开始3600秒且历史1轮。旧`npm run demo`仍通过。

## 未验证范围

SIGKILL验证进程事务中断，不能代表断电、磁盘/文件系统故障或目标平板持久性。摘要不是认证/加密/防回滚，私有权限不防同UID攻击。未提供生产备份/迁移、原生ArkTS/SDK/HAP或签名；Usage/Rest/Calendar输入仍为合成数据，不证明真实跨应用计时或系统限制。原生存储与真机权限门禁保持未通过。


## 独立审查与修复

独立审查发现：仅限制直接父目录不足以阻止其他UID替换可写祖先并重定向SQLite路径。新增非sticky共享祖先/中间符号链接回归先复现Missing expected rejection，再要求整个祖先链由root、进程根挂载的所有者或当前UID拥有、共享可写目录必须sticky；直接父目录仍要求当前UID私有。回归同时验证受sticky保护的共享祖先可正常使用。最终新增14项、全量160项通过；这不防同UID/root恶意操作，不替代原生受保护存储。

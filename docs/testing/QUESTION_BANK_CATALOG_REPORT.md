# 受保护离线题库目录验证

日期：2026-11-05（北京时间）。基于dev f09be4084c316446c6d5675722c80be8021f3b9b，分支feature/persistent-question-bank。

## 实现与范围

新增目录schema1、按家庭lifecycleId/修订号的CAS、最近导入回执、严格编解码/2,000,000码元上限与年级学科覆盖摘要；家长验证前后复核后导入；通过目录开始新测验并保留原题快照。独立SQLite参考目录与guardian/auth库分开，不迁移使用账本、不重置资格或每日累计，不修改已验收浏览器MVP、自检页或原生UI。见[完整接口说明](../../shared/quiz/CATALOG.md)。

## 真实验证结果

- 开始前npm test：243/243通过。
- 完整npm test：273/273通过，无失败/跳过；新增30项（目录8、应用服务11、真实SQLite11）。
- 浏览器完整20项：本地18通过、2项因企业浏览器策略阻止file://而跳过。CI继续严格要求零跳过，不能把本地跳过视为已通过。
- npm run demo:bank：真实PIN与guardian/auth/bank三份SQLite；未授权拒绝；导入版本1/5道题并重开；当前题快照不变；原轮按旧题完成，新轮读取新版；日累计3600秒/历史1轮保持。使用/休息为合成输入。
- 既有demo、demo:sqlite、demo:parent、demo:device继续通过。
- 原生预检真实退出2：缺ohpm/hvigor/sdk；buildAttempted、signingVerified、deviceVerified均false。

原始证据：question-bank-node-results.txt、question-bank-browser-results.txt、question-bank-demo.txt、question-bank-native-preflight.txt。

覆盖包括：未授权/跨家庭/换PIN失效、验证期间输入修改或授权变化、非法目录/命令/大小/版本/回执、同ID不同内容拒绝、过期修订与独立进程竞争、实际提交应答丢失后重试仅一版本、当前原题评分不受新标准答案影响、下一轮新题源、目录不可读时已提交开始命令按回执重试、题量不足不凑题/不放行、不安全权限/链接/格式拒绝、摘要和业务内容损坏不清空。

## 独立审查与修复证据

独立审查发现一项重要问题：SQLite逻辑读用mode=ro时，进程中断并发生页溢写后无法恢复热回滚日志，题库会持续不可读。新增真实子进程cache_size=1、BEGIN/UPDATE后os._exit中断测试，先观测STORE_IO失败，再修复并复测通过。

修复为连接前核对私有文件SQLite头部/专属application_id/版本/DELETE格式，再允许SQLite回滚有效目录未提交事务并执行完整表/摘要/业务校验。中断后恢复原revision0完整快照、清理回滚日志，并能继续CAS到1。误传其他应用的热日志库在连接前拒绝，数据库与日志逐字节保持；未知user_version/WAL格式也不创建辅助文件或修改原文件。逻辑读允许事务恢复，不能称为物理只读。这不是应用级自动重置或旧备份覆盖。

另在开发回归中修复：已提交开始命令应答丢失后，不依赖后来可能损坏/不可读的目录；不输出未持久关联的bankRevision，避免把当前目录版本冒充历史题源版本。当前题内容与答案快照是评分依据。

## 交付边界与剩余人工条件

家长授权最后一次复核为接受点，凭据库/题库/账本没有跨库事务；目录读后并发导入允许本轮固定已读题库。只保留最近导入回执，宿主必须保持eventId唯一。内部worker、CAS和纯reducer不是公开UI/RPC入口。

本次只验证Linux/POSIX Node/Python参考实现与SQLite进程中断恢复，不证明断电、原生安全存储、SDK编译、真实跨应用计时/限制或健康改善。题库仍为三年级5道流程样例，结构校验不代替课程/答案审核。原生UI/题库端口、匹配SDK/签名/目标设备和正式权限仍需人工条件，M2保持BLOCKED_HUMAN。

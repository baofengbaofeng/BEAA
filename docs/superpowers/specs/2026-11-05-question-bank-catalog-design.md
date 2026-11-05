# 受保护的离线题库目录

基于dev f09be40，补齐P2共享题库的持久化/导入接口；保留既有浏览器MVP与原生UI。Node ESM、Python3.11+/POSIX SQLite参考实现，无新增依赖，不声明可直接用于ArkTS或设备管控。

选择：不将可变题库塞入使用账本（避免迁移或重置额度），不只保留调用者内存数组；使用独立、按lifecycleId归属的版本化题库目录，沿用现有read/CAS与家长authorizer模式。首次创建由可信宿主初始化，后续导入必须走家长验证网关；内部存储端口不是UI/RPC入口。

目录schemaVersion1：lifecycleId、revision、bank（复用version1题库契约）、lastImport。revision0时lastImport=null；之后记录eventId/expectedRevision，必须expectedRevision=revision-1。每份编码目录最多2,000,000 UTF16码元。question bank继续要求1–2000道有效单选题；结构验证不证明教学内容正确。

导入命令严格为{lifecycleId,eventId,expectedRevision,type:'replace_bank',payload:{bank}}。CAS比较目录lifecycleId+revision，仅保存完整下一版。最近一次同eventId、同expectedRevision及同规范化题库重试返回duplicate；同ID不同内容拒绝EVENT_REUSE，旧版本/并发冲突拒绝CONFLICT。不是无限回执日志，宿主必须保持事件ID唯一。导入不触碰使用/学习账本。

家长网关在读前与提交前验证真实authorizer，核对家庭及credentialVersion；失败不读或不写目录，不导出答案或token。接受点为最后一次授权检查；独立凭据库与目录CAS不是跨库事务，撤销不能撤回已接受的写入。

beginQuizFromQuestionBank(guardianStore,bankStore,command)是可信服务入口，只允许begin_quiz。一次读取固定目录，检查与命令lifecycleId一致，然后复用commitGuardianCommand与现有组卷。目录读取后并发导入允许本轮使用已读取版本，后续开始读取新版；不承诺题库与账本跨库原子事务。已有答题快照始终用于评分、恢复与归档；最近一次已提交开始命令的重试先按账本回执恢复，不依赖后来的目录是否可读。返回现有公开测验视图，不把当前目录版本冒充已固定题目的历史版本。题数不足/目录损坏/跨家庭/旧账本revision不得改写账本或自动凑题。

SQLite参考目录单独application_id和question_bank表，沿用已有安全路径检查、私有文件、独占创建、DELETE journal、FULL同步与BEGIN IMMEDIATE CAS；摘要仅检测损坏。读取先核对私有文件头部的专属application_id/版本/DELETE格式，再允许SQLite回滚有效目录的未提交热日志并完整验证；不恢复误传的其他应用数据库。逻辑读不保证物理只读。未知/损坏/缺失不自动初始化，不覆盖既有库。返回范围仅含版本与按年级/学科题量，不含标准答案。真实PIN、重开目录、并发CAS、应答丢失、进行中导入后原答案保持是验收重点。

不在范围：云题库、题目教学审核、全课程内容、原生存储/安全容器/设备权限、临时放行、公共部署。题库不含使用额度，恢复题库不得覆盖使用账本。

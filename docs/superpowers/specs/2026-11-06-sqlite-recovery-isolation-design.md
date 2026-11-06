# SQLite恢复与格式隔离修复

基于dev a9d24e6。目标P0/P4：家长验证库在进程中断留下热回滚日志后可重新打开；三类参考库拒绝误传的其他应用数据库，且不触发其事务恢复。使用账本、凭据和题库schema/策略/公开API不变，不修改M1或原生代码。

当前：题库已有连接前头部检查及可恢复读；guardian先打开可写连接再检查格式，误传热日志库会在拒绝前改变该库；parent status为mode=ro，正确凭据库存在热日志时也无法打开。修复复用已有题库策略，而非重建库、抹凭据或默认放行。

共同辅助函数validate_header(path,application_id,schema_version=1,corrupt_code,unsupported_code)：先执行既有私有路径检查，再直接读取100字节SQLite头，核对magic、application_id、user_version、DELETE读写格式标志。头部只是格式初筛，不是来源/身份认证；随后仍完整检查SQLite表、摘要和领域数据。已提交文件格式标记由本项目writer保持不变，损坏/未知schema/WAL拒绝，不自动迁移。

guardian的read/cas/inspect及backup源、parent全部既有库操作、question-bank读/CAS在连接前检查各自格式。exclusive新文件初始化与备份新目标在完整SQLite头产生前不得套用既有库检查，仍依赖独占创建。

正确格式的parent status改用允许SQLite回滚热日志的连接；只读查询不更新PIN/失败计数/凭据版本，不新增登录会话。正常查询没有SQL写业务数据，但可能发生SQLite事务恢复，不能承诺物理只读。guardian/question-bank既有恢复保持。guardian inspect和backup源保留mode=ro，不能借检查触发恢复或覆盖源；自有热日志inspect失败保留文件，需正常打开主库恢复后再检查。

验收：实际子进程BEGIN/UPDATE、cache_size=1强制溢写后os._exit，父进程通过API恢复正确库。凭据原PIN、credentialVersion和失败次数保持；ledger使用累计与挑战阶段、bank版本保持。3类库6个错误打开方向逐一检查数据库/日志哈希和辅助文件不变；错误schema/WAL不产生文件。所有保留数据/断言不打印PIN/token/盐/摘要原值。

范围仅Linux/POSIX Node/Python SQLite参考；无SDK编译、真实断电/设备恢复、管控或健康效果验收声明。相同UID恶意修改/格式伪造仍不在保护范围，跨库事务仍未提供。

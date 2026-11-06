# SQLite恢复与格式隔离验证

日期：2026-11-06（北京时间）。基于dev a9d24e6c0e5a009f03b3ec92c34924de5c775c17，分支feature/sqlite-recovery-isolation。

## 发现并修复的问题

1. 家长status查询原先mode=ro：中断PIN写入留下热回滚日志时，openParentAuthService持续STORE_IO，无法重新打开。现先确认正确格式，再允许SQLite回滚未提交事务；status本身仍没有凭据UPDATE、不发登录token。
2. guardian原先连接后才确认格式：误传其他应用热日志库时，可能在返回不支持之前恢复并改变对方文件。三种库现在共用连接前格式初筛，分别检查私有路径、SQLite magic、application_id、user_version、DELETE读写标记，之后仍完整校验表/摘要/凭据/领域载荷。
3. auth原先接受WAL格式，现在与两种业务库一致拒绝未支持schema/WAL，不自动迁移或生成辅助文件。

新建库和备份新目标仍独占创建，不对尚为空的新文件套用既有头部检查。guardian inspect、备份内部源快照阶段保留mode=ro；无法恢复的热日志会报错，源及日志保留，不生成误导性目标。正常backup的前置read允许先恢复正确主库。schema、公开服务API、业务/家长策略与原生/M1/题库内容均未改变。

## 实际测试证据

- 开始前npm test：283/283通过。
- 初始14项实际进程测试：修复前7失败/7通过；修复后14/14通过。
- 独立审查未发现重要代码问题，审查者独立运行14项通过；按审查建议补独立backup分支3项，最终针对测试17/17。
- 完整npm test：300/300通过，无失败/跳过。
- 浏览器完整38项：本地36通过、2项file://被企业策略阻止。CI仍严格要求零跳过，不能把本地跳过算作通过。
- 既有demo、demo:sqlite、demo:parent、demo:device、demo:bank五个示例均通过。
- 原生预检真实退出2：缺ohpm/hvigor/sdk；buildAttempted/signingVerified/deviceVerified均false。

原始结果：sqlite-recovery-isolation-node-results.txt、sqlite-recovery-isolation-focused-results.txt、sqlite-recovery-isolation-browser-results.txt、sqlite-recovery-isolation-native-preflight.txt。

## 进程与文件级断言

测试专用Python子进程在BEGIN/UPDATE后设置cache_size=1强制页溢写，并os._exit，留下真实热journal；不是模拟计时，也不是生产worker的故障开关。

- auth：已提交版本1、失败2次后中断更新；API重开恢复版本1和失败2，原PIN仍可真实登录。恢复不清空失败次数、不自动登录。既有5次冷却、跨重开、换PIN撤销用例随全量回归继续通过。
- 3种库的6个错误打开方向：在连接前返回对应不支持错误；数据库和journal内容哈希不变，不出现WAL/SHM；之后正确owner API仍可恢复。guardian保持已用1800秒/CHALLENGE_REQUIRED，bank保持原版，auth保持原凭据记录。
- 自有热日志只读inspect：失败并保留源/journal，正常open恢复后inspect可通过。
- 各类库错误user_version/WAL均拒绝，源内容保持，不生成辅助文件。
- 直接验证内部backup独立分支：误传auth/bank热日志不改源/日志、不建目标；正确guardian热日志在只读快照阶段失败且不建目标，正常open恢复后公开backup成功，备份revision1且完整快照一致。

所有凭据断言不打印PIN/token/盐/派生摘要；内容一致性只比较整体文件哈希或非敏感版本/次数。

## 范围限制

头部仅为格式初筛，不是身份认证、防篡改或防回放；连接后完整校验仍必需，支持writer不会修改这些格式标记。私有路径规则不防同UID/root恶意置换或伪造格式。

正常status/read为逻辑只读，SQLite恢复可能改变未提交页及journal，不能称为物理只读。严格inspect仍不会执行恢复。不提供备份覆盖、账户找回、遗忘PIN重置或自动发放使用资格。

本轮证据限当前Linux/POSIX Node/Python SQLite与进程中断，不证明真实断电、设备/原生存储、跨应用计时/限制或健康效果。M2仍需匹配SDK、签名、目标设备及正式权限后进行实际构建与验收。

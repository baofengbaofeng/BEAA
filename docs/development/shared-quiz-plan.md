# 共享题库与答题服务

基线dev b6a1dcb（PR #9已合并）。完成SDK无关业务服务，不扩展浏览器MVP，不声称原生SDK编译/权限通过。

1. 新增shared/quiz/bank.mjs：校验version=1的题库、题ID/选项/答案引用和元数据。沿用原样例格式，knowledgePoints可选，支持自定义知识点标签。按年级/学科及知识点并集过滤，在非空学科间稳定轮询，不重复题ID；不足则拒绝，不改标签或重复凑题。样例扩至5题以满足默认规则，仅供流程验证。
2. 新增domain/quiz-service.mjs：startQuiz生成持有题目快照的attempt，界面仅取得getCurrentQuestion的公开数据；submitQuizAnswer只接受questionId/chosen，从固定快照取标准答案，推进现有引擎并返回反馈。题目快照与原始题库隔离。
3. encodeQuizAttempt/decodeQuizAttempt结合既有domain快照；恢复时核对题序、元数据和所有已存评分是否与题目答案一致。revision仍是存储方元数据，认证/CAS/抗回放及原生存储不在本组件内。
4. 先测试再实现；demo用共享题库实际组卷/判分/磁盘恢复；更新文档与证据，独立审查，dev PR和CI。不修改SDK、签名、平台权限或原生UI。

# 共享题库契约

`bank.mjs`提供SDK无关的题库校验和组卷。当前版本支持单选题，grade=1–6，subject为chinese/math/english。`sample-questions.json`包含三年级语数英5道流程样例，不代表完整课程；已用已知答案验证基础算术、诗句和词义。

题库格式沿用 `{version:1, questions:[...]}`。每题必需字段：id、grade、subject、type(single_choice)、stem、options（id/text）、correctOptionId、explanation。可选knowledgePoints是自定义标签数组，缺省为空。示例：

```json
{"id":"math-g3-add-001","grade":3,"subject":"math","type":"single_choice","stem":"15 + 17 = ?","options":[{"id":"A","text":"31"},{"id":"B","text":"32"}],"correctOptionId":"B","explanation":"15+17=32。","knowledgePoints":["addition","arithmetic"]}
```

`validateQuestionBank(data)`返回独立副本。要求1–2000题、题ID唯一、2–8个选项、选项ID和去除首尾空白后的文本唯一，答案引用必须存在；题干最多2000码元，选项文本1000，解释4000，知识点最多32个唯一标签，每个80码元。未知字段/题型/版本和稀疏数组被拒绝。

`selectQuestions(data, policy, {knowledgePoints:[]})`按实际年级与可选学科过滤；非空知识点选择取并集，空数组表示不按知识点限制。在筛选后的非空学科池间按策略学科顺序稳定轮询，不重复ID。匹配题量不足抛QuizError(INSUFFICIENT_QUESTIONS)，提供available/required，不能重复凑题或改变题目年级。

以上只校验结构和答案引用，不自动判断自定义题目的教学正确性。题库内容和来源应由可信题库服务/家长控制层管理。浏览器独立原型目前仍使用自己的演示题库格式，本文格式供共享业务服务和后续原生移植使用。

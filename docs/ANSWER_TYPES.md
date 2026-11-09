# 判断题与数值填空

客户端现在支持单选、判断、数值填空混合挑战。默认题库不自动替换；家长验证后导入 JSON 数组才启用自己的题目。演示包内的 mixed-bank.json 提供五道三年级流程样例；仓库源文件为 shared/quiz/mixed-browser-questions.json。样例不是完整课程或教师教学审核。

## 客户端数组格式

原有单选题不变，可省略type或写single_choice。判断题固定两个选项，answer是从零开始的选项下标：

```json
{"id":"bool-1","grade":3,"subject":"math","topic":"arithmetic","type":"true_false","text":"2大于1。","options":["正确","错误"],"answer":0,"explain":"2比1大，所以说法正确。"}
```

数值填空的answer必须是规范十进制字符串，且不能出现options字段：

```json
{"id":"num-1","grade":3,"subject":"math","topic":"arithmetic","type":"numeric","text":"1.5 + 1 = ?","answer":"2.5","explain":"1.5加1等于2.5。"}
```

将题目放在数组中导入。题号需唯一；沿用现有年级、学科、粗分类和大小限制。topic为arithmetic、poetry、vocabulary，subject为math、chinese、english。题库标准答案须规范化，例如"2.5"，不能写"02.500"或数字2.5。

## 数字输入与得分

输入按字符串精确比较，不使用浮点近似。接受首尾ECMAScript空白、全角数字及加减号/小数点、Unicode负号、前导零、多余小数零；支持.5、2.等写法。最多12位整数、6位小数、原始输入48个UTF16码元。负零按零处理。

不接受单位、分数、逗号、科学计数法、内部空白、NaN或Infinity。格式无效时提示修改，不算第一次答错、不新增错题。有效错误答案计入首次成绩并要求纠正；之后答对不补回首次得分。刷新恢复后规则相同。数字错题保存规范化的首次错误值，错题复习不改挑战得分、不发放额度。

数字草稿只保留在当前页面；未提交草稿刷新后消失。可以使用提交按钮或回车。题目、提示和错误反馈继续显示拼音，输入值本身不加注音。

## 范围与验证

网页、鸿蒙离线页面及iOS原生源码接入相同客户端题型。共享版本一的选项ID题库、SQLite参考资格账本仍严格只接收single_choice；本批没有把它们升级为混合题型协议，也不把客户端数组伪装成该格式。需要数值题时请使用上面的客户端数组和客户端工作流。

JavaScript规则见shared/quiz/answer-types.mjs；Swift对应见apps/ios/BEAA/AnswerTypes.swift。执行 npm run sync:preview、npm run build:native-preview 同步离线资源，再运行 npm test 和 npm run test:browser。Apple编译、模拟器和XCTest仍须Mac/Xcode；Linux的项目结构检查不等于原生通过。

## iOS 扩展题型

iOS 客户端数组额外支持以下题型；网页、鸿蒙页面和共享版本一协议尚未实现这两个扩展，导入前请确认目标客户端。

```json
[
  {"id":"fraction-1","grade":3,"subject":"math","topic":"arithmetic","type":"fraction","text":"二分之一写成分数是多少？","answer":"1/2","explain":"分子是一，分母是二。"},
  {"id":"tolerance-1","grade":3,"subject":"math","topic":"arithmetic","type":"numeric_tolerance","text":"估算测量值，允许误差为零点一。","answer":"2.5","absoluteTolerance":"0.1","explain":"二点四到二点六都在允许范围内。"}
]
```

分数答案必须为约分后规范形式，分母为正；输入支持等值分数约分，分子分母绝对值不超过十亿，分母不得为零。误差容忍为显式非负规范十进制字符串，用 Decimal 做绝对差比较；旧 numeric 仍为精确比较。均不写 options。首次有效错误计分及订正规则保持一致。Swift XCTest 源码已补齐，执行由用户后续安排。

# Harmony Stage 结构修复验证

## 基线及根因

基于dev合并提交6d3ec59（PR #6）。基线npm test43/43，真实预检仍缺ohpm/hvigor/sdk，没有原生编译器或可用目标设备。

原工程的products位于build-profile.json5根节点，模块applyToProducts未链接app.products中的产品；AppScope/app.json5引用应用名称和图标，但AppScope/resources目录缺失。旧测试只检查入口文件存在和界面文案，没有验证这些配置关系。

对照官方openharmony/applications_app_samples/OpenHarmony-4.0-Release的StageModel样例，固定提交e54e3ce7a019e33c2c5c1382dd3b1ba19632af3d，确认通用Stage产品层级与AppScope资源作用域。该样例不作为HarmonyOS4的SDK兼容性、系统权限或设备能力证明。

## 实现及证据

- 现有产品声明移入app.products；SDK版本字符串、runtimeOS、模块目标、Hvigor依赖/modelVersion和签名字段保持原值。
- 新增AppScope/resources/base/element/string.json，名称为学知守护；新增AppScope/resources/base/media/app_icon.svg，字节复用本项目entry图标。
- 新增两项语义检查：模块目标关联已声明产品及模块target；AppScope应用名称、图标引用可解析。
- 测试使用json5@2.2.3处理实际.json5配置，保留合法注释/尾随逗号语法支持。
- 回归先失败：产品声明层级错误、AppScope名称资源缺失；修复后完整npm test45/45。独立审查确认图标字节一致、版本字段未改，未发现Critical/Important问题。

原始最终输出见harmony-scaffold-node-results.txt。真实SDK构建、资源打包、HAP、签名及真机验收仍未运行，M2保持BLOCKED_HUMAN；npm test通过不等同于原生编译通过。

# 原生 Stage 工程结构修复

基线：dev 6d3ec59（PR #6已合并）。本地npm test43/43，真实native:preflight仍缺ohpm/hvigor/sdk。

确认的问题：build-profile.json5的products放在app之外，模块applyToProducts没有有效的app产品声明；AppScope/app.json5引用app_name/app_icon但AppScope/resources不存在。已有测试只检查文件/文案，没有验证这些声明链接。

参考：官方openharmony/applications_app_samples的OpenHarmony-4.0-Release StageModel样例，固定提交e54e3ce7a019e33c2c5c1382dd3b1ba19632af3d。仅参考API10 Stage的产品层级和资源作用域，不把OpenHarmony样例当作HarmonyOS4平台权限或SDK兼容性证据。

执行：先添加产品/模块链接及AppScope资源回归并确认失败；移动现有产品声明到app.products，补自有名称和复用现有图标资源；不修改SDK版本、runtimeOS、Hvigor依赖/modelVersion或签名；运行完整Node测试及远端CI，提交目标dev的PR。原生编译/安装仍未验证。

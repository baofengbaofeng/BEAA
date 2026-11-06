# HarmonyOS 4 原生 UI 验证工程（ArkUI / Stage）

首期测试设备：MatePad 11 / HarmonyOS 4。产品内不出现平台品牌信息。

## 当前入口与已包含源码

- Stage UIAbility、资源、基础构建文件；主入口`Index.ets`使用ArkWeb加载同仓库浏览器离线页面。
- 复用响应式主页、答题/休息、题库导入/筛选、错题/统计、本地PIN、临时时段、审计和摘要导出源码；宿主仅有摘要导出/模拟提醒输入/暂停三个方法，无设备控制或凭据桥。
- `npm run build:native-preview`更新rawfile，`npm run check:sources`检查与浏览器/共享时段源码一致。生成资源不是SDK编译。
- 原ArkUI内存演示保存在`reference/LegacyIndex.ets.txt`，不再作为主入口编译，避免继续使用未持久化的第二份演示规则。

## 拿到设备后按步骤验收

先阅读[逐步操作手册](../../docs/DEVICE_POC.md)，复制[验收记录模板](../../docs/testing/DEVICE_ACCEPTANCE_RECORD_TEMPLATE.md)。从型号/系统/电脑信息开始，按连接、正式权限验证、原生接入/构建、安装和默认规则实测顺序执行；模板全部未执行，不能把本说明或演示骨架当作已通过报告。

## 如何尝试
1. 使用与目标设备相匹配的 DevEco Studio 版本和 HarmonyOS SDK 打开 `apps/harmony/`。
2. 让 IDE 同步 `hvigor` 和 `ohpm` 依赖；如 SDK 与构建插件不匹配，以 **DevEco Studio 同版本生成的 Empty Ability/Stage 模板** 配置为准，迁移本目录 `entry/src/main/ets` 与资源文件。
3. 在 IDE 中配置本地签名（**不要提交任何证书或密钥到 GitHub**）。
4. 首次构建后运行在设备或兼容的模拟器上，按手册N10验证WebView/WebCrypto、宽窄窗口、所有页面、保存重开与下载，再执行真实设备门禁。

## 特别限制
- **尚未通过 DevEco Studio 编译，也没有 HAP 安装包。** 当前仓库环境缺少专用 SDK，不能保证直接打开后零调整通过。
- 页面上的模拟使用按钮不会读取真实系统使用时长或限制其他应用；主页/页脚明确告知。
- 休息检查仍使用浏览器演示时间，不进行真实离屏检测。
- 页面源码已有localStorage/PBKDF2 PIN和恢复检查，但在目标WebView上未验证可用、隔离或安全。它不是原生安全存储，清除/修改网页数据可绕过。WebCrypto可用性与blob下载处理须实际验收；已有严格摘要保存宿主候选源码，但文件选择器/写入和通知/RDB适配未编译；按设备证据记通过或阻塞。
- `shared/domain/engine.mjs` 是可独立用 Node 运行的规则原型，不是可以直接由 ArkTS 调用的模块。

## 下一道技术门禁
在真实 MatePad 11 上确认 HarmonyOS 4 可用的官方计时与限制权限，再实现 `DeviceControlAdapter`；否则仅能诚实提供应用内计时/学习挑战功能。


## 自动构建前置项预检

在仓库根目录运行 `npm run native:preflight`，或 `npm run native:preflight -- --sdk /path/to/sdk`。显式路径优先，否则按顺序选择DEVECO_SDK_HOME、HARMONYOS_SDK_HOME、OHOS_SDK_HOME中实际存在的目录；不输出变量值。

工具检查PATH中的java、ohpm、hvigor可执行性和版本；hdc作为后续设备工具单独报告，不阻止构建前置项检查。IDE内置工具若未进入终端PATH，仍会显示缺失；应在对应IDE的开发终端运行，或按正式安装说明配置PATH。

退出2表示缺前置项，退出0仅表示检测到命令与所选目录，不代表SDK内容正确、版本兼容、签名有效或编译通过；参数错误退出1。脚本不会下载SDK、修改工程版本、读取证书或连接设备。工具版本命令有10秒超时。

当前云环境实际预检见[原生环境报告](../../docs/testing/NATIVE_PREFLIGHT.md)。后续必须在匹配工具链中执行真实构建并保存HAP/日志，再进行真机验收。

## 已核对的 Stage 结构

默认产品声明位于 `build-profile.json5` 的 `app.products`，模块的 `applyToProducts` 关联该产品。`AppScope/app.json5` 中的应用名称和图标在 `AppScope/resources/base` 下提供；入口模块保留自身资源。

结构参照官方 OpenHarmony 4/API 10 [StageModel build-profile](https://github.com/openharmony/applications_app_samples/blob/e54e3ce7a019e33c2c5c1382dd3b1ba19632af3d/code/BasicFeature/ApplicationModels/StageModel/build-profile.json5) 和 [AppScope名称资源](https://github.com/openharmony/applications_app_samples/blob/e54e3ce7a019e33c2c5c1382dd3b1ba19632af3d/code/BasicFeature/ApplicationModels/StageModel/AppScope/resources/base/element/string.json)。只引用通用Stage结构，未采用样例的SDK、运行平台或签名配置。图标复用本项目既有素材。

`npm test` 现在验证应用产品/模块目标链接、AppScope资源解析，并使用JSON5解析器读取.json5配置。静态检查不能替代真实SDK编译、图标资源打包、安装和设备验收；相关门禁仍未通过。

## 原生宿主与提醒候选服务

新增摘要校验与UTF8完整保存、请求回执；提醒队列的稳定ID/CAS/租约/重试/撤权和过期取消，以及原生文件选择器、加密RDB配置、通知API和生命周期接入源码。`npm run check:native-core`只对纯服务作TypeScript验证，`npm run demo:notifications`使用真实SQLite和记录型通知替身。[接口/API来源与限制](NATIVE_SERVICES.md) · [验证报告](../../docs/testing/NATIVE_SERVICES_REPORT.md)。所有OS适配仍待目标SDK构建和真机验收，不代表真实监控或强制限制已实现。

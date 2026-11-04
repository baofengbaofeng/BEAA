# HarmonyOS 4 原生 UI 验证工程（ArkUI / Stage）

首期测试设备：MatePad 11 / HarmonyOS 4。产品内不出现平台品牌信息。

## 已包含
- Stage UIAbility、资源、基础构建文件及入口页
- 自适应栅格（窄屏单栏、宽屏双栏）
- 五个交互页面状态：儿童主页、5题挑战、成功、休息、家长设置
- 示例题目与错误解释（当前只是页面内演示数据）

## 如何尝试
1. 使用与目标设备相匹配的 DevEco Studio 版本和 HarmonyOS SDK 打开 `apps/harmony/`。
2. 让 IDE 同步 `hvigor` 和 `ohpm` 依赖；如 SDK 与构建插件不匹配，以 **DevEco Studio 同版本生成的 Empty Ability/Stage 模板** 配置为准，迁移本目录 `entry/src/main/ets` 与资源文件。
3. 在 IDE 中配置本地签名（**不要提交任何证书或密钥到 GitHub**）。
4. 首次构建后运行在设备或兼容的模拟器上，验证横竖屏、宽窄窗口和四个页面的跳转。

## 特别限制
- **尚未通过 DevEco Studio 编译，也没有 HAP 安装包。** 当前仓库环境缺少专用 SDK，不能保证直接打开后零调整通过。
- 页面上的“模拟使用时间到期”按钮不会读取真实系统使用时长或限制其他应用。
- “完成休息”只是交互演示，不进行真实离屏检测。
- 家长设置未保存、未校验密码；生产版本必须引入可信数据来源、授权和持久化。
- `shared/domain/engine.mjs` 是可独立用 Node 运行的规则原型，不是可以直接由 ArkTS 调用的模块。

## 下一道技术门禁
在真实 MatePad 11 上确认 HarmonyOS 4 可用的官方计时与限制权限，再实现 `DeviceControlAdapter`；否则仅能诚实提供应用内计时/学习挑战功能。

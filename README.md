# 学知守护（BEAA）

儿童防沉迷与学习答题解锁应用。使用周期到期后完成学习挑战并休息，才可取得下一轮使用资格；每日使用总量受独立硬上限保护。

## 当前范围
- 首发验证：MatePad 11 / HarmonyOS 4（仅内部技术信息，软件界面不显示平台品牌）
- 未来预留 iPadOS 实现；横竖屏自动适配
- 初始规则：30分钟/轮、120分钟/日、语数英5题全对、休息10分钟；均由家长设置
- 本地优先，不依赖联网解答基础题目

## 状态
**已提交 ArkUI 原生交互页面与 Stage 项目骨架，但尚未经过 DevEco Studio 编译或真机安装验证。** HarmonyOS 4 对第三方应用的使用监控与限制能力尚需真机验证，不能宣称已支持全设备锁定。

原生 UI 源码入口：[apps/harmony/entry/src/main/ets/pages/Index.ets](apps/harmony/entry/src/main/ets/pages/Index.ets)。运行说明：[apps/harmony/README.md](apps/harmony/README.md)。设备能力验证：[docs/DEVICE_POC.md](docs/DEVICE_POC.md)。

## 文档
- [产品需求](docs/PRD.md)
- [架构和风险](docs/ARCHITECTURE.md)
- [UI规范](docs/UI_DESIGN.md)
- [开发路线](docs/ROADMAP.md)
- [验收测试](tests/ACCEPTANCE.md)

## 目录
`apps/harmony` 首发客户端；`apps/ios` 未来版本；`shared/schemas` 配置定义；`shared/quiz` 题库样例；`tests` 验收基线。

## 分支
`master` 稳定；`dev` 开发集成；新增功能通过 `feature/*` 分支和PR进入开发分支。

## 不需要平板环境的预览

[浏览器交互原型](apps/web-preview/index.html) · [使用说明](apps/web-preview/README.md)。下载 HTML 后直接用浏览器打开，体验模拟计时、答题、休息和家长设置。**仅用于演示，不具备系统应用限制能力。**

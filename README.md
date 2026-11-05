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

## 浏览器 MVP 开发与验证

已加入配置题库、错题复习、学习记录、本地家长 PIN 及恢复测试。`npm ci && npm test` 验证规则；`npm run test:browser` 运行真实浏览器测试（先安装 Playwright Chromium），`npm run build:demo` 生成独立 HTML 演示包。详细命令见 [浏览器说明](apps/web-preview/README.md)，实际结果与限制见 [测试报告](docs/testing/BROWSER_MVP_REPORT.md)。这仍是模拟使用数据的浏览器演示，不是已验收的原生设备管控产品。

## 云端 SQLite 存储参考

`npm run demo:sqlite` 在真实SQLite数据库上运行共享生命周期及恢复示例，需要Node20+、Python3.11+与POSIX环境，无新增依赖。并发CAS、提交前后进程SIGKILL恢复等测试随`npm test`执行。见[参考适配器说明](apps/node-reference/README.md)和[验证报告](docs/testing/SQLITE_REFERENCE_REPORT.md)。这是云端存储证据，不代表原生后端、真实计时或设备管控已验收。

参考数据库支持`npm run backup:sqlite -- --source PATH --target NEW_PATH`一致备份，以及`npm run inspect:sqlite -- --source PATH`只读检查；目录需满足私有权限要求，目标不得已存在。工具仅输出元数据，不自动用旧副本恢复账本。见[备份验证报告](docs/testing/SQLITE_BACKUP_REPORT.md)。

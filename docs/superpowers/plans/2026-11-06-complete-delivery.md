# Complete Functional Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, followed by independent whole-branch review.

**Goal:** 集中补齐可离线验证的产品缺口、原生离线入口和统一交付包。
**Architecture:** 共享临时时段纯模块嵌入既有HTML；浏览器保持同一存储和WebLock；原生rawfile复用测试过的页面；统一打包源代码/证据，真实设备另验。
**Tech Stack:** 现有Node/Python/Playwright、单HTML、ArkUI Web组件，无新增运行依赖。
**Spec:** docs/superpowers/specs/2026-11-06-complete-delivery-design.md

## Global Constraints
- 每日硬上限、必须休息、首次正确成绩、模拟边界和平台中立保持。
- 临时时段1–30分钟且不超正常余量；过期/回拨不自动退出临时模式放行。
- 不改guardian schema、不伪造原生构建/通知/跨应用/健康证据。

## Review Focus
- 损坏关键存储不能默认新建或覆写；可选坏记录不丢累计/PIN。
- 多标签页/异步PIN/保存失败期间不能发资格或临时预算。
- 暂停、跨日、期限端点和时间回拨不能增加临时预算/解除挑战。
- 导出和审计不暴露凭据/注入HTML，学习记录不授予使用。
- 原生rawfile必须与已测源同步，离线包无网络请求或真实运行库/密钥。

### Task 1: 临时时段、页面提醒与恢复
**Files:** shared/domain/temporary-access.mjs及测试；scripts/embed-preview-domain.mjs；apps/web-preview/index.html；tests/web-preview.test.mjs；tests/browser/delivery.spec.mjs。
**Interfaces:** createTemporaryAccess / validateTemporaryAccess / observeTemporaryAccess / getTemporaryAccessStatus / closeTemporaryAccess；浏览器已有usage/clock/save和认证入口。
- [ ] 写纯模块边界/阶段/计数/回拨测试，确认缺失失败，最小实现通过。
- [ ] 先写浏览器授权/期限/审计/提醒/恢复失败用例，确认失败后接入。
- [ ] 导出学习摘要无凭据；真实浏览器交互/刷新/窄屏/axe通过。
- [ ] 针对与完整npm test通过，记录证据并提交。

### Task 2: 原生离线入口与整体交付
**Files:** apps/harmony/entry/src/main/ets/pages/Index.ets、LegacyDemo.ets、rawfile/beaa-preview.html；scripts/package-native-preview.mjs；scripts/package-delivery.mjs；tests/harmony-scaffold.test.mjs；tests/package-delivery.test.mjs；说明/交付索引/CI。
**Interfaces:** Task1已生成自包含HTML；原生rawfile不含JS桥；npm run build:delivery只本地产物。
- [ ] 写资源同步/路由/包内容与校验和测试，确认缺失失败，再实现脚本/入口。
- [ ] 补手册临时时段与原生WebView实际验收步骤，保留未执行。
- [ ] 完整Node、浏览器、示例、原生预检；保存真实报告/需求映射。
- [ ] 独立审查，必要红绿修复；dev功能PR、CI和交付包，不合并/部署。

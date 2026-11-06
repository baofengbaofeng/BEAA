# Native Services and Reminder Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline and final independent whole-branch review.

**Goal:** 落实摘要原生保存与可恢复提醒投递，继续清单可自动开发项。
**Architecture:** 纯TS原生服务同源执行测试；DocumentPicker/文件/通知/RDB源码适配；Node真实SQLite持久化参考；网页严格模拟快照与请求回执。
**Tech Stack:** 现有Node/Python/Playwright；新增锁定TypeScript开发依赖，非原生SDK。
**Spec:** docs/superpowers/specs/2026-11-06-native-services-design.md

## Global Constraints
- 单HTML离线/蓝绿/平台中立；默认30/10/120规则不变，guardian schema不变。
- 原生调用只保存脱敏摘要/演示通知，不能接受路径、凭据或控制设备请求。
- 稳定ID和CAS不等于恰好送达；失败/未知/撤权不能标成功或发资格。
- TS验证、SQLite和浏览器证据不得冒充HAP或真机验收。

## Review Focus
- 桥响应丢失/迟到/伪造ID不能让导出显示错误成功或泄漏私有数据。
- 重启/发布后未保存回执/并发lease只能同ID重试，不重用通知ID。
- 发布期间阶段/权限变化必须清理旧项，清理失败保留待办。
- 损坏队列/来源回放/时间回拨不自动新建或恢复旧通知。
- 短写/文件关闭失败/路径不由网页提供；原生数据无凭据/真实控制桥。

### Task 1: 原生摘要保存服务与窄桥
**Files:** services/NativeSummary.ts、平台文件适配/桥、Index.ets、网页导出分支、tests/native-summary.test.mjs与浏览器回执测试、native-core编译辅助。
**Interfaces:** validateSummary(text):string；SummaryExportService.exportSummary(text):Promise<string>；网页beaaNative.exportLearningSummary(requestId,text)与onNativeExportCompleted回执。
- [x] 写schema/中文UTF8/短写/取消/失败/忙碌测试，确认失败；实现纯TS服务。
- [x] 先写浏览器宿主等待/错误/无桥回退测试，确认失败，再接入限定方法与DocumentPicker/fs候选代码。
- [x] 针对和全量npm test通过；保存实际证据，提交。

### Task 2: 持久队列与模拟提醒接入
**Files:** services/ReminderDelivery.ts、Node SQLite端口/worker/demo、原生RDB/通知适配、网页模拟快照/序号、tests/reminder-delivery*.test.mjs。
**Interfaces:** ReminderSource.read/QueueStore.read+compareAndSwap/NotificationPort.authorization+publish+cancel，所有结果有限状态。
- [x] 写阈值/重启/去重/回放/失败退避/撤权/发布竞态/取消失败/租约测试，确认失败，再实现控制器。
- [x] 真实SQLite保存/CAS/重开/丢回执与四库隔离测试通过；demo:notifications有明确模拟声明。
- [x] 网页成功保存后递增序号/周期并交宿主；原生候选RDB/通知与显式权限按钮接通，静态校对API来源。
- [x] 全量Node/浏览器/示例/原生预检与统一打包；更新剩余清单与未执行设备步骤，独立审查与红绿修复已完成；准备dev PR和交付包，远程CI以对应提交检查为准，不合并/部署。

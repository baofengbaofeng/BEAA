# Usage Reminder Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, with final independent review.

**Goal:** 已提交有效使用计数的5分/1分提示与到期事件，无状态/设备副作用。
**Architecture:** 独立严格投影与相邻使用迁移核对，复用guardian reducer；读端口和真实SQLite示例；不改schema/既有controller。
**Tech Stack:** Node20+ ESM、node:test、现有Python/SQLite参考，无新依赖。
**Spec:** docs/superpowers/specs/2026-11-06-usage-reminders-design.md

## Global Constraints
- 只用可信已提交计数，不用墙钟/模拟前台时间当真实跨应用采样。
- 300/60/0秒边界；日上限相等优先；非AVAILABLE不计划使用倒计时。
- 不发送通知/不授予资格，不承诺通知幂等与送达；M1/原生源码和schema不变。

## Review Focus
- 根实际日累计不能取已截断session值：降限再升限及日锁回归。
- 批量跨阈值和短周期：只输出当前最紧急提醒，不重复/补发过期提醒。
- 伪造/错scope/不相邻迁移：完整reducer一致性核对，不输出可信事件。
- 跨日/休息/待生效策略：不能重置累计或绕过休息以通知授权。
- 存储变化/重启：只读当前revision，无通知送达或exactly-once假承诺。

### Task 1: 纯提醒计算、读视图与SQLite演示
**Files:** shared/domain/usage-reminders.mjs及.test.mjs、apps/node-reference/reminder-demo.mjs、tests/usage-reminder-store.test.mjs；package/CI/契约和验收文档。
**Interfaces:** getUsageGuidance(state)、getUsageReminderEvent(before,after)、readUsageGuidance(store)、UsageReminderError。

- [x] 写边界/状态/迁移/读取失败测试，运行确认缺失失败。
- [x] 实现严格投影/迁移核对与无副作用读函数，针对测试通过。
- [x] 增加真实SQLite保存/重开/计数保持和demo:reminders，接入CI。
- [x] 全量回归、独立审查/必要红绿修复、保存证据；更新N09及模板未执行状态。
- [x] 准备已验证功能分支与PR说明，基准dev；远程PR/CI结果以GitHub对应提交检查为准，不合并或部署，原生/真机状态不变。

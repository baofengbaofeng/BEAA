# Cross-platform Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现剩余可编码功能并准确区分外部验收。
**Architecture:** JS共享域/TS端口增量扩展；Swift 独立加密迁移；ArkTS 权限门控适配；各域独立测试后集成。
**Tech Stack:** Node20+, Python3, TypeScript, ArkTS, Swift17+ SDK。
**Spec:** docs/superpowers/specs/2026-11-09-cross-platform-completion-design.md

## Global Constraints
- 应用中文附拼音；旧数据与资格不得静默丢失。
- 无SDK不宣称平台编译成功；Apple测试用户后续执行。
- 本轮不自动推送或发布。

## Review Focus
- 旧版本快照/错题恢复与混合题型答案校验。
- 过期/重放/回拨授权不得返回额度。
- 迁移不可绕过目标端可信高水位与权限。
- 权限缺失、写入失败、进程中断必须保留现场。
- 教学内容必须保留未审核状态和发布门禁。

### Task 1: 共享混合题型与参考账本
- [x] 新增失败测试覆盖 v1兼容/v2题型/持久化首答与订正。
- [x] 扩展 shared/quiz、shared/domain 及需要的SQLite参考校验。
- [x] 执行域和真实SQLite往返/备份回归。

### Task 2: 网页与鸿蒙离线功能对齐
- [x] 为分数、容差、应急和历史统计编写规则/浏览器回归。
- [x] 修改网页并同步离线资源；保留旧格式迁移。
- [x] 执行相关Node与浏览器验证。

### Task 3: 鸿蒙原生安全后端与设备能力
- [x] 读取正式权限证据及现有宿主；先写事务/授权/失败关闭测试。
- [x] 实现服务、持久化与平台适配；无权限不模拟真实成功。
- [x] 执行纯服务测试和native preflight，记录原生构建缺口。

### Task 4: iOS 跨设备迁移
- [x] 写口令加密/防旧回退/授权后导入的XCTest源码。
- [x] 新增独立迁移文档/UI/存储流程，接入有效家长授权。
- [x] 再生成工程并只读校验；不执行Apple构建。

### Task 5: 课程与审核流水线
- [x] 编写覆盖目录/答案一致性/审核门禁测试。
- [x] 新增分级课程资源、审核清单及生成/验证工具。
- [x] 执行生成确定性与题库校验。

### Task 6: 集成与审查
- [x] 全套npm与相关浏览器回归、源码同步、工程结构验证。
- [x] 独立审查功能边界与回退风险，修正问题。
- [x] 更新剩余清单、交付报告与源码包，报告外部依赖。

外部条件保留：真实系统API/权限和SDK设备、Apple执行与教师完整课程审核不在自动化通过范围。

# Device Capability Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只读平台状态门禁与业务规则视图，防止未验证设备状态被当作真实解锁。
**Architecture:** 可信适配器端口加严格响应校验、整体超时和前后能力复核；只提供unsupported默认实现。生命周期前后读取保护过期结果，不改原聚合。
**Tech Stack:** Node20+ ESM、node:test，无新增依赖。
**Spec:** docs/superpowers/specs/2026-11-05-device-capability-gate-design.md

## Global Constraints
- M1不修改；无原生权限、SDK编译或真机验收声明。
- 查询总超时默认3000，允许1–30000毫秒；所有输入/输出按设计文档严格校验。
- 只读，不申请权限或调用真实限制/解除；任何结果deviceControlValidated=false。

## Review Focus
- 权限在限制查询期间撤销：重读能力并拒绝reported_ready。
- 永不完成/晚返回/同步抛错：整体限时且不修改晚返回结果。
- 错scope、版本不符或原地修改返回对象：拒绝或捕获独立快照。
- 业务账本在查询期间变化：拒绝过期视图，不操作设备。
- unsupported事件流：明确错误而非伪造零使用量。

### Task 1: 查询契约、降级适配器与规则视图
**Files:** 新建 shared/domain/device-control.mjs、shared/domain/device-control.test.mjs、apps/node-reference/device-demo.mjs；更新package.json与说明/测试报告。
**Interfaces:** 消费 decodeGuardianLifecycle/getGuardianView；提供 probeDeviceControl(adapter,options)、createUnsupportedDeviceControlAdapter(scopeId)、readGuardedUsageView(store,adapter,options)、DeviceControlError。

- [x] 先写node:test：不支持/未授权/撤权/未知/失败分支、严格格式、scope/revision变化、前后权限变化、可用状态双向匹配、超时/晚返回、原地修改对象、只读账本一致性及默认适配器事件流错误。
- [x] 运行node --test shared/domain/device-control.test.mjs，确认功能缺失导致失败。
- [x] 最小实现上述接口，运行针对测试与npm test直到通过。
- [x] 新增使用unsupported默认适配器与真实SQLite账本的演示：规则允许但设备未验证、重开账本不变。接入CI执行demo:device。
- [x] 运行完整Node与浏览器回归、实际原生预检，保留真实结果和范围限制。
- [ ] 独立整分支审查，修复重要问题并补红绿回归；提交独立分支PR到dev并等待CI，不合并或部署。

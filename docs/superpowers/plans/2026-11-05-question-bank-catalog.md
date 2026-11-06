# Question Bank Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline, with one final independent review.

**Goal:** 家长验证后原子保存离线题库，新轮次读取目录，当前题快照不变。
**Architecture:** 独立版本化目录与CAS，不改guardian schema；家长网关复用可信authorizer；SQLite参考复用已有私有路径/进程传输安全代码。
**Tech Stack:** Node20+ ESM、node:test、Python3.11+/POSIX SQLite。
**Spec:** docs/superpowers/specs/2026-11-05-question-bank-catalog-design.md

## Global Constraints
- 不修改M1/原生UI，不改变使用资格，无新增依赖；无原生/设备/健康效果验收声明。
- 目录最大2,000,000 UTF16码元，题库格式沿用version1/1–2000题；家庭ID/事件ID/修订号严格验证。
- 题库导入只更新目录，正在答题/归档使用已固定原题与答案。

## Review Focus
- 导入期间客户端修改输入/身份撤销：捕获输入并在提交前复核，不写未授权目录。
- 同ID不同导入、过期版本与提交应答丢失：拒绝复用/冲突，重复不二次加版本。
- 进行中题库更换：原评分/进度/历史不变，下一轮用新题。
- 目录损坏/跨家庭/题量不足：保留使用账本，不默认放行或重复凑题。
- SQLite私有路径、错误数据库、独立进程并发：拒绝不安全输入，同revision仅一写入成功。

### Task 1: 目录、授权导入、组卷接入与真实SQLite参考
**Files:** shared/quiz/catalog.mjs及.test.mjs；shared/domain/question-bank-service.mjs及.test.mjs；apps/node-reference/question-bank-store.mjs/question_bank_worker.py/question-bank-demo.mjs；tests/question-bank-store.test.mjs；package/CI/接口和测试说明。
**Interfaces:** create/validate/encode/decodeQuestionBankCatalog、applyQuestionBankImport、summarizeQuestionBank；commitParentQuestionBank、beginQuizFromQuestionBank；create/openSqliteQuestionBankStore。

- [x] 先写目录/网关/开始测验测试，运行并确认功能缺失失败。
- [x] 实现纯目录与应用服务，覆盖严格输入、重复/冲突、前后授权、固定题快照与无写入失败；针对测试全绿。
- [x] 先写SQLite集成测试并确认失败；实现独立目录worker/端口，验证真实PIN、重开/并发/应答丢失/损坏/路径和题库中途导入。
- [x] 增加demo:bank并纳入CI，跑完整npm test/浏览器回归/原生预检，保存原始证据。
- [ ] 独立整分支审查并修复重要问题；提交dev PR并确认CI，不合并或发布网站。

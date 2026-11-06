# Starter Question Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, with a final independent code/content review.

**Goal:** 90道可筛选基础练习以及可直接导入现有浏览器原型的交付文件。
**Architecture:** 独立JSON内容；复用共享题库校验/组卷；严格转换到既有浏览器格式；确定性包与真实UI导入回归。不改已验收M1。
**Tech Stack:** Node20+ ESM、node:test、Python3.11 Fraction/AST质量核对、现有Playwright。
**Spec:** docs/superpowers/specs/2026-11-06-starter-bank-design.md

## Global Constraints
- 1–6年级×3科×5题=90；结构/答案回归不是教师审核或完整课程声明。
- 原5题sample与浏览器/自检/原生源码保持不变，不自动覆盖家庭数据。
- 浏览器转换遵守既有ID80/题干1000/选项500/解释2000码元上限，粗标签只用现有3种。

## Review Focus
- 数学小数/分数与等值多选歧义：独立精确数值计算验证。
- 英语多义和语文表述/诗句：显式事实回归，独立内容审查，保留教师审核边界。
- 共享选项ID转换成浏览器索引：逐题比较内容/答案及实际UI答题。
- 导出缺题或标签筛不到：18个年级学科/主知识点分别组5题，不能凑题。
- 无效输入或浏览器不兼容数据：校验先于输出；已有文件逐字节保持，无关文件不被清理。

### Task 1: 基础题库、严格导出和可复现交付
**Files:** shared/quiz/starter-questions.json、STARTER_BANK.md、browser-export.mjs及测试；scripts/package-starter-bank.mjs；tests/package-starter-bank.test.mjs；tests/browser/starter-bank.spec.mjs；package/文档/CI。
**Interfaces:** exportBrowserQuestionBank(input)返回兼容数组；buildStarterBank({sourcePath,outputDirectory})验证/生成共享、浏览器、覆盖、说明、SHA256SUMS文件；CLI --source/--output-dir供构建与隔离测试。

- [x] 先写90题覆盖、数学精确值、语言事实和格式转换失败测试，运行观察缺失失败。
- [x] 编写90题与转换实现，针对测试通过。
- [x] 先写包验证（内容等价、清单完整、可复现、非法输入无假通过输出）与浏览器18个导入/答题测试，确认缺失失败；实现构建与接入test:browser。
- [x] 全量Node/浏览器回归，实际原生预检；独立代码及内容审查，修复重要问题并保存证据。
- [ ] 提交独立功能分支dev PR、验证CI，交付文件与人工条件清单；不合并或部署。

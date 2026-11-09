# Answer types implementation plan

> **For agentic workers:** Inline web implementation and independent native task per dispatching-parallel-agents; fresh final code review.

**Goal:** Usable offline true/false and exact numeric questions in browser/Harmony and native iOS source.
**Architecture:** Shared client-response validator/normalizer embedded in offline web; legacy choice shapes retained, numeric typed persisted responses integrated into the existing lifecycle. Native equivalent with safe legacy Codable defaults.
**Tech Stack:** JavaScript/Node/Playwright, SwiftUI/Foundation/XCTest.
**Spec:** docs/superpowers/specs/2026-11-09-answer-types-design.md

## Global Constraints
No floating tolerance or extra quota; preserve first-answer scoring and quiet-hour guards; all Chinese has pinyin; no publish/push; Apple execution unverified on Linux.

## Review Focus
- Full-width, negative zero, decimal precision and hostile/non-number strings cannot accidentally pass.
- Invalid input does not consume first attempt or add a wrong answer.
- Wrong-first-then-correct never regains first-attempt score, including reload.
- Old single-choice saves and pending challenges remain valid.
- Numeric submissions queued behind locks cannot apply to another question or bypass quiet/day/rest rules.

### Task 1: Shared client typed-answer rules and web
- [x] Write and observe failing normalization/validation/grading unit tests.
- [x] Implement shared/quiz/answer-types.mjs and embed source.
- [x] Add failing page/browser tests, then numeric/boolean import, answer controls, scoring, persisted mistakes and review UI.
- [x] Add mixed client sample artifact, maintain standalone/Harmony resources and run full regression.

### Task 2: Native parity
- [x] Add XCTest first for normalization, legacy decode, import, grading and restored numeric mistakes.
- [x] Implement type-specific model/response validation and SwiftUI quiz/review controls; retain native policy/quiet guards.
- [x] Regenerate project and validate structure; record native build/tests unrun without Xcode.

### Task 3: Review and delivery
- [x] Review sources independently, inspect screenshots/accessibility and correct findings with regression coverage.
- [x] Update docs/remaining tasks and verify current source delivery archive.


## Evidence
Shared normalization tests were observed RED before implementation and then passed. New web import/type-label tests were RED and then passed; mixed asset ZIP consumer assertions failed before producer addition and passed afterward. Full suite:408 Node passes;59 browser passes/2 policy skips. Phone/tablet numeric and boolean screens inspected; numeric review accessibility passed. Independent review found no Critical/Important defects; minor whitespace parity fixed in source with JS tests passed and Swift tests written but unrun. Native project structure12 sources/7 test files passed; noSwift/Xcode available, so compilation/XCTest remain unverified. Shared v1/SQLite protocol intentionally remains single-choice. No environment publish or remote push.

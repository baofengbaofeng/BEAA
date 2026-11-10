# Quiet hours implementation plan

> **For agentic workers:** Use inline execution with an independent native implementation per dispatching-parallel-agents, then fresh final review.

**Goal:** Deliver weekly protected quiet hours across web/Harmony preview and native iOS source.
**Architecture:** Strict pure JS window validation/evaluation embedded into offline preview; Swift matching model and native protected editor. Schedule overlays existing lifecycle without clearing progress.
**Tech Stack:** JavaScript, Node tests, Playwright, SwiftUI/Foundation/XCTest.
**Spec:** docs/superpowers/specs/2026-11-09-quiet-hours-design.md

## Global Constraints
ISO weekdays1–7, max14 windows, start inclusive/end exclusive, equal endpoints rejected; local clock only; keep pinyin and data; no external publication.

## Review Focus
- Midnight and Sunday/Monday rollover follow window start weekday.
- Corrupt schedules block use without overwriting original records.
- Pending quiz/rest/daily totals survive quiet-hour transitions.
- Parent authority expiry and concurrent tabs prevent stale schedule writes.
- Active temporary budgets stop on entry and cannot resume silently.

### Task 1: Shared rules and web integration
- [x] Write/run failing schedule unit tests (boundaries, wrap, overlaps, invalid config/clock).
- [x] Implement validateQuietWindows(windows) and evaluateQuietHours(windows,{weekday,minute}) in shared/domain/quiet-hours.mjs.
- [x] Add browser tests for parent editor, protection, persisted reload, quiet-hour transitions, pinyin, narrow layout and unchanged business progress.
- [x] Embed shared rules, add validated legacy-compatible schedule field, guarded actions and protected editor, read-only tick refresh.
- [x] Run focused and full tests, resource synchronization and package checks.

### Task 2: Native iOS
- [x] Add equivalent Swift window model/validator/evaluator and XCTest cases first.
- [x] Add protected editor and tick/action guards preserving phase/progress; migrate old Policy decoding safely.
- [x] Regenerate project, run structural checks; mark Apple tests unrun without Xcode.

### Task 3: Review and delivery
- [x] Inspect browser screenshots, independent code review, correct findings with regression coverage.
- [x] Update remaining work/docs and generate matching delivery archive; no publish/push.


## Evidence and decisions
Shared/web tests were written and observed failing before implementation. Added rest checkpoints to preserve already-earned eligible rest across rule edits; damaged accumulator bounds reject original snapshots without overwriting. Added a browser regression for retaining parent drafts at schedule transitions. New schedules apply prospectively for existing temporary-use history. Native pure/editor/guard source and XCTest are implemented; no Swift/Xcode exists here, so native compilation and assertions remain unrun. Independent review checked boundary/decode/guards; a stale reported credit-bound finding was verified already guarded, and a new observation-before-rest-start regression was fixed. Final command counts belong in the delivery report. No publish or remote push.

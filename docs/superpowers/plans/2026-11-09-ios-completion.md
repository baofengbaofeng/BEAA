# iOS remaining features implementation plan

> **For agentic workers:** Parallel independent file ownership per dispatching-parallel-agents; root integrates and fresh reviewers audit. User defers Apple compilation/tests.

**Goal:** Deliver remaining iOS feature source in one cohesive app rather than successive partial batches.
**Architecture:** Existing SwiftUI lifecycle plus secure store, advanced learning/emergency core, optional ScreenTime+notification services, opt-in CloudKit collaboration; configuration gates remain explicit.
**Tech Stack:** SwiftUI/Foundation/CryptoKit/Security/LocalAuthentication/CloudKit/FamilyControls/ManagedSettings/DeviceActivity/UserNotifications, Python project generator, XCTest source.
**Spec:** docs/superpowers/specs/2026-11-09-ios-completion-design.md

## Global Constraints
Chinese pinyin; preserve counters and first-attempt grading; no extra allowance past daily/quiet/rest limits; explicit capabilities; no real cloud/permission requests, publish or push; Apple compilation/tests deferred per user.

## Review Focus
- Replayed/stale backup or remote command cannot reset budgets or repeat a grant.
- Revoked authorization, missing AppGroup/entitlements and unknown platform state fail honestly.
- Main-app and extension state/events avoid lost writes and duplicate thresholds.
- Legacy saved Questions/Policy/state remain decodable without granting new allowance.
- UI permissions, pairing, import/export and cancellation do not bypass parent auth.

### Task 1: Native learning and emergency core
- [ ] XCTest source first, exact fractions/tolerance, emergency grants and preserved guards.
- [ ] Bundled90 sample questions, dashboard/review, native input UI and model integration APIs.

### Task 2: Secure state and family security
- [ ] XCTest source first for authenticated storage/migration/high-water/backup and PIN operations.
- [ ] SecureStateStore, recovery/backup, PIN/recovery-code/optional biometric services and native security UI.

### Task 3: Platform services
- [ ] Pure planner/event tests source, ScreenTime authorization/selection/shield/monitor receipts and notifications.
- [ ] Monitor extension source and AppGroup/capability configuration contracts.

### Task 4: Cloud collaboration
- [ ] Command-gate/replay/revision test source, opt-in CloudKit account/assets/sharing/commands/receipts.
- [ ] Native pairing/report/catalog/remote-parent UI with explicit trusted-participant confirmation.

### Task 5: Root integration and delivery
- [ ] Wire app services, guarded parent actions and capability states; audit all UI text for pinyin.
- [ ] Extend actual project resources/extensions/entitlements/config templates and read-only validator.
- [ ] Fresh review, resolve meaningful findings, run available structural/Node checks, package source and user acceptance guide. Do not execute Apple tests.

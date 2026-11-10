# Accessible clients implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and independent iOS task per dispatching-parallel-agents.

**Goal:** Ship offline tone-marked pinyin interfaces and a native iOS client with honest capability boundaries.
**Architecture:** Embedded offline Chinese reading engine and DOM annotation preserve existing business state; SwiftUI separates native views, persisted core and credentials.
**Tech Stack:** JavaScript/HTML, Playwright, SwiftUI/Foundation/Keychain, XCTest.
**Spec:** docs/superpowers/specs/2026-11-09-accessible-clients-design.md

## Global Constraints
All Chinese UI gets pinyin by default; no remote transliteration; preserve state/authorization rules; no environment publication; Apple validation requires macOS.

## Review Focus
- Polyphonic words and imported content receive context readings and cannot inject HTML.
- Ruby annotation preserves accessible names and original text for business checks.
- Narrow views and large fonts wrap without horizontal overflow.
- Corrupt or unwritable state blocks grants rather than resetting budgets.
- Revoked parent authority and daily caps remain effective across reloads.

### Task 1: Offline pinyin and reusable web presentation
- [x] Add failing browser tests for Chinese navigation/dynamic prompts, imported content, polyphonic phrases, accessible names and narrow layout.
- [x] Add pinned offline reading engine and repeatable embedding script; annotate text nodes safely with ruby and aria-hidden readings, leave inputs unchanged.
- [x] Improve navigation/card/form styles, ensure standalone builds and Harmony resource include identical sources.
- [x] Run browser suite, Node suite, source checks and packaging.

### Task 2: Native iOS (independent implementation)
- [x] Add XCTest lifecycle tests first; create SwiftUI project, native core and durable store, Keychain PIN, pinyin components and native pages.
- [x] Inspect project/test wiring and supply macOS build/test commands; mark Apple-only checks unrun if unavailable.

### Task 3: Integration and review
- [x] Inspect screenshots and full automated results, request independent review, fix meaningful findings and rerun affected checks.
- [x] Update remaining-work and user docs with verified evidence and unresolved native capability gates.


## Implementation evidence

Web: 389 Node tests passed; full browser suite 51 passed/2 policy skips, followed by 21 passed/2 policy skips for the final PIN layout adjustment. Offline resource checks and packaging passed. Native: 9 source files, 5 XCTest files, shared scheme and macOS CI; project validation is read-only and passed. XCTest assertions and native UI have not run: Linux lacks Swift/Xcode. Independent review found timer precision, temporary-mode continuation and import compatibility defects; implemented fixes and test cases, with Apple execution still pending. No environment publication or remote push performed.

Conservative decisions: native timing covers continuous foreground intervals only; native temporary use is an AVAILABLE-only subbudget bounded by existing cycle/day quota, matching shared domain contract; system restrictions, trusted device rest and signing remain platform gates. Unverified Apple behavior must not be described as a completed device-control product.

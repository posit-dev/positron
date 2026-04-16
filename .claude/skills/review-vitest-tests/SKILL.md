---
name: review-vitest-tests
description: Use when reviewing Vitest test files for quality, maintainability, and adherence to Positron's testing patterns. Load this skill when test files need a quality check against the builder pattern, RTL patterns, and project conventions. Not for e2e or Playwright tests.
---

# Positron Vitest Test Review

Review Vitest test files for quality, maintainability, and adherence to the project's testing patterns. Evaluate them on their own merits with no context about why they were written this way.

## Arguments

$ARGUMENTS should contain the test file path(s) to review. For each test file, also identify the corresponding source file under test.

## Setup

1. Read each test file and its source file.
2. Read `.claude/rules/vitest.md` for patterns, conventions, and common mistakes.
3. Read the builder JSDoc: `src/vs/test/vitest/positronTestContainer.ts`

## Checklist (per test file)

Evaluate each test file against this checklist. Report ONLY items that fail -- don't list passing items. Also flag any cross-file inconsistencies (e.g., same service stubbed differently, different assertion styles for the same pattern).

### 1. Unused declarations and import bloat

Any variables, emitters, or imports declared but never referenced in a test? Suite-level `let` variables that only exist for setup wiring should be inlined into the stub objects instead. Also flag excessive imports: if 5+ service identifiers are imported only for `.stub()` calls, suggest extracting the stubs into a helper function to reduce the import block.

### 2. Builder adoption

Is the test using `createTestContainer()`? Flag any usage of `positronWorkbenchInstantiationService()` or `createRuntimeServices()` as a failure -- use the builder's presets instead. The only exception is plain tests (no services) that use `ensureNoLeakedDisposables()` directly for disposable tracking.

### 3. Setup weight

Count lines of setup vs number of tests. If the ratio exceeds 10:1, suggest extracting a helper function. If 2+ test files would need the same setup, suggest a new builder preset.

### 4. Mock minimality

Any stubs that mock more than what the tests actually exercise? Any stub objects with unused properties?

### 5. Edge case coverage

For each public method or event tested, is there: (a) a happy-path test, (b) a no-op or boundary test, (c) at least one negative or interaction test? List specific missing cases.

### 6. Pattern consistency

Read 1-2 existing test files in the same directory. Does this test follow the same conventions for: helper function style, assertion patterns, variable naming, test grouping?

### 7. Test isolation

Any shared mutable state that could leak between tests? Any test that depends on another test's side effects?

### 8. Shared vs per-test resources

Are runtimes/sessions created per-test when a shared one would suffice? Or shared when per-test isolation is needed?

### 9. Emitter scoping

Any `new Emitter()` created inside an `it()` callback whose `.event` is expected to reach a service wired via `.stub()`? The emitter must be at describe level (or in a helper called at describe level) so `.stub()` captures the correct `.event` reference during `build()`.

### 10. Spy cleanup

Any `vi.spyOn(console, ...)` or `vi.spyOn(obj, 'method')` without a corresponding restore? Check for either `spy.mockRestore()` after use, `afterEach(() => vi.restoreAllMocks())`, or `restoreMocks: true` in vitest config. Without cleanup, mocked `console.error`/`console.log` suppresses output for all subsequent tests in the file.

### 11. RTL query usage (React tests only)

For `.vitest.tsx` files using `setupRTLRenderer`: are there `container.querySelector` calls that could use `getByRole` or `getByText` instead? Flag cases where the component renders visible text or accessible roles that RTL can query directly. Note: many Positron components use internal CSS classes without accessible roles -- `container.querySelector` is acceptable when RTL queries aren't feasible.

## Output format

Group findings by test file. For each failing item, report:
- The checklist number and name
- What specifically is wrong
- A concrete fix (not just "improve this")

If a test file has no issues, say "No issues found" for that file.

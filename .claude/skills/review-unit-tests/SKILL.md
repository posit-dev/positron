---
name: review-unit-tests
description: Use when reviewing unit test files for quality, maintainability, and adherence to Positron's testing patterns. Load this skill when test files need a quality check against the builder pattern and project conventions.
---

# Positron Unit Test Review

Review unit test files for quality, maintainability, and adherence to the project's testing patterns. Evaluate them on their own merits with no context about why they were written this way.

## Arguments

$ARGUMENTS should contain the test file path(s) to review. For each test file, also identify the corresponding source file under test.

## Setup

1. Read each test file and its source file.
2. Read the builder reference: `src/vs/workbench/test/browser/positronTestContainer.ts`
3. Read the Testing section of `CLAUDE.md`

## Checklist (per test file)

Evaluate each test file against this checklist. Report ONLY items that fail -- don't list passing items. Also flag any cross-file inconsistencies (e.g., same service stubbed differently, different assertion styles for the same pattern).

### 1. Unused declarations and import bloat

Any variables, emitters, or imports declared but never referenced in a test? Suite-level `let` variables that only exist for setup wiring should be inlined into the stub objects instead. Also flag excessive imports: if 5+ service identifiers are imported only for `.stub()` calls, suggest extracting the stubs into a helper function to reduce the import block.

### 2. Builder adoption

Is the test using `createTestContainer()`? Flag any usage of `positronWorkbenchInstantiationService()`, `createRuntimeServices()`, or raw `ensureNoDisposablesAreLeakedInTestSuite()` as a failure. All Positron tests use the builder. The only exception is files in `test/common/` directories that cannot import from the `browser` layer.

### 3. Setup weight

Count lines of setup vs number of tests. If the ratio exceeds 10:1, suggest extracting a helper function. If 2+ test files would need the same setup, suggest a new builder preset.

### 4. Mock minimality

Any stubs that mock more than what the tests actually exercise? Any `as Partial<T>` that could be `{} as T` instead?

### 5. Edge case coverage

For each public method or event tested, is there: (a) a happy-path test, (b) a no-op or boundary test, (c) at least one negative or interaction test? List specific missing cases.

### 6. Pattern consistency

Read 1-2 existing test files in the same directory. Does this test follow the same conventions for: helper function style, assertion patterns, variable naming, test grouping?

### 7. Test isolation

Any shared mutable state that could leak between tests? Any test that depends on another test's side effects?

### 8. Shared vs per-test resources

Are runtimes/sessions created per-test when a shared one would suffice? Or shared when per-test isolation is needed?

## Output format

Group findings by test file. For each failing item, report:
- The checklist number and name
- What specifically is wrong
- A concrete fix (not just "improve this")

If a test file has no issues, say "No issues found" for that file.

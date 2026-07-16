---
name: review-vitest-tests
description: Use when reviewing Vitest test files (.vitest.ts/.tsx) for quality against Positron's builder pattern, RTL patterns, and conventions. Not for e2e or Playwright tests.
---

# Positron Vitest Test Review

Review Vitest test files for quality, maintainability, and adherence to the project's testing patterns. Evaluate them on their own merits with no context about why they were written this way.

## Arguments

$ARGUMENTS should contain the test file path(s) to review. For each test file, also identify the corresponding source file under test.

## Setup

1. Read each test file and its source file.
2. Read `.claude/rules/vitest-tests.md` for patterns, conventions, and common mistakes. For any `.vitest.tsx` file under review, also read `.claude/rules/vitest-rtl.md`.
3. Read the builder JSDoc: `src/vs/test/vitest/positronTestContainer.ts`

## Checklist (per test file)

Evaluate each test file against this checklist. Report ONLY items that fail -- don't list passing items. Also flag any cross-file inconsistencies (e.g., same service stubbed differently, different assertion styles for the same pattern).

### 0. Test value and falsifiability

For each test, ask: **what specific production code change would make it fail, and does that change represent a user-visible or system-observable regression?**

Flag any test where the answer is "I'm not sure" or where the test only verifies an implementation detail with no behavioral consequence — e.g., an internal counter value, a private array index, or a call count when the real invariant is a downstream side-effect. Coverage is a side-effect of good tests, not a goal. Every test should guard a specific regression that would matter.

Concrete check: mentally delete or mutate the production code path the test exercises. Would a user or the system notice the breakage? If not, the test is verifying structure, not behavior — flag it with a suggested behavioral rewrite or recommend dropping it.

### 1. Unused declarations and import bloat

Any variables, emitters, or imports declared but never referenced in a test? Suite-level `let` variables that only exist for setup wiring should be inlined into the stub objects instead. Also flag excessive imports: if 5+ service identifiers are imported only for `.stub()` calls, suggest extracting the stubs into a helper function to reduce the import block.

### 2. Anti-patterns

- **Builder adoption + assertion style:** scan against the "Builder anti-patterns" table in `.claude/rules/vitest-tests.md`. For each match, report `file:line`, the pattern found, and the row's "Use instead" value. Respect the "Exception" column.
- **Lint:** run `npx eslint --max-warnings 0 <file>` on every `.vitest.*` under review. The flag is required -- the pre-commit hook only fails on errors, so warnings accumulate silently without it. Report each finding with `file:line` and the rule name. The active rule sets include `eslint-plugin-testing-library` (query/action patterns) and `eslint-plugin-jest-dom` (matcher preferences — `prefer-to-have-focus`, `prefer-to-have-class`, `prefer-to-have-text-content`, etc.).
- **Suppression audit:** `grep -nE "eslint-disable.*(testing-library|jest-dom)/" <file>`. A clean lint run with a disable is not the same as a clean file. For each match, check the adjacent comment (or the commit that added it): does it name a real technical constraint, or is it convenience ("avoiding an await", "tests already passed")? Convenience disables should be rewritten to match the rule, not suppressed.
- **Wide-interface stub casts:** `grep -nE "as unknown as " <file>`. Each hit is a candidate for `stubInterface<T>()` or a `Null*`/`Test*` prebuilt -- see the "Avoid `{...} as unknown as <Interface>`" bullet in `.claude/rules/vitest-tests.md`. Skip narrowing casts where the runtime value really is the target type (`ctx.get(IService) as TestService`, `getByRole(...) as HTMLInputElement`, `getActions() as IAction[]`).
- **Private-method test-seams:** `grep -nE "type \w+WithPrivates|as \w+WithPrivates" <file>` — and any cast pattern that reaches into a class's private members from a test. Each hit is a candidate for the "Avoid private-method test-seams" rule in `.claude/rules/vitest-tests.md`: extract the private logic to a free exported function, or (for anonymous registered classes) promote to a named exported class. Document the recommended fix in the review finding.

The rules files (`vitest-tests.md`, `vitest-rtl.md`) are the single source of truth; this skill intentionally doesn't duplicate lists so they can't drift.

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

Any `vi.spyOn(console, ...)` or `vi.spyOn(obj, 'method')` without a corresponding restore? Accept only `restoreMocks: true` in the vitest config, `afterEach(() => vi.restoreAllMocks())`, or `spy.mockRestore()` inside a `finally` block. Flag inline `mockRestore()` placed after `expect` calls as fragile -- a failing assertion skips it, and the spy leaks into subsequent tests. (Note: the project's `vitest.config.ts` already sets `restoreMocks: true` globally, so most new tests need no per-file cleanup.)

## Output format

Group findings by test file. For each failing item, report:
- The checklist number and name
- What specifically is wrong
- A concrete fix (not just "improve this")

If a test file has no issues, say "No issues found" for that file.

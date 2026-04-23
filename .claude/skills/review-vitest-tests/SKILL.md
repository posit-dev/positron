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
2. Read `.claude/rules/vitest-tests.md` for patterns, conventions, and common mistakes.
3. Read the builder JSDoc: `src/vs/test/vitest/positronTestContainer.ts`

## Checklist (per test file)

Evaluate each test file against this checklist. Report ONLY items that fail -- don't list passing items. Also flag any cross-file inconsistencies (e.g., same service stubbed differently, different assertion styles for the same pattern).

### 1. Unused declarations and import bloat

Any variables, emitters, or imports declared but never referenced in a test? Suite-level `let` variables that only exist for setup wiring should be inlined into the stub objects instead. Also flag excessive imports: if 5+ service identifiers are imported only for `.stub()` calls, suggest extracting the stubs into a helper function to reduce the import block.

### 2. Builder adoption

Is the test using `createTestContainer()`? Flag any of these patterns as a failure -- use the builder's presets instead:

- `positronWorkbenchInstantiationService()`
- `createRuntimeServices()`
- `TestInstantiationService` (from `src/vs/platform/instantiation/test/common/instantiationServiceMock.ts`)
- `workbenchInstantiationService()` (the upstream VS Code helper from `src/vs/workbench/test/browser/workbenchTestServices.ts`)
- Hand-rolled `as unknown as PositronReactServices` accessor casts
- Direct mutation of `PositronReactServices.services = ...` (use `.stub()` and let `setupRTLRenderer` deliver via context)

Exceptions:

- Plain tests (no services) that use `ensureNoLeakedDisposables()` directly for disposable tracking.
- A `TestInstantiationService` constructed solely to hand to a test-helper service (e.g., `new TestCommandService(new TestInstantiationService())`) inside `beforeEach`, not used as a primary DI container.
- Shared test helpers invoked from test-runtime (inside `beforeEach` / `it`) may call `positronWorkbenchInstantiationService` directly, since `createTestContainer().build()` registers a describe-scope hook and can't be invoked from test-runtime. Flag only when the helper itself is consumed at describe scope (where the builder would work).

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

### 11. RTL query usage (React tests only)

For `.vitest.tsx` files using `setupRTLRenderer`: flag any `container.querySelector(...)` used as an assertion target. Use the Testing Library query priority instead: `getByRole` -> `getByLabelText` -> `getByPlaceholderText` -> `getByText` -> `getByDisplayValue` -> `getByAltText` -> `getByTitle` -> `getByTestId`. Escape hatches: `getByText('text', { selector: '.css' })` when the element has text, or `getByTestId(...)` when it doesn't. If neither fits (e.g., a structural div with no text and no stable role), suggest adding `data-testid` to the source rather than accepting `container.querySelector`. Add a brief inline comment when the escape-hatch choice isn't obvious. See `.claude/rules/vitest-tests.md` "RTL idioms".

### 12. Assertion idioms

**DOM-specific (`.vitest.tsx` only):**

- `expect(el).toBeNull()` / `toBeTruthy()` / `toBeFalsy()` for DOM presence/absence -- use `toBeInTheDocument()` / `not.toBeInTheDocument()` (with `queryBy*` for absence).
- `assert.strictEqual(el.textContent, 'x')` -- use `expect(el).toHaveTextContent('x')`.
- Manual class checks like `el.classList.contains('x')` -- use `expect(el).toHaveClass('x')`.

**All Vitest files (`.vitest.ts` and `.vitest.tsx`):**

- `assert.ok(x)` / `assert.equal(...)` / `assert.strictEqual(...)` -- use `expect()`. Vitest prefers `expect()` across all test files.

Note: a bare `getByRole(...)` / `getByText(...)` / `getByAltText(...)` call IS an assertion -- these query functions throw when the element isn't found. Don't flag them for "missing `expect(...).toBeInTheDocument()`"; wrapping is redundant. Do flag them if the test also has assertions on the returned element that could use jest-dom matchers.

See `.claude/rules/vitest-tests.md` "RTL idioms" for the full matcher list.

## Output format

Group findings by test file. For each failing item, report:
- The checklist number and name
- What specifically is wrong
- A concrete fix (not just "improve this")

If a test file has no issues, say "No issues found" for that file.

---
name: author-e2e-tests
description: Use when writing, debugging, or maintaining Playwright e2e tests for Positron -- new test files, test cases, test infrastructure, or performance/metric tests. For a named test already failing or flaking in CI, use debug-e2e-test instead.
---

# Positron Playwright E2E Testing

## Purpose

Provides specialized knowledge and patterns for writing correct, reliable Playwright e2e tests that follow Positron's established conventions and avoid common mistakes.

## Philosophy: What Makes a Good E2E Test

Prefer the smallest test that confidently protects the intended user-visible behavior. Do not add additional scenarios or assertions simply because they are easy to write -- extra setup, incidental checks, and duplicate assertions add maintenance cost and flake surface without adding confidence.

A good e2e test:
- validates observable user behavior, not implementation details
- exercises a complete workflow, not a fragment of one
- minimizes setup to what the regression actually needs
- remains deterministic -- no reliance on fixed waits, execution order, or leftover state
- isolates the single regression it protects, so a failure points at one cause

## When to Use This Skill

Load this skill when:
- Creating new e2e test files
- Adding test cases to existing test files
- Debugging flaky or failing tests
- Understanding the test fixture system
- Working with page objects
- Choosing correct selectors and assertions

## Start Here: Read a Neighbor Test

Before writing anything, open an existing test in `test/e2e/tests/<feature>/` for the area you're working on and skim it. The reference docs below tell you how to verify a method and why a pattern exists; the existing tests show you what a correct test actually looks like, including the flake-avoiding details that live in no doc, such as which panes overlap the view under test, how cell/output values render (numeric grid cells come back as strings, for instance), and which tags a suite in that area carries. Copy the closest neighbor's structure, then adjust it. Use the reference docs to confirm each method name against source and to understand the gotchas.

## Critical: Test File Structure

Every test file MUST follow this structure:

```typescript
import { test, expect, tags } from '../_test.setup';

// REQUIRED: Each test file needs a unique suiteId
test.use({
	suiteId: __filename
});

test.describe('Feature Name', {
	tag: [tags.WEB, tags.WIN, tags.CRITICAL, tags.FEATURE_TAG]
}, () => {

	test.beforeEach(async ({ app }) => {
		// Optional setup for each test
	});

	test.afterEach(async ({ app, hotKeys }) => {
		// Cleanup after each test
		await hotKeys.closeAllEditors();
	});

	test('Test description', async ({ app, python }) => {
		// Test implementation
	});
});
```

**MANDATORY REQUIREMENTS:**
1. Import from `../_test.setup` - NOT from `@playwright/test`. Import only what the file uses: `test` and `tags` always, `expect` only if you write raw assertions (a file whose assertions all go through POM methods doesn't import `expect`, and an unused import fails lint).
2. Set `suiteId: __filename` - Required for app isolation
3. Add appropriate tags for platform filtering

## Quick Reference: Available Fixtures

| Fixture | Use Case |
|---------|----------|
| `app` | Access workbench page objects: `app.workbench.console`, etc. |
| `page` | Direct Playwright page access: `page.getByLabel(...)` |
| `python` | Auto-start Python interpreter before test |
| `r` | Auto-start R interpreter before test |
| `sessions` | Manual session management: `await sessions.start('python')` |
| `executeCode` | Execute code: `await executeCode('Python', 'print("hi")');` |
| `openFile` | Open file: `await openFile('workspaces/test/file.py');` |
| `hotKeys` | Keyboard shortcuts: `await hotKeys.closeAllEditors();` |
| `settings` | Change settings: `await settings.set({ 'key': value });` |

See `references/fixtures.md` for complete fixture documentation.

## Page Objects

UI interactions go through `app.workbench.*` page objects, not raw locators. Before writing any interaction: check for an existing method, then consider adding a reusable one, and only fall back to a raw locator when neither fits -- see `references/common-mistakes.md` #15 for the full workflow, and `references/page-objects.md` for usage idioms and "Finding the Exact Source" for looking up the exact signature in `test/e2e/pages/*.ts`. **Never guess or paraphrase a method name -- copy it from the source file.**

## Assertions

Standard Playwright web-first assertions apply, with the project's 15s default timeout covering most checks -- don't add `{ timeout }` reflexively. See `references/assertions.md` for choosing between `toPass`, `expect.poll`, and plain web-first assertions, selector priority, and what makes an assertion worth adding versus redundant.

## Test Tags

Tag every `test.describe` via the `tag` array. Available tags are the `FeatureTags` (what the test covers) and `PlatformTags` (where it runs) enums in `test/e2e/infra/test-runner/test-tags.ts`. A test with no platform tag runs only on Linux/Electron; add `tags.WEB` / `tags.WIN` to broaden. See `references/test-structure.md` for the full tagging and annotation model.

## Performance / Metric Tests

Performance/metric tests live in a `performance/` subdirectory under their feature directory (e.g. `tests/data-explorer/performance/`, `tests/console/performance/`). They use `metric.*` timing wrappers (e.g. `metric.console.executeCode`, `metric.dataExplorer.loadData`) and must capture only the **user-observable action**, not test scaffolding.

**Recipe:** All setup (focus, staging code, pre-checks) happens before the timer. Inside the timer: only the bare trigger (e.g. `page.keyboard.press('Enter')`) and the wait for completion.

**Why not use POM submit methods inside the timer?** Many POM methods hide fixed delays. For example, `sendEnterKey()` contains a `waitForTimeout(500)` and a `focus()` call, so wrapping it inside a metric inflates every measurement by ~600ms of synthetic noise. Before using any POM method inside a timer, check its source for `waitForTimeout`, artificial focus calls, or retry loops. For the trigger keypress, prefer `page.keyboard.press()` directly.

All performance/metric tests must include `tags.PERFORMANCE` in their tag list.

## Common Mistakes to Avoid

**Critical (will break tests):**
1. **Wrong imports** - use `../_test.setup`, not `@playwright/test`
2. **Missing `suiteId`** - must have `test.use({ suiteId: __filename })`
3. **Missing platform tags** - add `tags.WEB`, `tags.WIN` for cross-platform

**Quality issues:**
4. **Timeout overrides added reflexively** - the 15s default covers most UI checks; only override for a known-slow (or known-fast) operation
5. **No `test.step()`** - wrap complex multi-action sequences for better reports
6. **Fixed waits** - `page.waitForTimeout(...)` instead of a web-first assertion, `expect.poll`, `toPass`, or a POM wait helper

See `references/common-mistakes.md` for detailed gotchas with code examples.

## Running Tests

```bash
# Run specific test file
npx playwright test <test-name>.test.ts --project e2e-electron

# Run all tests in a category
npx playwright test test/e2e/tests/<category>/

# Run with specific tags
npx playwright test --grep @:critical

# Run in headed mode (see browser)
npx playwright test --headed

# Run with debug mode
npx playwright test --debug

# Show test report
npx playwright show-report
```

## Progressive Documentation

For detailed information, read the bundled reference docs:

- **`references/test-setup.md`** - How to configure the local machine environment to run tests
- **`references/test-structure.md`** - Complete test file structure and organization
- **`references/fixtures.md`** - All available fixtures and their usage
- **`references/page-objects.md`** - Page object usage idioms (curated, not exhaustive)
- **`references/assertions.md`** - Retry-mechanism choice and selector priority (Positron-specific; standard Playwright assertions assumed)
- **`references/common-mistakes.md`** - Positron-specific gotchas to avoid

## Key Architecture Principles

1. **Worker-scoped app** - One app instance per test file (suite)
2. **Test-scoped fixtures** - `page`, `sessions`, etc. fresh per test
3. **Page Object Model** - UI interactions wrapped in POMs via `app.workbench.*`
4. **Tag-based filtering** - Tests tagged for platform and feature filtering
5. **Automatic cleanup** - Tracing, screenshots attached on failure

## Getting Help

1. Look at existing tests in `test/e2e/tests/<feature>/` for patterns
2. Check page object source in `test/e2e/pages/` for available methods
3. Read `test/e2e/tests/_test.setup.ts` for fixture definitions
4. Use `--debug` flag to step through tests interactively
5. For a flaky/failing test that already has CI history, query `test-health` directly for a quick read on known failure patterns -- see `../e2e-failure-analyzer/scripts/README.md` for the test-key format and how to call `e2e-query-history.js`. For a full guided root-cause dig through the evidence, hand off to `debug-e2e-test`.

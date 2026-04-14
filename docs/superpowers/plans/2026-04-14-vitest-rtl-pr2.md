# Vitest + RTL PR #2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all Positron core tests from Mocha to Vitest, add React Testing Library infrastructure, demonstrate it with a showcase component test, and document the patterns.

**Architecture:** Four phases build on each other. Phase 1 creates Vitest infrastructure and migrates ~42 test files from Mocha syntax (`suite`/`test`/`assert`) to Vitest syntax (`describe`/`it`/`expect`). Phase 2 creates an RTL helper that bridges `createTestContainer()` with `@testing-library/react`. Phase 3 writes a showcase RTL test for `TopActionBarSessionManager`. Phase 4 updates CLAUDE.md with React component testing guidance.

**Tech Stack:** Vitest, happy-dom, @testing-library/react, @testing-library/dom, @vitest/coverage-v8

---

## File Inventory

### New files (create)
- `vitest.config.ts` -- root Vitest configuration
- `src/vs/base/test/common/vitestUtils.ts` -- `ensureNoLeakedDisposables()` (Vitest equivalent of `ensureNoDisposablesAreLeakedInTestSuite`)
- `src/vs/base/test/browser/reactTestingLibrary.tsx` -- `setupRTLRenderer(ctx)` bridging createTestContainer + RTL
- `src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx` -- showcase test
- 42 `.vitest.ts` files (one per migrated `.test.ts`)

### Modified files
- `package.json` -- add devDependencies + `test:vitest` script
- `.github/workflows/test-unit.yml` -- add vitest step (runs before compilation)
- `src/vs/workbench/test/browser/positronTestContainer.ts` -- switch to Vitest hooks
- `CLAUDE.md` -- add React component testing guide

### Deleted files
- 42 `.test.ts` files (replaced by `.vitest.ts` counterparts)

---

## Mocha-to-Vitest Migration Pattern

Every `.test.ts` file follows this transformation. Applied mechanically.

**Before (Mocha):**
```typescript
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';

suite('MyFeature', () => {
    ensureNoDisposablesAreLeakedInTestSuite();
    // or: const ctx = createTestContainer().withRuntimeServices().build();

    suite('nested group', () => {
        test('does something', () => {
            assert.strictEqual(actual, expected);
            assert.ok(value);
            assert.deepStrictEqual(a, b);
            assert.notStrictEqual(a, b);
            assert.throws(() => fn(), /message/);
        });
    });
});
```

**After (Vitest) -- saved as `.vitest.ts`:**
```typescript
/// <reference types="vitest/globals" />
import { ensureNoLeakedDisposables } from '../../../../base/test/common/vitestUtils.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';

describe('MyFeature', () => {
    ensureNoLeakedDisposables();
    // or: const ctx = createTestContainer().withRuntimeServices().build();

    describe('nested group', () => {
        it('does something', () => {
            expect(actual).toBe(expected);
            expect(value).toBeTruthy();
            expect(a).toEqual(b);
            expect(a).not.toBe(b);
            expect(() => fn()).toThrow(/message/);
        });
    });
});
```

**Checklist for each file:**
1. Add `/// <reference types="vitest/globals" />` as line 1 (after copyright header)
2. Replace `import assert from 'assert'` / `import * as assert from 'assert'` -- remove entirely
3. Replace `ensureNoDisposablesAreLeakedInTestSuite` import source: `utils.js` -> `vitestUtils.js`, function name -> `ensureNoLeakedDisposables`
4. Replace `suite(` -> `describe(`
5. Replace `test(` -> `it(`
6. Replace `setup(` -> `beforeEach(`  (only for standalone `setup()` calls, NOT inside builder)
7. Replace `teardown(` -> `afterEach(`
8. Replace `suiteSetup(` -> `beforeAll(`
9. Replace `suiteTeardown(` -> `afterAll(`
10. Replace assertions:
    - `assert.strictEqual(a, b)` -> `expect(a).toBe(b)`
    - `assert.deepStrictEqual(a, b)` -> `expect(a).toEqual(b)`
    - `assert.ok(a)` -> `expect(a).toBeTruthy()`
    - `assert.notStrictEqual(a, b)` -> `expect(a).not.toBe(b)`
    - `assert.equal(a, b)` -> `expect(a).toBe(b)`
    - `assert.notEqual(a, b)` -> `expect(a).not.toBe(b)`
    - `assert.throws(() => fn(), /msg/)` -> `expect(() => fn()).toThrow(/msg/)`
    - `assert.fail(msg)` -> `expect.unreachable(msg)` (or just `throw new Error(msg)`)
    - `assert(value)` -> `expect(value).toBeTruthy()`
11. Replace `sinon.stub()` / `sinon.spy()` -> `vi.fn()` where straightforward (sinon can stay if the mock is complex)

**Do NOT change:**
- Import paths ending in `.js` -- keep them as-is (Vitest resolves them)
- `createTestContainer()` builder API -- unchanged, the builder itself handles the hook migration internally

---

## Complete File List

### Group A: Simple tests (no createTestContainer, no React)
These only use `ensureNoDisposablesAreLeakedInTestSuite` or nothing at all.

| # | Source `.test.ts` | Target `.vitest.ts` |
|---|---|---|
| A1 | `src/vs/platform/extensions/test/common/positronExtensionValidator.test.ts` | same path, `.vitest.ts` |
| A2 | `src/vs/platform/extensionManagement/test/common/positronExtensionCompatibility.test.ts` | same path, `.vitest.ts` |
| A3 | `src/vs/platform/update/test/common/positronUpdateUtils.test.ts` | same path, `.vitest.ts` |
| A4 | `src/vs/platform/update/test/electron-main/positronVersions.test.ts` | same path, `.vitest.ts` |
| A5 | `src/vs/workbench/api/test/common/positron/extHostPositronEphemeralStorage.test.ts` | same path, `.vitest.ts` |
| A6 | `src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.test.ts` | same path, `.vitest.ts` |
| A7 | `src/vs/workbench/services/positronConnections/test/positronConnectionsService.test.ts` | same path, `.vitest.ts` |
| A8 | `src/vs/workbench/services/positronDataExplorer/test/common/positronDataExplorerInternals.test.ts` | same path, `.vitest.ts` |
| A9 | `src/vs/workbench/services/positronDataExplorer/test/common/positronDataExplorerMocks.test.ts` | same path, `.vitest.ts` |
| A10 | `src/vs/base/test/browser/positronModalReactRenderer.test.ts` | same path, `.vitest.ts` |
| A11 | `src/vs/workbench/contrib/positronWebviewPreloads/browser/positronWebviewPreloadService.test.ts` | same path, `.vitest.ts` |

### Group B: Builder tests (use createTestContainer)
These import `createTestContainer` from `positronTestContainer.js`. The import path stays the same (builder is modified in-place).

| # | Source `.test.ts` | Target `.vitest.ts` |
|---|---|---|
| B1 | `src/vs/workbench/test/browser/services/positronVariablesService.test.ts` | same path, `.vitest.ts` |
| B2 | `src/vs/workbench/test/browser/layoutManager.test.ts` | same path, `.vitest.ts` |
| B3 | `src/vs/workbench/api/test/browser/positron/mainThreadPositronEphemeralStorage.test.ts` | same path, `.vitest.ts` |
| B4 | `src/vs/workbench/contrib/notebook/test/browser/positronNotebookCommandPalette.test.ts` | same path, `.vitest.ts` |
| B5 | `src/vs/workbench/contrib/positronAssistant/test/browser/positronAssistantService.test.ts` | same path, `.vitest.ts` |
| B6 | `src/vs/workbench/contrib/positronAssistant/test/browser/languageModelSessionSync.test.ts` | same path, `.vitest.ts` |
| B7 | `src/vs/workbench/contrib/positronIPyWidgets/test/browser/positronIPyWidgetsService.test.ts` | same path, `.vitest.ts` |
| B8 | `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookCell.test.ts` | same path, `.vitest.ts` |
| B9 | `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookCellOutputs.test.ts` | same path, `.vitest.ts` |
| B10 | `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookConfigurationHandling.test.ts` | same path, `.vitest.ts` |
| B11 | `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookEditorResolution.test.ts` | same path, `.vitest.ts` |
| B12 | `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookInstance.test.ts` | same path, `.vitest.ts` |
| B13 | `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookOutline.test.ts` | same path, `.vitest.ts` |
| B14 | `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookSplitJoin.test.ts` | same path, `.vitest.ts` |
| B15 | `src/vs/workbench/contrib/positronNotebook/test/browser/notebookOutputUtils.test.ts` | same path, `.vitest.ts` |
| B16 | `src/vs/workbench/contrib/positronNotebook/test/browser/copyImageUtils.test.ts` | same path, `.vitest.ts` |
| B17 | `src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronNotebookFind.test.ts` | same path, `.vitest.ts` |
| B18 | `src/vs/workbench/contrib/positronPlots/test/electron-browser/positronPlotsService.test.ts` | same path, `.vitest.ts` |
| B19 | `src/vs/workbench/contrib/positronWebviewPreloads/test/browser/positronWebviewPreloadService.test.ts` | same path, `.vitest.ts` |
| B20 | `src/vs/workbench/contrib/positronWelcome/test/browser/helpers.test.ts` | same path, `.vitest.ts` |
| B21 | `src/vs/workbench/contrib/positronQuarto/test/browser/quartoDocumentModel.test.ts` | same path, `.vitest.ts` |
| B22 | `src/vs/workbench/contrib/positronQuarto/test/browser/quartoExecutionManager.test.ts` | same path, `.vitest.ts` |
| B23 | `src/vs/workbench/contrib/positronQuarto/test/browser/quartoOutputManager.test.ts` | same path, `.vitest.ts` |
| B24 | `src/vs/workbench/contrib/positronQuarto/test/browser/quartoCellToolbar.test.ts` | same path, `.vitest.ts` |
| B25 | `src/vs/workbench/contrib/positronPathUtils/test/browser/filePathConverter.test.ts` | same path, `.vitest.ts` |
| B26 | `src/vs/workbench/contrib/runtimeSession/test/browser/foregroundSessionContribution.test.ts` | same path, `.vitest.ts` |
| B27 | `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernelService.test.ts` | same path, `.vitest.ts` |
| B28 | `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernel.test.ts` | same path, `.vitest.ts` |
| B29 | `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/notebookExecutionStatus.test.ts` | same path, `.vitest.ts` |
| B30 | `src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.test.ts` | same path, `.vitest.ts` |

### Group C: Not migrated in this PR
These `.test.tsx` files use `setupReactRenderer()` (Mocha-based React rendering). They continue running under Mocha. A future PR will migrate them to Vitest + RTL.

- 12 files in `src/vs/**/**.test.tsx`
- `src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.test.ts` (if it has non-standard patterns -- verify during implementation)

---

## Task 1: Create branch and add dependencies

**Files:**
- Modify: `package.json` (devDependencies section)

- [ ] **Step 1: Create a new branch off main**

```bash
git checkout main
git pull
git checkout -b mi/vitest-rtl-pr2
```

- [ ] **Step 2: Add Vitest and RTL dependencies**

```bash
npm install --save-dev vitest @vitest/coverage-v8 happy-dom @testing-library/react @testing-library/dom
```

This adds to `devDependencies` in `package.json`:
- `vitest` -- test runner
- `@vitest/coverage-v8` -- coverage via V8
- `happy-dom` -- lightweight DOM implementation for Vitest
- `@testing-library/react` -- RTL render/queries
- `@testing-library/dom` -- RTL DOM utilities (peer dep)

- [ ] **Step 3: Add `test:vitest` npm script**

In `package.json`, add to the `"scripts"` section:
```json
"test:vitest": "vitest --run",
```

This is the entry point for CI and local runs. `--run` exits after running (no watch mode).

- [ ] **Step 4: Verify install succeeded**

Run: `npx vitest --version`
Expected: prints vitest version (e.g. `vitest/3.x.x`)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add vitest, RTL, happy-dom, and coverage dependencies"
```

---

## Task 2: Create vitest.config.ts

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Create root Vitest configuration**

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/vs/**/*.vitest.{ts,tsx}'],
		environment: 'happy-dom',
		globals: true,
	},
	esbuild: {
		jsx: 'automatic',
	},
});
```

Key decisions:
- `include` pattern: only `*.vitest.{ts,tsx}` -- Mocha `.test.ts` files are NOT picked up
- `environment: 'happy-dom'` -- lightweight DOM, no Electron needed
- `globals: true` -- `describe`, `it`, `expect`, `vi` available without imports
- `jsx: 'automatic'` -- React JSX transform (no `import React` needed)

- [ ] **Step 2: Verify Vitest finds no tests yet (none exist)**

Run: `npx vitest run --reporter=verbose 2>&1 | head -5`
Expected: "No test files found" or similar (no `.vitest.ts` files exist yet)

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "config: add root vitest.config.ts with happy-dom and JSX support"
```

---

## Task 3: Add vitest step to CI workflow

**Files:**
- Modify: `.github/workflows/test-unit.yml`

Vitest tests don't need Electron, compilation, or build daemons. They can run immediately after `npm install` -- before the expensive `Compile Positron and Download Electron` step. This gives fast feedback: if a vitest test fails, the CI job fails in ~30 seconds instead of waiting for the full compile.

- [ ] **Step 1: Add vitest step to test-unit.yml**

In `.github/workflows/test-unit.yml`, add a new step **after** `Download binaries (Ark, Kallichore)` and **before** `Compile Positron and Download Electron`:

```yaml
      - name: 🧪 Run Vitest Tests (no compilation needed)
        run: npm run test:vitest
```

The step goes at approximately line 103, after the binary download step and before the compile step. The key insight: vitest runs on raw TypeScript via esbuild -- no Electron, no tsc compilation, no build daemons.

- [ ] **Step 2: Verify the YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test-unit.yml'))"`
Expected: no errors (valid YAML)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test-unit.yml
git commit -m "ci: add vitest step to unit test workflow (runs before compilation)"
```

---

## Task 4: Create Vitest disposable leak checker

**Files:**
- Create: `src/vs/base/test/common/vitestUtils.ts`

This is the Vitest equivalent of `ensureNoDisposablesAreLeakedInTestSuite()` from `utils.ts`. The Mocha version uses `setup()`/`teardown()` hooks; this version uses `beforeEach()`/`afterEach()`.

- [ ] **Step 1: Create the vitestUtils.ts file**

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore, DisposableTracker, IDisposable, setDisposableTracker } from '../../common/lifecycle.js';

/**
 * Vitest equivalent of `ensureNoDisposablesAreLeakedInTestSuite()`.
 *
 * Tracks disposable creation/disposal across each test. If any disposables
 * are created but not disposed by the end of a test, the test fails.
 *
 * Returns a disposable store that tests can use to register disposables
 * via `ctx.add(disposable)`.
 *
 * @example
 * ```ts
 * describe('MyFeature', () => {
 *     const disposables = ensureNoLeakedDisposables();
 *
 *     it('creates and cleans up', () => {
 *         const d = disposables.add(new MyDisposable());
 *         // ...test logic...
 *     }); // disposables auto-disposed + leak check runs in afterEach
 * });
 * ```
 */
export function ensureNoLeakedDisposables(): Pick<DisposableStore, 'add'> {
	let tracker: DisposableTracker | undefined;
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
		tracker = new DisposableTracker();
		setDisposableTracker(tracker);
	});

	afterEach((ctx) => {
		store.dispose();
		setDisposableTracker(null);
		if (ctx.task.result?.state !== 'fail') {
			const result = tracker!.computeLeakingDisposables();
			if (result) {
				console.error(result.details);
				throw new Error(`There are ${result.leaks.length} undisposed disposables!${result.details}`);
			}
		}
	});

	const testContext = {
		add<T extends IDisposable>(o: T): T {
			return store.add(o);
		}
	};
	return testContext;
}
```

Key differences from `ensureNoDisposablesAreLeakedInTestSuite`:
- `setup()` -> `beforeEach()` (Vitest hook)
- `teardown()` -> `afterEach()` (Vitest hook)
- Mocha `this.currentTest?.state` -> Vitest `ctx.task.result?.state`
- `DisposableTracker` is re-exported from `utils.ts` (it's already exported there)

- [ ] **Step 2: Write a smoke test to verify the leak checker works**

Create `src/vs/base/test/common/vitestUtils.vitest.ts`:

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Disposable } from '../../common/lifecycle.js';
import { ensureNoLeakedDisposables } from './vitestUtils.js';

describe('ensureNoLeakedDisposables', () => {
	const disposables = ensureNoLeakedDisposables();

	it('passes when disposables are properly cleaned up', () => {
		const d = disposables.add(new Disposable());
		expect(d).toBeDefined();
		// d is auto-disposed by the store in afterEach
	});

	it('tracks add() calls', () => {
		class TestDisposable extends Disposable { }
		const d = disposables.add(new TestDisposable());
		expect(d).toBeInstanceOf(TestDisposable);
	});
});
```

- [ ] **Step 4: Run the smoke test**

Run: `npx vitest run src/vs/base/test/common/vitestUtils.vitest.ts`
Expected: 2 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/vs/base/test/common/vitestUtils.ts src/vs/base/test/common/vitestUtils.vitest.ts
git commit -m "test: add ensureNoLeakedDisposables for Vitest disposable tracking"
```

---

## Task 5: Migrate positronTestContainer.ts to Vitest hooks

**Files:**
- Modify: `src/vs/workbench/test/browser/positronTestContainer.ts`

The builder currently uses Mocha's `setup()` and `ensureNoDisposablesAreLeakedInTestSuite()`. Switch to Vitest's `beforeEach()` and `ensureNoLeakedDisposables()`.

- [ ] **Step 1: Update imports**

In `src/vs/workbench/test/browser/positronTestContainer.ts`, replace:
```typescript
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
```
with:
```typescript
import { ensureNoLeakedDisposables } from '../../../base/test/common/vitestUtils.js';
```

- [ ] **Step 2: Update the `build()` method**

Replace `ensureNoDisposablesAreLeakedInTestSuite()` call with `ensureNoLeakedDisposables()`:
```typescript
const disposables = ensureNoLeakedDisposables();
```

Replace `setup(() => {` with `beforeEach(() => {`:
```typescript
beforeEach(() => {
    if (useContributionServices) {
        // ... same body ...
    }
});
```

- [ ] **Step 3: Add vitest globals reference**

Add after the copyright header:
```typescript
/// <reference types="vitest/globals" />
```

- [ ] **Step 4: Update the JSDoc**

In the `PositronTestContainerBuilder` class JSDoc, update references:
- `setup` -> `beforeEach`
- `teardown` -> `afterEach`
- `suite()` -> `describe()`
- `test` -> `it`
- `ensureNoDisposablesAreLeakedInTestSuite()` -> `ensureNoLeakedDisposables()`

Update the usage example:
```typescript
 * ## Usage
 *
 * ```typescript
 * const ctx = createTestContainer().withRuntimeServices().build();
 * const session = await startTestLanguageRuntimeSession(
 *     ctx.instantiationService, ctx.disposables);
 * ```
```

- [ ] **Step 5: Commit**

```bash
git add src/vs/workbench/test/browser/positronTestContainer.ts
git commit -m "refactor: switch positronTestContainer to Vitest hooks (beforeEach + ensureNoLeakedDisposables)"
```

---

## Task 6: Migrate Group A tests (simple, no builder)

**Files:** 11 files (see Group A table above)

Each file follows the migration pattern from the "Mocha-to-Vitest Migration Pattern" section. These are the simplest -- they only use `assert` and `ensureNoDisposablesAreLeakedInTestSuite`.

- [ ] **Step 1: Migrate A1 -- positronExtensionValidator**

Read `src/vs/platform/extensions/test/common/positronExtensionValidator.test.ts`.
Create `src/vs/platform/extensions/test/common/positronExtensionValidator.vitest.ts` with the migration pattern applied:
- Add `/// <reference types="vitest/globals" />` after copyright
- Remove `import * as assert from 'assert'`
- Replace `ensureNoDisposablesAreLeakedInTestSuite` import -> `ensureNoLeakedDisposables` from `vitestUtils.js`
- `suite(` -> `describe(`
- `test(` -> `it(`
- `assert.strictEqual(a, b)` -> `expect(a).toBe(b)`
- `assert.equal(a, b)` -> `expect(a).toBe(b)`
- `assert.notEqual(a, b)` -> `expect(a).not.toBe(b)`

- [ ] **Step 2: Verify A1 passes**

Run: `npx vitest run src/vs/platform/extensions/test/common/positronExtensionValidator.vitest.ts`
Expected: all tests pass

- [ ] **Step 3: Migrate remaining Group A files (A2-A11)**

Apply the same migration pattern to each file. Read the source `.test.ts`, create the `.vitest.ts`, apply all transformations from the checklist.

For each file, pay attention to:
- Some use `assert.ok()` -> `expect(x).toBeTruthy()`
- Some use `assert.deepStrictEqual()` -> `expect(x).toEqual(y)`
- Some use `assert.throws()` -> `expect(() => ...).toThrow()`
- Some use `sinon` -- keep sinon imports if the mocking is complex; for simple stubs consider `vi.fn()`
- Some have `setup()`/`teardown()` hooks -> `beforeEach()`/`afterEach()`

- [ ] **Step 4: Verify all Group A tests pass**

Run: `npx vitest run --reporter=verbose src/vs/platform/ src/vs/base/test/browser/positronModalReactRenderer.vitest.ts src/vs/workbench/api/test/common/ src/vs/workbench/contrib/positronConsole/ src/vs/workbench/contrib/positronWebviewPreloads/browser/ src/vs/workbench/services/positronConnections/ src/vs/workbench/services/positronDataExplorer/test/common/`
Expected: all 11 files pass

- [ ] **Step 5: Delete Group A original .test.ts files**

Delete all 11 original `.test.ts` files (A1-A11).

- [ ] **Step 6: Verify Mocha runner still works (no regressions)**

Run: `npm run build-start && npm run build-check` to ensure TypeScript compiles.
The Mocha runner (`scripts/test.sh`) only globs `*.test.js` -- `.vitest.ts` files are invisible to it.

- [ ] **Step 7: Commit**

```bash
git add -A src/vs/platform/ src/vs/base/test/browser/positronModalReactRenderer.vitest.ts src/vs/workbench/api/test/common/ src/vs/workbench/contrib/positronConsole/ src/vs/workbench/contrib/positronWebviewPreloads/browser/ src/vs/workbench/services/positronConnections/ src/vs/workbench/services/positronDataExplorer/test/common/
git commit -m "test: migrate Group A simple tests from Mocha to Vitest (11 files)"
```

---

## Task 7: Migrate Group B tests -- batch 1 (workbench core + API)

**Files:** B1-B3 (3 files)
- `positronVariablesService.test.ts`
- `layoutManager.test.ts`
- `mainThreadPositronEphemeralStorage.test.ts`

- [ ] **Step 1: Migrate B1-B3**

These files import `createTestContainer`. The import path stays the same -- the builder itself was already switched to Vitest hooks in Task 4.

Apply the migration pattern. In addition to the standard checklist:
- Keep `createTestContainer()` calls unchanged
- `setup()` calls OUTSIDE the builder (standalone hooks) -> `beforeEach()`
- `teardown()` calls -> `afterEach()`

- [ ] **Step 2: Verify B1-B3 pass**

Run: `npx vitest run src/vs/workbench/test/browser/services/positronVariablesService.vitest.ts src/vs/workbench/test/browser/layoutManager.vitest.ts src/vs/workbench/api/test/browser/positron/mainThreadPositronEphemeralStorage.vitest.ts`
Expected: all pass

- [ ] **Step 3: Delete B1-B3 originals and commit**

```bash
git add -A src/vs/workbench/test/browser/ src/vs/workbench/api/test/browser/positron/
git commit -m "test: migrate workbench core + API tests to Vitest (3 files)"
```

---

## Task 8: Migrate Group B tests -- batch 2 (notebook tests)

**Files:** B4, B8-B17 (11 files -- all positronNotebook + positronNotebookCommandPalette)

These are the largest batch. Many share similar patterns around notebook services.

- [ ] **Step 1: Migrate B4 and B8-B17**

Apply the migration pattern to each file. Watch for:
- Complex `Emitter` setups with events -- keep as-is, just change hooks
- `Event.toPromise()` patterns -- keep as-is
- `runWithFakedTimers()` patterns -- keep as-is
- Nested `suite()`/`test()` -> nested `describe()`/`it()`

- [ ] **Step 2: Verify all pass**

Run: `npx vitest run src/vs/workbench/contrib/positronNotebook/ src/vs/workbench/contrib/notebook/test/browser/positronNotebookCommandPalette.vitest.ts`
Expected: all 11 files pass

- [ ] **Step 3: Delete originals and commit**

```bash
git add -A src/vs/workbench/contrib/positronNotebook/ src/vs/workbench/contrib/notebook/test/browser/positronNotebookCommandPalette*
git commit -m "test: migrate notebook tests to Vitest (11 files)"
```

---

## Task 9: Migrate Group B tests -- batch 3 (services + contrib)

**Files:** B5-B7, B18-B30 (16 files)
- positronAssistant (2), positronIPyWidgets (1), positronPlots (1), positronWebviewPreloads (1), positronWelcome (1), positronQuarto (4), positronPathUtils (1), runtimeSession (1), runtimeNotebookKernel (3), positronDataExplorer browser (1)

- [ ] **Step 1: Migrate B5-B7 and B18-B30**

Apply the migration pattern. Notes per area:
- **positronAssistant**: `positronAssistantService.test.ts` has a different import path for `createTestContainer` (`../../../../../workbench/test/browser/positronTestContainer.js`) -- keep that path
- **positronPlots** (electron-browser): verify happy-dom works for this test -- it may use Electron-specific APIs. If it fails, add a skip comment and move on
- **runtimeNotebookKernel**: uses `tests/` (plural) directory -- keep that path
- **positronQuarto**: 4 files share similar patterns around document models

- [ ] **Step 2: Verify all pass**

Run: `npx vitest run --reporter=verbose` (runs ALL `.vitest.ts` files)
Expected: all files from tasks 6-9 pass (41 test files total + 1 smoke test = 42)

- [ ] **Step 3: Delete originals and commit**

```bash
git add -A src/vs/workbench/contrib/positronAssistant/ src/vs/workbench/contrib/positronIPyWidgets/ src/vs/workbench/contrib/positronPlots/ src/vs/workbench/contrib/positronWebviewPreloads/test/ src/vs/workbench/contrib/positronWelcome/ src/vs/workbench/contrib/positronQuarto/ src/vs/workbench/contrib/positronPathUtils/ src/vs/workbench/contrib/runtimeSession/ src/vs/workbench/contrib/runtimeNotebookKernel/ src/vs/workbench/services/positronDataExplorer/test/browser/
git commit -m "test: migrate remaining service + contrib tests to Vitest (16 files)"
```

---

## Task 10: Full Vitest suite verification

- [ ] **Step 1: Run the complete Vitest suite**

Run: `npx vitest run --reporter=verbose`
Expected: 42 test files, all passing

- [ ] **Step 2: Run the Mocha suite to verify no regressions**

Run: `npm run build-start && npm run build-check` (ensure compilation is clean)
Then run: `./scripts/test.sh --runGlob '**/positronNotebook/**/*.test.js' 2>&1 | tail -20`
Expected: Only `.test.tsx` files run under Mocha. No `.vitest.ts` files are picked up. No failures.

- [ ] **Step 3: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: resolve issues found during full suite verification"
```

---

## Task 11: RTL infrastructure -- setupRTLRenderer

**Files:**
- Create: `src/vs/base/test/browser/reactTestingLibrary.tsx`

This is the Phase 2 deliverable: a helper that bridges `createTestContainer()` with `@testing-library/react`, wrapping components in `PositronReactServicesContext.Provider`.

- [ ] **Step 1: Create the RTL helper**

Create `src/vs/base/test/browser/reactTestingLibrary.tsx`:

```tsx
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React, { type ReactElement } from 'react';
import { render, cleanup, type RenderResult } from '@testing-library/react';
import { PositronReactServicesContext } from '../../browser/positronReactRendererContext.js';

/**
 * A partial `PositronReactServices` object for tests. Only include the
 * services your component actually accesses. Cast with `as any` since
 * the full PositronReactServices type requires 50+ services.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestServices = Record<string, any>;

/**
 * Sets up an RTL renderer that wraps components in PositronReactServicesContext.
 *
 * Bridges `createTestContainer()` with `@testing-library/react`: pass the
 * services your component needs as a partial object, and the helper wraps
 * every `render()` call in the context provider.
 *
 * Registers an `afterEach` hook that calls RTL `cleanup()` so React trees
 * are unmounted between tests (required for disposable leak detection).
 *
 * ## Patterns
 *
 * **Service-context pattern** (components that call `usePositronReactServicesContext`):
 * ```tsx
 * const ctx = createTestContainer().withRuntimeServices().build();
 * const rtl = setupRTLRenderer({
 *     runtimeSessionService: ctx.get(IRuntimeSessionService),
 * });
 *
 * it('renders session label', () => {
 *     const { getByText } = rtl.render(<MyComponent />);
 *     expect(getByText('Start Session')).toBeTruthy();
 * });
 * ```
 *
 * **Prop-driven pattern** (components that receive data via props):
 * ```tsx
 * const rtl = setupRTLRenderer();
 *
 * it('renders prop value', () => {
 *     const { getByText } = rtl.render(<Label text="hello" />);
 *     expect(getByText('hello')).toBeTruthy();
 * });
 * ```
 *
 * @param services Partial services object. Merged into the context provider
 *   value. Components access these via `usePositronReactServicesContext()`.
 *   Omit for prop-driven components that don't use the context.
 */
export function setupRTLRenderer(services?: TestServices) {
	afterEach(() => {
		cleanup();
	});

	return {
		/**
		 * Render a React element wrapped in PositronReactServicesContext.
		 * Returns the full RTL RenderResult (getByText, getByRole, etc.).
		 */
		render(element: ReactElement): RenderResult {
			const wrapper = services
				? ({ children }: { children: React.ReactNode }) => (
					<PositronReactServicesContext.Provider value={services as any}>
						{children}
					</PositronReactServicesContext.Provider>
				)
				: undefined;

			return render(element, { wrapper });
		},
	};
}
```

Key design decisions:
- `services` is loosely typed (`Record<string, any>`) -- components only access what they need, so partial objects work
- RTL `cleanup()` runs in `afterEach` -- unmounts React trees so `ensureNoLeakedDisposables` sees proper disposal
- Returns standard RTL `RenderResult` -- engineers get `getByText`, `getByRole`, `queryByText`, etc.
- `wrapper` pattern means every `render()` call auto-wraps in the provider

- [ ] **Step 2: Write a smoke test for the RTL helper**

Create `src/vs/base/test/browser/reactTestingLibrary.vitest.tsx`:

```tsx
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { usePositronReactServicesContext } from '../../browser/positronReactRendererContext.js';
import { setupRTLRenderer } from './reactTestingLibrary.js';

/** Test component that reads from context. */
const ServiceLabel = () => {
	const services = usePositronReactServicesContext();
	return <span>{services.testValue ?? 'no value'}</span>;
};

/** Test component that takes props. */
const PropLabel = ({ text }: { text: string }) => {
	return <span>{text}</span>;
};

describe('setupRTLRenderer', () => {
	describe('service-context pattern', () => {
		const rtl = setupRTLRenderer({ testValue: 'hello from context' });

		it('provides services via context', () => {
			const { getByText } = rtl.render(<ServiceLabel />);
			expect(getByText('hello from context')).toBeTruthy();
		});
	});

	describe('prop-driven pattern', () => {
		const rtl = setupRTLRenderer();

		it('renders without services wrapper', () => {
			const { getByText } = rtl.render(<PropLabel text="hello from props" />);
			expect(getByText('hello from props')).toBeTruthy();
		});
	});
});
```

- [ ] **Step 3: Run the smoke test**

Run: `npx vitest run src/vs/base/test/browser/reactTestingLibrary.vitest.tsx`
Expected: 2 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/vs/base/test/browser/reactTestingLibrary.tsx src/vs/base/test/browser/reactTestingLibrary.vitest.tsx
git commit -m "test: add setupRTLRenderer bridging createTestContainer with @testing-library/react"
```

---

## Task 12: Showcase test -- TopActionBarSessionManager

**Files:**
- Create: `src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx`

Target: 100% coverage on `topActionBarSessionManager.tsx`. Test all behavior through RTL -- do NOT export internal functions (`getDisplayInfoLabel`, `getDisplayInfoIcon`). Include inline snapshots for each session state.

The component accesses `services.runtimeSessionService` via `usePositronReactServicesContext()`. It reads:
- `.foregroundSessionDisplayInfo` (initial state)
- `.activeSessions` (to determine command ID)
- `.onDidChangeForegroundSessionDisplayInfo` (event subscription)

- [ ] **Step 1: Create the test directory**

```bash
mkdir -p src/vs/workbench/browser/parts/positronTopActionBar/test/browser
```

- [ ] **Step 2: Write the showcase test**

Create `src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx`:

```tsx
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-no-dangerous-type-assertions

/// <reference types="vitest/globals" />

import React from 'react';
import { Emitter } from '../../../../../../../base/common/event.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { LanguageRuntimeSessionMode } from '../../../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionDisplayInfo, IRuntimeSessionService } from '../../../../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeState } from '../../../../../../services/languageRuntime/common/languageRuntimeService.js';
import { setupRTLRenderer } from '../../../../../../../base/test/browser/reactTestingLibrary.js';
import { TopActionBarSessionManager } from '../../components/topActionBarSessionManager.js';
import { ensureNoLeakedDisposables } from '../../../../../../../base/test/common/vitestUtils.js';
import { PositronActionBarContextProvider } from '../../../../../../../platform/positronActionBar/browser/positronActionBarContext.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fires when `onDidChangeForegroundSessionDisplayInfo` is emitted in tests. */
const displayInfoEmitter = new Emitter<IRuntimeSessionDisplayInfo | undefined>();

/**
 * Build a minimal mock of IRuntimeSessionService. Only the members that
 * TopActionBarSessionManager actually accesses are provided.
 */
function createMockRuntimeSessionService(
	overrides: {
		foregroundSessionDisplayInfo?: IRuntimeSessionDisplayInfo;
		activeSessions?: { metadata: { sessionMode: LanguageRuntimeSessionMode } }[];
	} = {},
): Partial<IRuntimeSessionService> {
	return {
		foregroundSessionDisplayInfo: overrides.foregroundSessionDisplayInfo,
		activeSessions: (overrides.activeSessions ?? []) as any,
		onDidChangeForegroundSessionDisplayInfo: displayInfoEmitter.event,
	};
}

/** Convenience factory for display info objects. */
function makeDisplayInfo(
	overrides: Partial<IRuntimeSessionDisplayInfo> & Pick<IRuntimeSessionDisplayInfo, 'sessionName' | 'sessionMode'>,
): IRuntimeSessionDisplayInfo {
	return {
		runtimeId: 'test-runtime',
		languageName: 'Python',
		languageId: 'python',
		base64EncodedIconSvg: undefined,
		sessionState: RuntimeState.Idle,
		...overrides,
	};
}

/**
 * Build the full services mock needed for TopActionBarSessionManager.
 * The component itself only accesses runtimeSessionService, but its child
 * ActionBarCommandButton renders inside PositronActionBarContextProvider
 * which needs configurationService, hoverService, contextKeyService, and
 * accessibilityService.
 */
function createTestServices(
	overrides: Parameters<typeof createMockRuntimeSessionService>[0] = {},
) {
	return {
		runtimeSessionService: createMockRuntimeSessionService(overrides),
		configurationService: { onDidChangeConfiguration: new Emitter().event },
		hoverService: { showHover: vi.fn(), hideHover: vi.fn() },
		contextKeyService: {
			onDidChangeContext: new Emitter().event,
			contextMatchesRules: () => true,
		},
		accessibilityService: {},
		commandService: { executeCommand: vi.fn() },
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TopActionBarSessionManager', () => {
	const disposables = ensureNoLeakedDisposables();

	// Register the emitter for cleanup
	beforeEach(() => {
		disposables.add(displayInfoEmitter);
	});

	describe('no active session', () => {
		const rtl = setupRTLRenderer(createTestServices());

		it('renders "Start Session" label', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);
			expect(container.innerHTML).toMatchInlineSnapshot();
		});

		it('displays start-session command', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);
			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toBe('Start Session');
		});
	});

	describe('console session', () => {
		const consoleInfo = makeDisplayInfo({
			sessionName: 'Python 3.12.1',
			sessionMode: LanguageRuntimeSessionMode.Console,
		});

		const rtl = setupRTLRenderer(createTestServices({
			foregroundSessionDisplayInfo: consoleInfo,
			activeSessions: [
				{ metadata: { sessionMode: LanguageRuntimeSessionMode.Console } },
			],
		}));

		it('renders console session label', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);
			expect(container.innerHTML).toMatchInlineSnapshot();
		});

		it('displays session name as label', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);
			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toBe('Python 3.12.1');
		});
	});

	describe('notebook session', () => {
		const notebookInfo = makeDisplayInfo({
			sessionName: 'Python 3.12.1',
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			notebookUri: URI.file('/workspace/analysis.ipynb'),
		});

		const rtl = setupRTLRenderer(createTestServices({
			foregroundSessionDisplayInfo: notebookInfo,
			activeSessions: [
				{ metadata: { sessionMode: LanguageRuntimeSessionMode.Console } },
			],
		}));

		it('renders notebook session label', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);
			expect(container.innerHTML).toMatchInlineSnapshot();
		});

		it('displays "notebookName - sessionName" format', () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);
			const label = container.querySelector('.action-bar-button-label');
			expect(label?.textContent).toBe('analysis.ipynb - Python 3.12.1');
		});
	});

	describe('session changes', () => {
		const rtl = setupRTLRenderer(createTestServices());

		it('updates label when foreground session changes', async () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			// Initially shows "Start Session"
			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('Start Session');

			// Simulate a session becoming active
			const newInfo = makeDisplayInfo({
				sessionName: 'R 4.4.0',
				sessionMode: LanguageRuntimeSessionMode.Console,
			});
			displayInfoEmitter.fire(newInfo);

			// Label should update
			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('R 4.4.0');
		});

		it('reverts to "Start Session" when session ends', async () => {
			const { container } = rtl.render(
				<PositronActionBarContextProvider>
					<TopActionBarSessionManager />
				</PositronActionBarContextProvider>
			);

			// Start with a session
			displayInfoEmitter.fire(makeDisplayInfo({
				sessionName: 'Python 3.12.1',
				sessionMode: LanguageRuntimeSessionMode.Console,
			}));
			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('Python 3.12.1');

			// Session ends
			displayInfoEmitter.fire(undefined);
			expect(container.querySelector('.action-bar-button-label')?.textContent).toBe('Start Session');
		});
	});
});
```

**Notes on the test design:**
- Internal functions (`getDisplayInfoLabel`, `getDisplayInfoIcon`) are NOT exported -- tested indirectly through rendered output
- `toMatchInlineSnapshot()` with empty parens -- Vitest auto-fills on first run
- `Emitter` is used to simulate `onDidChangeForegroundSessionDisplayInfo` events
- Three session states tested: no session, console, notebook
- Dynamic updates tested: session start, session end
- `ActionBarCommandButton` uses BOTH `usePositronReactServicesContext()` AND `usePositronActionBarContext()`. The `PositronActionBarContextProvider` wraps each render to provide action bar state. The provider internally uses `usePositronActionBarState()` which needs `configurationService`, `hoverService`, `contextKeyService`, and `accessibilityService` -- all provided by `createTestServices()`.
- CSS class for the label is `.action-bar-button-label` (from `ActionBarButton`, the base component)

- [ ] **Step 3: Run the test and populate snapshots**

Run: `npx vitest run --update src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx`

The `--update` flag fills in inline snapshots on first run. Expected: all tests pass, inline snapshots populated.

- [ ] **Step 4: Debug any failures**

Common issues:
1. **`PositronActionBarContextProvider` crashes**: The provider internally calls `usePositronActionBarState()` which creates a `PositronActionBarHoverManager`. If `hoverService` or `configurationService` mocks are insufficient, expand them. The `createTestServices()` helper above provides the minimum.
2. **`CommandCenter.title()` returns undefined**: `CommandCenter` is a singleton that needs commands registered via `CommandCenter.register()`. In tests, no commands are registered so `title()` returns `undefined`. This is fine -- it means `ariaLabel` is `undefined` on the button. If tests need a specific aria-label, call `CommandCenter.register()` in `beforeEach`.
3. **CSS import fails**: happy-dom might not handle CSS imports. Add to `vitest.config.ts`:
   ```typescript
   css: { modules: { classNameStrategy: 'non-scoped' } },
   ```
   Or mock CSS with a Vitest setup file.
4. **`PositronActionBarHoverManager` constructor fails**: It may require a real `configurationService.getValue()`. Add: `configurationService: { onDidChangeConfiguration: new Emitter().event, getValue: () => undefined }`

- [ ] **Step 5: Run coverage to verify 100%**

Run: `npx vitest run --coverage --coverage.include='**/topActionBarSessionManager.tsx' src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx`

Expected: 100% line/branch/function coverage on `topActionBarSessionManager.tsx`. If not 100%, add tests for uncovered branches.

- [ ] **Step 6: Commit**

```bash
git add src/vs/workbench/browser/parts/positronTopActionBar/test/
git commit -m "test: add RTL showcase test for TopActionBarSessionManager with 100% coverage"
```

---

## Task 13: Documentation -- update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Testing section)

- [ ] **Step 1: Add Vitest testing commands to the "Running tests" section**

After the existing "Core tests" bullet, add a new bullet for Vitest. Position it BEFORE core tests to signal it's the preferred path for new Positron tests:

```markdown
- **Vitest tests** (`*.vitest.ts` / `*.vitest.tsx`, **no build daemons needed**):
	- `npm run test:vitest`: run all Vitest tests
	- `npx vitest run src/path/to/<file>.vitest.ts`: run a specific file
	- `npx vitest run --reporter=verbose`: run with detailed output
	- `npx vitest run --coverage --coverage.include='**/myFile.tsx'`: run with scoped coverage
	- `npx vitest run --update <file>`: update inline snapshots
	- Vitest compiles TypeScript on-the-fly via esbuild -- no Electron, no `npm run build-start`, no wait. Ideal for rapid iteration and LLM-driven workflows.
```

- [ ] **Step 2: Add React component testing guide**

Add a new subsection after "### The Builder":

```markdown
### React Component Testing (Vitest + RTL)

Two patterns for testing React components:

**Service-context pattern** -- for components that call `usePositronReactServicesContext()`:
```typescript
const ctx = createTestContainer().withRuntimeServices().build();
const rtl = setupRTLRenderer({
    runtimeSessionService: ctx.get(IRuntimeSessionService),
});

it('renders session info', () => {
    const { getByText } = rtl.render(<MyComponent />);
    expect(getByText('Start Session')).toBeTruthy();
});
```

**Prop-driven pattern** -- for components that receive all data via props:
```typescript
const rtl = setupRTLRenderer();

it('renders label', () => {
    const { getByText } = rtl.render(<Label text="hello" />);
    expect(getByText('hello')).toBeTruthy();
});
```

**RTL query priority** (prefer top to bottom):
1. `getByRole` -- accessible roles (button, heading, etc.)
2. `getByText` -- visible text content
3. `getByLabelText` -- form labels
4. `getByTestId` -- last resort, `data-testid` attribute
5. `container.querySelector` -- escape hatch for CSS selectors

**Inline snapshots** -- use `toMatchInlineSnapshot()` to capture rendered HTML. Vitest auto-fills on first run with `--update`. Snapshots catch unintended UI regressions.

**When to use which mock utility:**
- `vi.fn()` -- simple function stubs/spies in Vitest tests. Prefer this for new tests.
- `vi.spyOn(obj, 'method')` -- spy on an existing method while preserving its implementation.
- Existing `mock.ts` / `Test*` classes -- use when the mock needs complex state (emitters, observable values, multi-method coordination). These exist for services like `TestRuntimeSessionService`.
- `sinon` -- avoid in new Vitest tests. Use `vi.fn()` instead.
```

- [ ] **Step 3: Update "Where should I put my test?" to mention Vitest**

Update the numbered list to add Vitest as the default for new Positron tests:

```markdown
1. **Vitest tests** (`*.vitest.ts` / `*.vitest.tsx`) -- DEFAULT for new Positron code in `src/`. No Electron or build daemons needed. Covers pure functions, service integration tests, and React component tests. Uses happy-dom.
2. **Core tests** (`*.test.ts`) -- Legacy Mocha tests for Positron code in `src/`. Existing tests being migrated to Vitest. Still used by upstream VS Code tests.
3. **Extension host** (`npm run test-extension`) -- Needs Electron. Only when your test requires activated extensions, workspace APIs, or editor document manipulation.
4. **E2E** (Playwright) -- Needs the full app. Only for user-visible workflows across multiple systems.
```

- [ ] **Step 4: Verify the markdown renders correctly**

Read the updated CLAUDE.md to verify formatting.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Vitest and React component testing guide to CLAUDE.md"
```

---

## Task 14: Final verification and cleanup

- [ ] **Step 1: Run complete Vitest suite**

Run: `npx vitest run --reporter=verbose`
Expected: 44 test files pass (42 migrated + 2 smoke tests)

- [ ] **Step 2: Run coverage on showcase test**

Run: `npx vitest run --coverage --coverage.include='**/topActionBarSessionManager.tsx' src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx`
Expected: 100% coverage

- [ ] **Step 3: Run precommit checks**

Run: `npm run precommit`
Expected: no lint/format errors on changed files

- [ ] **Step 4: Verify no .test.ts files remain for migrated tests**

Run: `find src/vs -name '*.test.ts' | grep -i positron | head -20`
Expected: only `.test.tsx` files remain (React component tests not migrated in this PR)

- [ ] **Step 5: Review git log**

Run: `git log --oneline mi/vitest-rtl-pr2 --not main`
Expected: clean commit history with ~11 commits covering deps, config, CI, infrastructure, migration batches, RTL, showcase test, docs

---

## Success Criteria

From the design spec:

1. **All Positron `.test.ts` files migrated** to `.vitest.ts` with Vitest syntax
2. **`npm run test:vitest` passes** all tests without build daemons or Electron
3. **CI runs vitest before compilation** -- fast feedback in `test-unit.yml`
4. **RTL helper** (`setupRTLRenderer`) bridges `createTestContainer()` with `@testing-library/react`
5. **Showcase test** achieves 100% coverage on `topActionBarSessionManager.tsx`
6. **Inline snapshots** for each session state (no session, console, notebook)
7. **CLAUDE.md** updated with React component testing patterns and no-build-daemon workflow
8. **No internal functions exported** for testing -- all behavior tested through rendered output
9. **Mocha .test.tsx files unaffected** -- they continue running under the existing test runner

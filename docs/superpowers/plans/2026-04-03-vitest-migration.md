# Vitest Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mocha with Vitest for all 67 Positron-specific unit tests, with a builder pattern that makes writing tests accessible to any developer.

**Architecture:** Three layers -- Vitest runtime config (Layer 1), PositronTestContainer builder (Layer 2), and migrated test files (Layer 3). The builder wraps existing `TestInstantiationService` infrastructure without reimplementing it. Tests use `.vitest.ts` extension to avoid collision with upstream Mocha tests.

**Tech Stack:** Vitest, happy-dom, @testing-library/react, esbuild (via Vite), existing TestInstantiationService + Sinon

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `vitest.config.ts` | Vitest runner config: test discovery, environment, esbuild options |
| `tsconfig.vitest.json` | TypeScript config with Vitest globals instead of Mocha |
| `src/vs/base/test/common/vitestSetup.ts` | Global setup: disposable lifecycle via beforeEach/afterEach |
| `src/vs/workbench/test/common/positronTestContainer.ts` | Builder pattern wrapping TestInstantiationService |
| `scripts/test-positron-vitest.sh` | Convenience wrapper for running Vitest |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add devDependencies and npm scripts |

### Migrated Files (67 total, done in Tasks 4-8)

Original `.test.ts` / `.test.tsx` files are replaced by `.vitest.ts` / `.vitest.tsx` equivalents, then deleted.

---

## Task 1: Install Dependencies and Add npm Scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Vitest and related packages**

```bash
npm install --save-dev vitest @vitest/coverage-v8 happy-dom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Add npm scripts to package.json**

Add these entries to the `"scripts"` section in `package.json`, after the existing `"test-build-scripts"` entry:

```json
"test-vitest": "vitest",
"test-vitest:run": "vitest run",
"test-vitest:coverage": "vitest run --coverage",
```

- [ ] **Step 3: Verify installation**

```bash
npx vitest --version
```

Expected: Prints Vitest version number (e.g., `vitest/3.x.x`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest and testing-library dependencies"
```

---

## Task 2: Create Vitest Configuration

**Files:**
- Create: `vitest.config.ts`
- Create: `tsconfig.vitest.json`

- [ ] **Step 1: Create `tsconfig.vitest.json`**

```json
{
	"extends": "./src/tsconfig.base.json",
	"compilerOptions": {
		"esModuleInterop": true,
		"jsx": "react-jsx",
		"removeComments": false,
		"preserveConstEnums": true,
		"sourceMap": false,
		"allowJs": true,
		"resolveJsonModule": true,
		"isolatedModules": false,
		"outDir": "./out/vs",
		"types": [
			"@webgpu/types",
			"semver",
			"sinon",
			"trusted-types",
			"winreg",
			"wicg-file-system-access"
		]
	},
	"include": [
		"./src/*.ts",
		"./src/typings",
		"./src/vs/**/*.ts",
		"./src/vs/**/*.tsx",
		"./src/positron-dts/positron.d.ts",
		"./src/positron-dts/ui-comm.d.ts",
		"./src/vscode-dts/vscode.proposed.*.d.ts",
		"./src/vscode-dts/vscode.d.ts",
		"./vitest.config.ts"
	]
}
```

Note: This intentionally omits `"mocha"` from types and does NOT add `"vitest/globals"` -- Vitest injects its own globals at runtime via the `globals: true` config option. This avoids type conflicts entirely.

- [ ] **Step 2: Create `vitest.config.ts`**

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	test: {
		globals: true,
		environment: 'happy-dom',
		include: ['src/vs/**/*.vitest.ts', 'src/vs/**/*.vitest.tsx'],
		setupFiles: ['./src/vs/base/test/common/vitestSetup.ts'],
		testTimeout: 10000,
	},
	resolve: {
		extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
	},
	esbuild: {
		tsconfigRaw: {
			compilerOptions: {
				experimentalDecorators: true,
				jsx: 'react-jsx',
			},
		},
	},
});
```

- [ ] **Step 3: Verify config loads**

```bash
npx vitest run --passWithNoTests
```

Expected: `No test files found` with exit code 0 (not a config error).

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tsconfig.vitest.json
git commit -m "chore: add vitest and tsconfig configuration"
```

---

## Task 3: Create Test Infrastructure (vitestSetup + PositronTestContainer)

**Files:**
- Create: `src/vs/base/test/common/vitestSetup.ts`
- Create: `src/vs/workbench/test/common/positronTestContainer.ts`
- Create: `scripts/test-positron-vitest.sh`

- [ ] **Step 1: Create `src/vs/base/test/common/vitestSetup.ts`**

This adapts VS Code's disposable leak tracking to Vitest's `beforeEach`/`afterEach`:

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, DisposableTracker, IDisposable, setDisposableTracker } from '../../common/lifecycle.js';

/**
 * Vitest-compatible version of ensureNoDisposablesAreLeakedInTestSuite.
 * Returns a DisposableStore that is automatically cleaned up after each test.
 * Call this at the top level of a describe() block.
 */
export function ensureNoLeakedDisposables(): Pick<DisposableStore, 'add'> {
	let tracker: DisposableTracker | undefined;
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
		tracker = new DisposableTracker();
		setDisposableTracker(tracker);
	});

	afterEach(() => {
		store.dispose();
		setDisposableTracker(null);
		if (tracker) {
			const result = tracker.computeLeakingDisposables();
			if (result) {
				throw new Error(`There are ${result.leaks.length} undisposed disposables!${result.details}`);
			}
		}
	});

	return {
		add<T extends IDisposable>(o: T): T {
			return store.add(o);
		}
	};
}
```

- [ ] **Step 2: Create `src/vs/workbench/test/common/positronTestContainer.ts`**

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ServiceIdentifier } from '../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../platform/instantiation/common/serviceCollection.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createRuntimeServices } from '../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { positronWorkbenchInstantiationService } from '../browser/positronWorkbenchTestServices.js';
import { ensureNoLeakedDisposables } from '../../../base/test/common/vitestSetup.js';

interface TestContainerResult {
	/** Retrieve a registered service by its identifier. */
	get: <T>(id: ServiceIdentifier<T>) => T;
	/** The underlying instantiation service (escape hatch for advanced use). */
	instantiationService: TestInstantiationService;
	/** Disposable store -- auto-cleaned after each test. Pass to helpers that need it. */
	disposables: Pick<DisposableStore, 'add'>;
}

class PositronTestContainerBuilder {
	private _useRuntimeServices = false;
	private _useWorkbenchServices = false;
	private _stubs: Array<{ id: ServiceIdentifier<any>; impl: any }> = [];

	/** Add the 18 runtime/language services (ILanguageRuntimeService, IRuntimeSessionService, etc.) */
	withRuntimeServices(): this {
		this._useRuntimeServices = true;
		return this;
	}

	/** Add the full 124+ workbench service stack (includes runtime services). */
	withWorkbenchServices(): this {
		this._useWorkbenchServices = true;
		return this;
	}

	/** Stub a specific service. Applied after presets, so it overrides preset defaults. */
	stub<T>(id: ServiceIdentifier<T>, impl: Partial<T>): this {
		this._stubs.push({ id, impl });
		return this;
	}

	/** Build the container. Returns get(), instantiationService, and disposables. */
	build(): TestContainerResult {
		const disposables = ensureNoLeakedDisposables();

		let instantiationService: TestInstantiationService;

		if (this._useWorkbenchServices) {
			// Full workbench includes runtime services
			instantiationService = positronWorkbenchInstantiationService(disposables);
		} else if (this._useRuntimeServices) {
			instantiationService = new TestInstantiationService(new ServiceCollection());
			createRuntimeServices(instantiationService, disposables);
		} else {
			instantiationService = new TestInstantiationService(new ServiceCollection());
		}

		// Apply manual stubs (overrides preset defaults)
		for (const { id, impl } of this._stubs) {
			instantiationService.stub(id, impl);
		}

		return {
			get: <T>(id: ServiceIdentifier<T>) => instantiationService.get(id),
			instantiationService,
			disposables,
		};
	}
}

/** Create a test container with fluent builder API. */
export function createTestContainer(): PositronTestContainerBuilder {
	return new PositronTestContainerBuilder();
}
```

- [ ] **Step 3: Create `scripts/test-positron-vitest.sh`**

```bash
#!/usr/bin/env bash
set -e

# Run Positron Vitest tests
# Usage:
#   ./scripts/test-positron-vitest.sh           # watch mode
#   ./scripts/test-positron-vitest.sh run        # single run (CI)
#   ./scripts/test-positron-vitest.sh coverage   # with coverage

if [ "$1" = "run" ]; then
	npx vitest run
elif [ "$1" = "coverage" ]; then
	npx vitest run --coverage
else
	npx vitest
fi
```

```bash
chmod +x scripts/test-positron-vitest.sh
```

- [ ] **Step 4: Commit**

```bash
git add src/vs/base/test/common/vitestSetup.ts src/vs/workbench/test/common/positronTestContainer.ts scripts/test-positron-vitest.sh
git commit -m "feat: add Vitest test infrastructure (setup, builder, script)"
```

---

## Task 4: Proof of Concept -- Migrate Tier 0 Test

**Files:**
- Create: `src/vs/platform/update/test/electron-main/positronVersions.vitest.ts`
- Test: `src/vs/platform/update/test/electron-main/positronVersions.vitest.ts`

- [ ] **Step 1: Write the migrated test**

Create `src/vs/platform/update/test/electron-main/positronVersions.vitest.ts`:

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUpdate } from '../../common/update.js';
import * as positronVersion from '../../common/positronVersion.js';

describe('Positron Version', () => {

	it('compare update with build number to version without build number', () => {
		const update: IUpdate = { version: '2024.11.0-111' };
		expect(positronVersion.hasUpdate(update, '2024.11.0')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2024.09.0')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2024.12.0')).toBe(false);

		const updateNoBuild: IUpdate = { version: '2024.11.0' };
		expect(positronVersion.hasUpdate(updateNoBuild, '2024.11.0-111')).toBe(false);
		expect(positronVersion.hasUpdate(updateNoBuild, '2024.09.0-111')).toBe(true);
		expect(positronVersion.hasUpdate(updateNoBuild, '2024.12.0-111')).toBe(false);
	});

	it('compare year version', () => {
		const update: IUpdate = { version: '2024.12.0-111' };
		expect(positronVersion.hasUpdate(update, '2024.12.0-111')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2023.12.0-111')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2025.12.0-111')).toBe(false);
	});

	it('compare month version', () => {
		const update: IUpdate = { version: '2024.05.0-111' };
		expect(positronVersion.hasUpdate(update, '2024.05.0-111')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2024.02.0-111')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2024.12.0-111')).toBe(false);
	});

	it('compare patch version', () => {
		const update: IUpdate = { version: '2024.11.10-18' };
		expect(positronVersion.hasUpdate(update, '2024.11.10-18')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2024.11.0-18')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2024.11.12-18')).toBe(false);
	});

	it('compare build number', () => {
		const update: IUpdate = { version: '2024.11.1-18' };
		expect(positronVersion.hasUpdate(update, '2024.11.1-18')).toBe(false);
		expect(positronVersion.hasUpdate(update, '2024.11.1-10')).toBe(true);
		expect(positronVersion.hasUpdate(update, '2024.11.1-20')).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run src/vs/platform/update/test/electron-main/positronVersions.vitest.ts
```

Expected: All 5 tests PASS. This validates that Vitest can resolve `.js` imports to `.ts` source files and that the config works end-to-end.

- [ ] **Step 3: Delete the original Mocha test**

```bash
rm src/vs/platform/update/test/electron-main/positronVersions.test.ts
```

- [ ] **Step 4: Verify Mocha upstream tests still work**

```bash
npm run build-start && npm run build-check && ./scripts/test.sh --run src/vs/platform/update/test/electron-main/positronVersions.test.ts 2>&1 | head -5
```

Expected: File not found or no tests run (the Mocha version is deleted). Upstream tests are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/vs/platform/update/test/electron-main/positronVersions.vitest.ts
git rm src/vs/platform/update/test/electron-main/positronVersions.test.ts
git commit -m "test: migrate positronVersions to Vitest (Tier 0 POC)"
```

---

## Task 5: Proof of Concept -- Migrate Tier 2 Test (Runtime Services)

**Files:**
- Create: `src/vs/workbench/services/positronConnections/test/positronConnectionsService.vitest.ts`
- Test: `src/vs/workbench/services/positronConnections/test/positronConnectionsService.vitest.ts`

This validates the `createTestContainer().withRuntimeServices()` builder preset.

- [ ] **Step 1: Read the original test to understand its structure**

```bash
cat src/vs/workbench/services/positronConnections/test/positronConnectionsService.test.ts
```

Understand the imports, setup pattern, and assertions so the migration is faithful.

- [ ] **Step 2: Write the migrated test**

Create `src/vs/workbench/services/positronConnections/test/positronConnectionsService.vitest.ts`:

Migrate the test using these rules:
- `suite(...)` becomes `describe(...)`
- `test(...)` becomes `it(...)`
- `setup(...)` becomes `beforeEach(...)`
- `teardown(...)` becomes `afterEach(...)`
- `assert.strictEqual(a, b)` becomes `expect(a).toBe(b)`
- `assert.ok(x)` becomes `expect(x).toBeTruthy()`
- `assert.deepStrictEqual(a, b)` becomes `expect(a).toEqual(b)`
- Replace `ensureNoDisposablesAreLeakedInTestSuite()` + `createRuntimeServices()` with `createTestContainer().withRuntimeServices().build()`
- Add any extra `.stub()` calls for services beyond the runtime preset (e.g., `ISecretStorageService`)

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/vs/workbench/services/positronConnections/test/positronConnectionsService.vitest.ts
```

Expected: All tests PASS. This validates the builder's runtime services preset works.

- [ ] **Step 4: Delete the original and commit**

```bash
git rm src/vs/workbench/services/positronConnections/test/positronConnectionsService.test.ts
git add src/vs/workbench/services/positronConnections/test/positronConnectionsService.vitest.ts
git commit -m "test: migrate positronConnectionsService to Vitest (Tier 2 POC)"
```

---

## Task 6: Proof of Concept -- Migrate Tier 3 Test (Full Workbench)

**Files:**
- Create: `src/vs/workbench/test/browser/services/positronVariablesService.vitest.ts`
- Test: `src/vs/workbench/test/browser/services/positronVariablesService.vitest.ts`

This validates `createTestContainer().withWorkbenchServices()`.

- [ ] **Step 1: Read the original test**

```bash
cat src/vs/workbench/test/browser/services/positronVariablesService.test.ts
```

- [ ] **Step 2: Write the migrated test**

Create `src/vs/workbench/test/browser/services/positronVariablesService.vitest.ts`:

Apply the same migration rules as Task 5. Key changes:
- Replace `positronWorkbenchInstantiationService(disposables)` with `createTestContainer().withWorkbenchServices().build()`
- Replace `instantiationService.createInstance(PositronTestServiceAccessor)` + accessor properties with `get(IServiceId)` calls
- Replace `startTestLanguageRuntimeSession(instantiationService, disposables, ...)` -- pass the `instantiationService` and `disposables` from `build()` result
- `timeout(0)` from `vs/base/common/async.js` still works as-is

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/vs/workbench/test/browser/services/positronVariablesService.vitest.ts
```

Expected: All 4 tests PASS. This validates the full workbench builder preset.

- [ ] **Step 4: Delete the original and commit**

```bash
git rm src/vs/workbench/test/browser/services/positronVariablesService.test.ts
git add src/vs/workbench/test/browser/services/positronVariablesService.vitest.ts
git commit -m "test: migrate positronVariablesService to Vitest (Tier 3 POC)"
```

---

## Task 7: Migrate Remaining Tier 0 + Tier 1 Tests (37 files)

**Files:**
- Migrate all remaining Tier 0 and Tier 1 `.test.ts` files to `.vitest.ts`
- Delete originals

These are mechanical migrations. For each file:

- [ ] **Step 1: Migrate all Tier 0 tests (19 remaining)**

For each file, apply these mechanical transformations:
- `suite(...)` -> `describe(...)`
- `test(...)` -> `it(...)`
- `setup(...)` -> `beforeEach(...)`
- `teardown(...)` -> `afterEach(...)`
- `assert.strictEqual(a, b)` -> `expect(a).toBe(b)`
- `assert.ok(x)` -> `expect(x).toBeTruthy()`
- `assert.deepStrictEqual(a, b)` -> `expect(a).toEqual(b)`
- `assert(x)` -> `expect(x).toBeTruthy()`
- Remove `import assert from 'assert'`
- Remove `ensureNoDisposablesAreLeakedInTestSuite()` (no disposables in Tier 0)
- Remove `import { ensureNoDisposablesAreLeakedInTestSuite } from '...'`
- Save as `.vitest.ts` alongside the original, then delete the original

Key Tier 0 files to migrate:
- `src/vs/base/test/common/ansiOutput.test.ts`
- `src/vs/base/test/common/ansiStyles.test.ts`
- `src/vs/workbench/contrib/positronConsole/test/common/linkDetector.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookOutline.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookOutputUtils.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/copyImageUtils.test.ts`
- `src/vs/workbench/contrib/positronPathUtils/test/browser/filePathConverter.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/common/quartoParser.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/common/quartoExecutionOptions.test.ts`
- `src/vs/workbench/contrib/positronQuartoNotebook/test/common/quartoNotebookRoundTrip.test.ts`
- `src/vs/workbench/contrib/positronQuartoNotebook/test/common/qmdToNotebook.test.ts`
- `src/vs/workbench/contrib/positronQuartoNotebook/test/common/notebookToQmd.test.ts`
- `src/vs/workbench/contrib/notebook/test/browser/positronNotebookCommandPalette.test.ts`
- `src/vs/workbench/services/positronDataExplorer/test/common/positronDataExplorerMocks.test.ts`
- `src/vs/workbench/services/positronDataExplorer/test/common/positronDataExplorerInternals.test.ts`
- `src/vs/workbench/test/browser/layoutManager.test.ts`
- `src/vs/platform/extensions/test/common/positronExtensionValidator.test.ts`
- `src/vs/platform/update/test/common/positronUpdateUtils.test.ts`

- [ ] **Step 2: Migrate all Tier 1 tests (17 files)**

Same mechanical transformations, plus:
- Replace manual `TestInstantiationService` + `stub()` with `createTestContainer().stub(IService, mock).build()`
- Import `createTestContainer` from the appropriate relative path
- Keep Sinon stubs/spies where they exist -- they work in Vitest

Key Tier 1 files:
- `src/vs/workbench/services/languageRuntime/test/common/languageRuntime.test.ts`
- `src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.test.ts`
- `src/vs/workbench/contrib/positronWelcome/test/browser/helpers.test.ts`
- `src/vs/workbench/contrib/positronAssistant/test/browser/languageModelSessionSync.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/browser/quartoDocumentModel.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/browser/quartoCellToolbar.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/browser/quartoOutputManager.test.ts`
- `src/vs/workbench/api/test/common/positron/extHostPositronEphemeralStorage.test.ts`
- `src/vs/workbench/api/test/browser/positron/mainThreadPositronEphemeralStorage.test.ts`
- `src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.test.ts`
- `src/vs/platform/extensionManagement/test/common/positronExtensionCompatibility.test.ts`
- `src/vs/editor/contrib/positronStatementRange/test/browser/provideStatementRange.test.ts`
- `src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.test.ts`

- [ ] **Step 3: Run all migrated tests**

```bash
npx vitest run
```

Expected: All Tier 0 and Tier 1 tests PASS.

- [ ] **Step 4: Delete all originals and commit**

```bash
git add src/vs/**/*.vitest.ts src/vs/**/*.vitest.tsx
git rm <all original .test.ts files listed above>
git commit -m "test: migrate Tier 0 and Tier 1 Positron tests to Vitest (37 files)"
```

---

## Task 8: Migrate Remaining Tier 2, Tier 3, and React Tests (30 files)

**Files:**
- Migrate all remaining Tier 2, Tier 3, and React `.test.ts`/`.test.tsx` files

- [ ] **Step 1: Migrate Tier 2 tests (7 remaining)**

Same rules as Task 5. Use `createTestContainer().withRuntimeServices().build()`. Files:
- `src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.test.ts`
- `src/vs/workbench/services/runtimeSession/test/common/runtimeSession.test.ts`
- `src/vs/workbench/services/positronHistory/test/common/executionHistoryService.test.ts`
- `src/vs/workbench/contrib/positronAssistant/test/browser/positronAssistantService.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/browser/quartoExecutionManager.test.ts`
- `src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.test.ts`
- `src/vs/workbench/contrib/positronWebviewPreloads/test/browser/positronWebviewPreloadService.test.ts`

- [ ] **Step 2: Migrate Tier 3 tests (15 remaining)**

Same rules as Task 6. Use `createTestContainer().withWorkbenchServices().build()`. Files:
- `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernelService.test.ts`
- `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernel.test.ts`
- `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/notebookExecutionStatus.test.ts`
- `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.test.ts`
- `src/vs/workbench/contrib/positronPlots/test/electron-browser/positronPlotsService.test.ts`
- `src/vs/workbench/contrib/positronIPyWidgets/test/browser/positronIPyWidgetsService.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookSplitJoin.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookInstance.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookEditorResolution.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookConfigurationHandling.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookCellOutputs.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookCell.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronNotebookFind.test.ts`

- [ ] **Step 3: Migrate React/DOM tests (12 files, .tsx)**

Same migration rules, plus:
- Replace `setupReactRenderer()` (Mocha-specific) with `@testing-library/react`'s `render()` and `cleanup()` where possible
- For tests that use raw DOM queries (`querySelector`, `getElementById`), keep them -- happy-dom supports these
- Save as `.vitest.tsx`

Files:
- `src/vs/workbench/contrib/positronNotebook/test/browser/useDisposableEffect.test.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookErrorBoundary.test.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/useWheelForwarding.test.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/useScrollingIndicator.test.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.test.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputCollapseButton.test.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.test.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellActionButton.test.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.test.tsx`
- `src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.test.tsx`
- `src/vs/platform/positronActionBar/test/browser/actionBarWidget.test.tsx`
- `src/vs/base/test/browser/positronModalReactRenderer.test.ts`

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: All 67 migrated tests PASS.

- [ ] **Step 5: Delete all originals and commit**

```bash
git add src/vs/**/*.vitest.ts src/vs/**/*.vitest.tsx
git rm <all original .test.ts/.test.tsx files listed above>
git commit -m "test: migrate remaining Positron tests to Vitest (Tier 2, 3, React)"
```

---

## Task 9: CI Integration

**Files:**
- Modify: `.github/workflows/test-unit.yml`

- [ ] **Step 1: Add Vitest step to the workflow**

In `.github/workflows/test-unit.yml`, add this step after the "Install node dependencies" step and before "Compile Positron and Download Electron":

```yaml
      - name: 🧪 Run Vitest Tests (Positron)
        id: vitest-tests
        run: npm run test-vitest:run
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/test-unit.yml
git commit -m "ci: add Vitest step to unit test workflow"
```

---

## Task 10: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md testing section**

In the `## Testing` section of `CLAUDE.md`, add after the existing test commands:

```markdown
- Positron Vitest tests (`src/**/*.vitest.ts`):
	- `npm run test-vitest`: watch mode (re-runs on save, no build daemon needed)
	- `npm run test-vitest:run`: single run
	- `npx vitest run src/path/to/<file>.vitest.ts`: run a specific file
	- `npx vitest run --grep '<pattern>'`: run tests matching a pattern
	- New Positron tests should use `.vitest.ts` extension and the `createTestContainer()` builder
```

- [ ] **Step 2: Run the full Vitest suite one final time**

```bash
npx vitest run
```

Expected: All 67 tests PASS.

- [ ] **Step 3: Verify upstream Mocha tests are unaffected**

```bash
npm run build-start && npm run build-check && ./scripts/test-positron.sh
```

Expected: No Positron tests found (they've all been migrated). Upstream tests still pass via `./scripts/test.sh`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Vitest test commands"
```

# Design Spec: Vitest for Positron Unit Tests

## Problem

Positron inherits VS Code's Mocha-based unit test infrastructure. While this serves the 814 upstream VS Code test files well, it creates significant friction for Positron-specific development:

1. **Writing a test is hard.** Testing a Positron service requires understanding VS Code's dependency injection system, choosing from 124+ service stubs spread across ~2,500 lines of boilerplate, and managing disposable lifecycle tracking. 40-60% of test code is setup, not assertions.

2. **Running a test is slow.** Tests require background build daemons to compile TypeScript to JavaScript before execution. The feedback loop is: edit code -> wait for daemon to recompile (30-60s first run) -> run test inside Electron. There is no watch mode.

3. **CI is expensive.** The unit test job has a 40-minute timeout. It downloads Electron, installs xvfb, compiles the entire project, installs Playwright browsers, and sets up R -- all before a single test runs.

4. **Coverage gaps grow.** 20 Positron contrib modules and 14 Positron extensions have zero unit tests. Teams default to E2E tests because unit tests are too hard to write and too slow to iterate on.

5. **We can't find all our tests.** The command `./scripts/test-positron.sh` uses `--grep 'Positron'` to filter by Mocha suite name. But many Positron-authored suites don't include "Positron" in their name (e.g., `suite('ANSIOutput', ...)`, `suite('parseQuarto', ...)`). Result: the grep finds only 416 of 937 Positron tests -- more than half are invisible. With Vitest, the `.vitest.ts` file extension is the boundary -- no grep, no guessing.

### Success Criteria

- Any developer (including QA engineers) can write a Positron unit test without help within 30 minutes
- The untested Positron modules start getting coverage
- The feedback loop from code change to test result is under 5 seconds locally

---

## Codebase Analysis

### Positron is 93% pure TypeScript

| File Type | Count | Percentage | Description |
|-----------|-------|------------|-------------|
| `.ts` (TypeScript) | 4,597 | 93% | Services, runtime communication, business logic |
| `.tsx` (React) | 360 | 7% | UI components for Console, Variables, Plots, Data Explorer, Notebooks |

VS Code uses zero React. Positron adds React selectively for interactive, data-heavy panels. The service layer -- where most testable logic lives -- is overwhelmingly pure TypeScript.

### React usage by Positron area

| Area | .tsx (React) | .ts (Non-React) | React % |
|------|-------------|-----------------|---------|
| positronConsole | 43 | 8 | 84% |
| positronVariables | 18 | 3 | 86% |
| positronNotebook | 56 | 57 | 49% |
| positronPlots | 17 | 8 | 68% |
| positronConnections | 12 | 1 | 92% |
| positronAssistant | 12 | 5 | 71% |
| **All Positron services** | **18** | **106** | **15%** |

### Current Positron test files: 67 total

| Tier | Files | Description | Example |
|------|-------|-------------|---------|
| **Tier 0 -- Pure Logic** | 20 | No DI. Import function, call it, assert. | `positronVersions.test.ts` -- version string comparison |
| **Tier 1 -- Light DI** | 17 | 1-5 manual service stubs | `languageRuntime.test.ts` -- 2 stubs, tests LanguageRuntimeService |
| **Tier 2 -- Runtime Services** | 8 | Uses `createRuntimeServices()` (18 stubs) | `runtimeSession.test.ts` -- session lifecycle |
| **Tier 3 -- Full Workbench** | 16 | Uses `positronWorkbenchInstantiationService()` (124+ stubs) | `positronVariablesService.test.ts` -- notebook-integrated variables |
| **React/DOM** | 12 | React components with DOM queries | `CellTextOutput.test.tsx` -- output rendering |

> Note: 6 files overlap between tiers and React categories. 67 unique files total.

### Test file types

| Type | Files | Description |
|------|-------|-------------|
| `.ts` (pure TypeScript tests) | 55 | Service logic, parsers, utilities |
| `.tsx` (React component tests) | 12 | UI rendering and interaction |

### Electron dependency audit

All 67 Positron test files were audited for Electron API usage. **Zero files directly import Electron APIs.** All tests interact with VS Code through the service abstraction layer. Every file can migrate to Vitest.

---

## Design

### Architecture

```
Layer 3: Test Files (.vitest.ts / .vitest.tsx)
         What developers and QA write.
         describe/it/expect syntax.
         Import builder, get services, assert.

Layer 2: PositronTestContainer (builder pattern)
         Hides the 124-service DI complexity.
         Tiered presets: bare, runtime, workbench.
         One import, one chain, done.

Layer 1: Vitest Runtime
         vitest.config.ts + tsconfig.vitest.json
         esbuild transpiles TS directly (no build daemon).
         happy-dom for DOM-needing tests.
         Watch mode, coverage, CI mode.
```

### Why Vitest over improving Mocha

The core value is eliminating the compilation bottleneck. This benefits all TypeScript equally -- the 93% that is pure TS and the 7% that is React.

| Pain Point | Mocha Fix | Vitest Fix |
|---|---|---|
| Build daemon required | Can't fix -- Mocha runs compiled JS | Eliminated -- esbuild transpiles on the fly |
| No watch mode | Can't fix well -- daemon must recompile first | Built-in, HMR-based, instant |
| 124-service mock monster | Could add builder pattern | Same builders + `vi.mock()` for module-level mocking |
| 40-min CI with Electron/xvfb | Can't fix -- Mocha runner IS Electron | ~30s CI step, plain Node.js process |
| `suite/test` TDD style | Stuck | `describe/it` -- industry standard, team already knows it |

### Why not replace upstream VS Code tests too?

Positron merges upstream VS Code roughly every month (1.106, 1.107, 1.108, 1.109...). Modifying 814 upstream test files would cause hundreds of merge conflicts on every upstream merge. The fork boundary is the natural framework boundary:

- Positron code = Vitest
- Upstream VS Code code = Mocha (untouched)

### Technical feasibility

| Constraint | Status | Details |
|-----------|--------|---------|
| Module system | Compatible | Codebase is ESM. Vitest is ESM-native. |
| `.js` extensions in TS imports | Compatible | Vitest/esbuild resolves `.js` to `.ts` with `nodenext` resolution. |
| `experimentalDecorators` | Compatible | Already enabled in `src/tsconfig.base.json`. esbuild supports it. |
| React JSX | Compatible | `jsx: "react-jsx"` already configured in `src/tsconfig.json`. |
| Sinon mocking library | Compatible | Regular npm dependency, not Mocha-coupled. Works in Vitest. |
| `TestInstantiationService` | Compatible | Uses Sinon internally, no Mocha dependency. |
| TypeScript type conflicts | Solved | Separate `tsconfig.vitest.json` with `vitest/globals` types. |
| Test file collision | Solved | `.vitest.ts` extension vs `.test.ts` -- zero overlap in discovery. |

---

### Layer 1: Vitest Runtime Configuration

**`vitest.config.ts`** (repo root):

- Test discovery: `src/vs/**/*.vitest.ts` and `src/vs/**/*.vitest.tsx`
- Environment: `happy-dom` (lightweight DOM for the 12 React tests; no-op for pure TS)
- Globals: `true` (`describe`, `it`, `expect` available without import)
- Setup file: `src/vs/base/test/common/vitestSetup.ts`
- esbuild config: `experimentalDecorators: true`, `jsx: react-jsx`

**`tsconfig.vitest.json`** (repo root):

- Extends `src/tsconfig.base.json` (same compiler options as the rest of the codebase)
- Types: `["vitest/globals"]` (replaces Mocha's `suite/test` globals with Vitest's `describe/it`)
- Same include paths as `src/tsconfig.json`

**npm scripts** added to `package.json`:

| Script | Command | Use Case |
|--------|---------|----------|
| `test-vitest` | `vitest` | Local dev -- watch mode, re-runs on save |
| `test-vitest:run` | `vitest run` | CI and one-shot runs |
| `test-vitest:coverage` | `vitest run --coverage` | Coverage reports |

**Developer experience**: Run `npm run test-vitest`, edit a file, see results instantly. No `npm run build-start` first.

---

### Layer 2: PositronTestContainer (Builder Pattern)

A fluent builder that wraps `TestInstantiationService` behind tiered presets.

**Location**: `src/vs/workbench/test/common/positronTestContainer.ts`

**API**:

```typescript
// Tier 0 -- bare container, no services
const container = createTestContainer();

// Tier 1 -- add specific stubs
const container = createTestContainer()
    .stub(ILogService, new NullLogService())
    .stub(IConfigurationService, new TestConfigurationService());

// Tier 2 -- runtime preset (18 services pre-wired)
const container = createTestContainer()
    .withRuntimeServices();

// Tier 3 -- full workbench preset (124+ services pre-wired)
const container = createTestContainer()
    .withWorkbenchServices();

// Any tier can override specific services after a preset
const container = createTestContainer()
    .withRuntimeServices()
    .stub(IPositronConsoleService, myCustomMock);

// .build() returns what you need
const { get, instantiationService, disposables } = container.build();
const myService = get(IPositronVariablesService);
```

**What `.build()` returns**:

| Property | Type | Purpose |
|----------|------|---------|
| `get(id)` | `<T>(id: ServiceIdentifier<T>) => T` | Retrieve any registered service |
| `instantiationService` | `TestInstantiationService` | Escape hatch for advanced use cases |
| `disposables` | `DisposableStore` | Auto-cleaned after each test via vitestSetup.ts |

**Implementation strategy**: The builder delegates to existing infrastructure. `withRuntimeServices()` calls `createRuntimeServices()` from `testRuntimeSessionService.ts`. `withWorkbenchServices()` calls `positronWorkbenchInstantiationService()` from `positronWorkbenchTestServices.ts`. No logic is reimplemented. If a service is added to the existing setup functions, the builder picks it up automatically.

**Disposables handling**: VS Code services hold resources (event subscriptions, file handles, timers). `disposables` is a bucket that collects them; when the test ends, everything in the bucket gets cleaned up. The `vitestSetup.ts` global setup handles this via `afterEach` -- test authors destructure `disposables` from `.build()` and pass it to helpers that need it. No manual setup or leak detection code required in test files.

---

### Layer 3: Test Files

**File naming**: `.vitest.ts` / `.vitest.tsx` (zero collision with Mocha's `.test.ts` discovery)

**Before/after examples**:

#### Tier 0 -- Pure Logic

Before:
```typescript
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import * as positronVersion from '../../common/positronVersion.js';

suite('Positron Version', function () {
    ensureNoDisposablesAreLeakedInTestSuite();

    test('compare versions', () => {
        const update = { version: '2024.11.0-111' };
        assert.strictEqual(positronVersion.hasUpdate(update, '2024.11.0'), false);
    });
});
```

After:
```typescript
import * as positronVersion from '../../common/positronVersion.js';

describe('Positron Version', () => {
    it('compare versions', () => {
        const update = { version: '2024.11.0-111' };
        expect(positronVersion.hasUpdate(update, '2024.11.0')).toBe(false);
    });
});
```

#### Tier 2 -- Runtime Services

Before:
```typescript
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createRuntimeServices, startTestLanguageRuntimeSession } from './testRuntimeSessionService.js';

suite('Positron - RuntimeSessionService', () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let instantiationService: TestInstantiationService;

    setup(() => {
        instantiationService = new TestInstantiationService();
        createRuntimeServices(instantiationService, disposables);
    });

    test('starts a session', async () => {
        const session = await startTestLanguageRuntimeSession(instantiationService, disposables);
        assert.ok(session);
    });
});
```

After:
```typescript
import { createTestContainer } from '../../../../test/common/positronTestContainer.js';
import { startTestLanguageRuntimeSession } from './testRuntimeSessionService.js';

describe('RuntimeSessionService', () => {
    const { instantiationService, disposables } = createTestContainer()
        .withRuntimeServices()
        .build();

    it('starts a session', async () => {
        const session = await startTestLanguageRuntimeSession(instantiationService, disposables);
        expect(session).toBeDefined();
    });
});
```

#### Tier 3 -- Full Workbench

Before:
```typescript
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { positronWorkbenchInstantiationService, PositronTestServiceAccessor }
    from '../positronWorkbenchTestServices.js';
import { IPositronVariablesService }
    from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { INotebookEditorService }
    from '../../contrib/notebook/browser/services/notebookEditorService.js';

suite('Positron - PositronVariablesService', () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let instantiationService: TestInstantiationService;
    let variablesService: IPositronVariablesService;
    let notebookEditorService: INotebookEditorService;

    setup(() => {
        instantiationService = positronWorkbenchInstantiationService(disposables);
        const accessor = instantiationService.createInstance(PositronTestServiceAccessor);
        variablesService = accessor.positronVariablesService;
        notebookEditorService = accessor.notebookEditorService;
        variablesService.setViewVisible(true);
    });

    test('should initialize with no active session', async () => {
        assert.strictEqual(variablesService.activePositronVariablesInstance, undefined);
    });
});
```

After:
```typescript
import { createTestContainer } from '../positronTestContainer.js';
import { IPositronVariablesService }
    from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { INotebookEditorService }
    from '../../contrib/notebook/browser/services/notebookEditorService.js';

describe('PositronVariablesService', () => {
    const { get } = createTestContainer()
        .withWorkbenchServices()
        .build();

    const variablesService = get(IPositronVariablesService);
    const notebookEditorService = get(INotebookEditorService);

    beforeEach(() => {
        variablesService.setViewVisible(true);
    });

    it('should initialize with no active session', () => {
        expect(variablesService.activePositronVariablesInstance).toBeUndefined();
    });
});
```

---

### CI Integration

The Vitest step runs early in the pipeline, before compilation:

```
CI pipeline with Vitest:
  1. Install Node deps
  2. Run Vitest (Positron)         ~30 seconds, needs nothing else
  3. Download Electron
  4. Compile entire project
  5. ... rest unchanged (runs upstream Mocha tests) ...
```

Fast failure: a broken Positron test reports in ~30 seconds instead of 20+ minutes.

**Workflow change** in `.github/workflows/test-unit.yml`:
```yaml
- name: Run Vitest Tests (Positron)
  run: npm run test-vitest:run
```

No Electron, no xvfb, no compilation step required.

---

### Migration Plan

All 67 existing Positron Mocha tests migrate to Vitest. After migration, the original `.test.ts` files are deleted.

| Phase | Files | Tier | Approach |
|-------|-------|------|----------|
| 1 | 20 | Tier 0 (pure logic) | Mechanical rename. Could be partially scripted. |
| 2 | 17 | Tier 1 (light DI) | Mechanical + swap stubs to builder `.stub()` calls |
| 3 | 8 | Tier 2 (runtime) | Use `.withRuntimeServices()` preset |
| 4 | 16 | Tier 3 (workbench) | Use `.withWorkbenchServices()` preset |
| 5 | 12 | React/DOM | Adopt `@testing-library/react` where beneficial |

> Note: 6 files overlap between phases. Each file migrated once.

---

### New Files

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest runner configuration |
| `tsconfig.vitest.json` | TypeScript config with Vitest types |
| `src/vs/base/test/common/vitestSetup.ts` | Global setup: disposable lifecycle, test environment |
| `src/vs/workbench/test/common/positronTestContainer.ts` | Builder pattern for service wiring |
| `scripts/test-positron-vitest.sh` | Convenience wrapper script |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add devDependencies (`vitest`, `@vitest/coverage-v8`, `happy-dom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`) and npm scripts |
| `.github/workflows/test-unit.yml` | Add Vitest CI step |
| `CLAUDE.md` | Update testing section with Vitest commands |

### Files Deleted After Migration

All 67 original `.test.ts` / `.test.tsx` Positron files, replaced by their `.vitest.ts` / `.vitest.tsx` equivalents.

---

## What This Does NOT Change

- **Upstream VS Code tests** -- all 814 files stay on Mocha, untouched
- **E2E tests** -- Playwright infrastructure unaffected
- **Extension tests** -- `npm run test-extension` pipeline unchanged
- **Build system** -- build daemons, compilation, packaging unchanged
- **`scripts/test.sh`** -- continues running upstream Mocha tests

---

## Verification

1. `npm run test-vitest` -- watch mode, all `.vitest.ts` files run on save
2. `npm run test-vitest:run` -- single CI run, all tests pass
3. `./scripts/test.sh` -- upstream Mocha tests still pass (no regression)
4. Each migration phase validated: migrated tests produce same pass/fail results
5. CI workflow runs Vitest step successfully alongside existing pipeline

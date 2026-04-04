# Design Spec: Positron Testing Strategy

## Problem

Positron inherits VS Code's Mocha-based unit test infrastructure. While this serves the 814 upstream VS Code test files well, it creates significant friction for Positron-specific development:

1. **Writing a test is hard.** Testing a Positron service requires understanding VS Code's dependency injection system, choosing from 124+ service stubs spread across ~2,500 lines of boilerplate, and managing disposable lifecycle tracking. 40-60% of test code is setup, not assertions.

2. **Running a test is slow.** Tests require background build daemons to compile TypeScript to JavaScript before execution. The feedback loop is: edit code -> wait for daemon to recompile (30-60s first run) -> run test inside Electron. There is no watch mode.

3. **CI is heavyweight.** The unit test job downloads Electron, installs xvfb, compiles the entire project, installs Playwright browsers, and sets up R -- all before a single test runs.

4. **Coverage gaps grow.** 20 Positron contrib modules and 14 Positron extensions have zero unit tests. Teams default to E2E tests because unit tests are too hard to write and too slow to iterate on.

5. **We can't find all our tests.** The command `./scripts/test-positron.sh` uses `--grep 'Positron'` to filter by Mocha suite name. But many Positron-authored suites don't include "Positron" in their name (e.g., `suite('ANSIOutput', ...)`, `suite('parseQuarto', ...)`). Result: the grep finds only 416 of 937 Positron tests -- more than half are invisible. The script could be fixed (e.g., matching copyright headers), but it illustrates how the inherited infrastructure wasn't designed for Positron. With Vitest, the `.vitest.ts` file extension is the natural boundary -- no grep, no guessing.

### Success Criteria

- Any developer/QA can write a Positron unit test without help within 10 minutes
- The untested Positron modules start getting coverage
- The feedback loop from code change to test result is under 5 seconds locally

---

## The Testing Pyramid

Positron's testing strategy follows a three-layer pyramid. The rule is simple: **test at the lowest layer that can catch the bug.**

```
            /\
           /  \        E2E (Playwright)
          / UI \       "Does the app work for the user?"
         /------\
        /        \     Extension Host Tests (Mocha)
       / Extension\    "Does the extension work inside VS Code?"
      /   Host     \
     /--------------\
    /                \  Vitest (Tiers 0-3)
   /  Unit + Service  \ "Does the logic work?"
  /____________________\
```

### Layer 1: Vitest (fast, no Electron)

**What it tests**: Pure functions, service logic, data transformations, state management, React components. Anything that doesn't require `import * as vscode from 'vscode'` or `import * as positron from 'positron'`.

**When to use**: This should be the DEFAULT for new Positron tests. If your code can be tested without the extension host, it belongs here.

**Feedback loop**: Instant. Watch mode re-runs on save. No build daemons, no Electron, no compilation step.

**CI cost**: ~30 seconds standalone.

**Current coverage**: 75 files, 1,005 tests across Tiers 0-3 plus extracted extension tests.

### Layer 2: Extension Host Tests (Mocha, needs Electron)

**What it tests**: Code that MUST interact with the real VS Code or Positron extension APIs -- extension activation, command registration, workspace APIs, editor document manipulation, language server integration.

**When to use**: Only when your test imports `vscode` or `positron` and genuinely needs those APIs to function. If your test imports `vscode` just to read a configuration value, consider extracting the logic so it can be tested in Vitest with the config passed as a parameter.

**Feedback loop**: 20-30 seconds (Electron startup + extension activation). Use `npm run test-extension -- -l <extension> --grep '<pattern>'` to run a single test.

**CI cost**: 60-second timeout per extension, run sequentially.

**Current coverage**: ~50 files across 7 Positron extensions.

**Known issue**: ~10-12 files in positron-assistant and positron-r are pure logic tests that don't actually need the extension host. These should be extracted down to Vitest (see Next Steps).

### Layer 3: E2E (Playwright, full application)

**What it tests**: User-visible workflows that span multiple systems -- opening a file, running code in the console, viewing plots, navigating the data explorer. Tests the whole application as a user would use it.

**When to use**: When you need to verify that the pieces work TOGETHER from the user's perspective. Not for testing individual functions or service logic.

**Feedback loop**: Minutes (full app startup, test execution, teardown).

**CI cost**: Minutes per suite, with sharding.

**Current coverage**: 170 files across test/e2e/.

### The Decision Tree

```
"I need to write a test for X"
    |
    v
Does your code import 'vscode' or 'positron' APIs?
    |
    +-- No --> Vitest (Layer 1)
    |
    +-- Yes --> Does it NEED those APIs, or just use them for convenience?
                    |
                    +-- Convenience (e.g., reading config) --> Extract the logic, test in Vitest
                    |
                    +-- Genuinely needs them --> Extension Host Test (Layer 2)
                                                    |
                                                    v
                                          Is this testing a user-visible workflow?
                                                    |
                                                    +-- No --> Extension Host Test (Layer 2)
                                                    +-- Yes --> E2E (Layer 3)
```

### Why This Matters

Tests at the wrong layer are either too slow or too shallow:

| Anti-pattern | Problem | Fix |
|---|---|---|
| Pure logic tested in extension host | 20-30s startup for a 100ms test | Move to Vitest |
| Service integration tested in E2E | Flaky, slow, hard to debug | Move to Vitest Tier 2-3 |
| Extension activation tested in Vitest | Can't test -- no vscode APIs | Keep in extension host |
| UI workflow tested with unit tests | Can't catch integration bugs | Keep in E2E |

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
| CI requires Electron/xvfb/compilation | Can't fix -- Mocha runner IS Electron | ~2 min CI step, plain Node.js process |
| `suite/test` TDD style | Stuck | `describe/it` -- industry standard, team already knows it |

### Why not replace upstream VS Code tests too?

Positron merges upstream VS Code roughly every month (1.106, 1.107, 1.108, 1.109...). Modifying 814 upstream test files would cause hundreds of merge conflicts on every upstream merge. We already see this cost: 18 upstream test files currently have `// --- Start Positron ---` markers where we had to modify constructor args, stub Positron services, or change expected values. Each of those is a merge conflict waiting to happen. The fork boundary is the natural framework boundary:

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

### Developer Workflow: Before vs. After

**Before (Mocha):**
```
1. npm run build-start              # start build daemons (30-60s first time)
2. Edit code
3. npm run build-check              # wait for recompilation (blocks)
4. ./scripts/test.sh --run src/path/to/file.test.ts
5. Read results, go back to step 2
```
Every iteration requires step 3 (wait for daemon) and step 4 (manual re-run).

**After (Vitest):**
```
1. npm run test-vitest              # starts watch mode (one-time)
2. Edit code
3. Results appear automatically on save
```
Step 1 is once per session. From then on, every save triggers an instant re-run of affected tests. No build daemons, no manual commands, no waiting.

**When you need both:** Vitest covers Positron-specific tests. The 814 upstream VS Code tests still run on Mocha via the build daemon + Electron pipeline. Most Positron changes don't affect upstream tests, so `npm run test-vitest` is sufficient for day-to-day work. But if you're changing a shared interface, modifying test infrastructure, or adding a dependency to an upstream class, you should also run the upstream tests:

```
npm run build-start && npm run build-check && ./scripts/test.sh
```

CI always runs both, so upstream regressions are caught even if you skip this locally.

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
- **Extension tests** -- `npm run test-extension` pipeline unchanged (for now -- see Next Steps)
- **Build system** -- build daemons, compilation, packaging unchanged
- **`scripts/test.sh`** -- continues running upstream Mocha tests

---

## Verification

1. `npm run test-vitest` -- watch mode, all `.vitest.ts` files run on save
2. `npm run test-vitest:run` -- single CI run, all tests pass
3. `./scripts/test.sh` -- upstream Mocha tests still pass (no regression)
4. Each migration phase validated: migrated tests produce same pass/fail results
5. CI workflow runs Vitest step successfully alongside existing pipeline

---

## Next Steps

The Vitest migration (Layer 1 of the pyramid) is complete. These are the next moves to improve the full testing experience, in priority order:

### 1. Extract pure logic extension tests to Vitest (done)

8 extension test files were migrated from the Electron extension host to Vitest:
- positron-assistant: snowflake, autoconfiguredProviders, openai-fetch-utils, anthropicVercel, awsBedrock, notebookContextFilter (6 files)
- positron-r: hyperlink, rversions (2 files)

Some tests had no direct `vscode`/`positron` imports but their source modules had transitive dependencies -- handled by lightweight stubs (`src/vs/base/test/common/vscode-stub.ts`, `positron-stub.ts`). Three files that directly imported `positron` (anthropicVercel, awsBedrock, notebookContextFilter) were audited and found to only use enum values already available in the stub.

**Current totals**: 75 test files, 1,005 tests passing in Vitest (~55 seconds, no Electron).

### 2. Testing pyramid decision tree in CLAUDE.md (done)

A condensed "Where should I put my test?" decision tree has been added to the Testing section of CLAUDE.md. It directs developers to Vitest by default, extension host tests only when `vscode`/`positron` APIs are genuinely needed, and E2E for user-visible workflows.

### 3. Create extension test documentation (done)

CLAUDE.md files created for 3 Positron extensions with test guidance:
- `extensions/positron-assistant/CLAUDE.md` -- 6 Vitest + 20 extension host tests, decision tree for new tests
- `extensions/positron-r/CLAUDE.md` -- 2 Vitest + 8 extension host tests, troubleshooting for R discovery
- `extensions/positron-code-cells/CLAUDE.md` -- 6 extension host tests, guidance for future Vitest extraction

Each doc covers: how to run tests, which are Vitest vs extension host, how to add a new test, and how to run a single test.

### 4. Audit extension tests that import `vscode` for convenience (done)

The 3 files that imported `positron` (anthropicVercel, awsBedrock, notebookContextFilter) were audited. All 3 only used enum values (`PositronLanguageModelType.Chat`, `notebooks.NotebookCellType.Code`) that the positron stub already provides. They were migrated to Vitest successfully.

Future extension tests that import `vscode` for convenience (e.g., reading config via `vscode.workspace.getConfiguration()`) can follow the same pattern: add the needed API to the stub, or extract the logic so config is passed as a parameter.

---

## Coverage Gaps

The largest Positron modules with zero unit tests, ranked by source file count:

| Module | Source Files | New Mocks Needed | Notes |
|--------|-------------|-----------------|-------|
| positronDataExplorer (service) | 35 | 0 | All deps already mocked. Has existing cache-layer tests. Best place to start. |
| positronConsole (service) | 27 | 2 | Needs ExecutionHistoryService, RuntimeStartupService mocks |
| positronVariables (contrib/UI) | 21 | 0 | All deps already mocked. Mainly UI wiring and actions. |
| positronPreview | 19 | 1 | Needs NotebookOutputWebviewService mock |
| positronVariables (service) | 12 | 2 | Needs RuntimeNotebookKernelService, QuartoExecutionManager mocks |
| positronPackages | 12 | Not audited | |
| positronLayout (service) | 12 | Not audited | |
| positronPlots (service) | 11 | Not audited | |
| positronHistory (contrib) | 9 | Not audited | |
| positronHelp | 8 | Not audited | |

The existing `positronWorkbenchInstantiationService()` (wrapped by our builder's `.withWorkbenchServices()`) already stubs 124+ services. Most untested modules can be tested with what exists today -- only 5 new mocks total are needed across the top 5 modules.

**Recommended starting point**: positronDataExplorer (35 files, 0 new mocks, existing test helpers already in Vitest).

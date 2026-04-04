# Proposal: Vitest for Positron Unit Tests

> **Full design spec**: [docs/superpowers/specs/2026-04-03-vitest-migration-design.md](superpowers/specs/2026-04-03-vitest-migration-design.md)

## Why Are We Doing This?

We have a coverage problem, and it's not because people don't want to write tests. It's because writing a Positron unit test is unreasonably hard.

**20 Positron contrib modules have zero unit tests. 14 Positron extensions have zero unit tests.** Teams default to E2E tests -- which are slow and expensive in CI -- because unit tests require too much framework knowledge and too much setup.

When we replaced VS Code's mocha/playwright e2e infrastructure with our own Playwright setup, it was the best move we ever made. This proposal applies the same thinking to unit tests: stop fighting inherited infrastructure that doesn't serve us, and build something that does.

### What success looks like

1. **Any developer -- including QA -- can write a Positron unit test without help within 30 minutes**
2. The untested Positron modules start getting coverage
3. The feedback loop from code change to test result is under 5 seconds locally

---

## The Problem in Detail

### Writing a test requires deep framework knowledge

To test a Positron service today, you need to understand:
- VS Code's dependency injection system (`TestInstantiationService`, `stub()`, `createInstance()`)
- Which of 124+ service stubs to wire up (spread across ~2,500 lines of boilerplate in 3 files)
- The disposable lifecycle pattern (`ensureNoDisposablesAreLeakedInTestSuite()`)
- Mocha's TDD API (`suite`, `test`, `setup`, `teardown`)
- Sinon for mocking where events don't suffice

The result: **40-60% of every test file is setup code.** A 3-line assertion rides on top of 30+ lines of imports and service wiring.

### Running a test is slow

Tests require background build daemons to compile TypeScript to JavaScript before execution:

```
Current workflow:
  1. Ensure build daemons are running (npm run build-ps)
  2. Edit code
  3. Wait for daemon to recompile (npm run build-check -- blocks)
  4. Run test: ./scripts/test.sh --run src/path/to/test.test.ts
  5. See results, repeat from step 2
```

There is no watch mode. The first run takes 30-60 seconds for daemon startup. There's no way to make this fast -- Mocha runs against compiled JavaScript in the `out/` directory, so compilation is a hard prerequisite.

### We can't even find all our tests

The command to run Positron unit tests (`./scripts/test-positron.sh`) uses `--grep 'Positron'` to filter by suite name. But many Positron-authored test suites don't include "Positron" in their name -- `suite('ANSIOutput', ...)`, `suite('parseQuarto', ...)`, `suite('Driver Manager', ...)`, etc.

The result: **`test-positron.sh` only finds 416 of our 937 tests.** More than half of Positron's unit tests are invisible to the tool meant to run them. There's no reliable way to run "all Positron tests" in the current infrastructure without knowing which files have the Posit copyright header.

With Vitest, this is solved by file extension: `*.vitest.ts` = Positron test. `npm run test-vitest:run` runs all 937 -- no grep, no guessing.

### CI is expensive

The unit test CI job has a 40-minute timeout. It downloads Electron, installs a virtual display server (xvfb), compiles the entire project, installs Playwright browsers, and sets up R -- all before a single test runs. Positron's 67 test files ride along in a pipeline built for 814 upstream VS Code tests.

---

## What Are We Actually Testing?

### Positron is 93% pure TypeScript, 7% React

| File Type | Count | Percentage | Description |
|-----------|-------|------------|-------------|
| `.ts` (TypeScript) | 4,597 | 93% | Services, runtime communication, business logic |
| `.tsx` (React) | 360 | 7% | UI components for Console, Variables, Plots, etc. |

VS Code uses **zero React**. Positron adds React selectively for interactive panels. The service layer -- where most testable business logic lives -- is overwhelmingly pure TypeScript.

| Positron Area | .tsx (React) | .ts (Non-React) | React % |
|---------------|-------------|-----------------|---------|
| positronConsole | 43 | 8 | 84% |
| positronVariables | 18 | 3 | 86% |
| positronNotebook | 56 | 57 | 49% |
| positronPlots | 17 | 8 | 68% |
| positronConnections | 12 | 1 | 92% |
| **All Positron services** | **18** | **106** | **15%** |

### The 67 existing Positron tests, by complexity

We audited every Positron-specific test file and categorized them by how much infrastructure they require:

| Tier | Files | What It Means | Existing Example |
|------|-------|--------------|------------------|
| **Tier 0 -- Pure Logic** | 20 | No DI. Import function, call it, assert. | `positronVersions.test.ts` -- version string comparison |
| **Tier 1 -- Light DI** | 17 | 1-5 manual service stubs | `languageRuntime.test.ts` -- 2 stubs (Log, Config) |
| **Tier 2 -- Runtime Services** | 8 | 18 pre-configured service stubs | `runtimeSession.test.ts` -- session lifecycle |
| **Tier 3 -- Full Workbench** | 16 | 124+ service stubs | `positronVariablesService.test.ts` -- notebook-integrated variables |
| **React/DOM** | 12 | React components with DOM queries | `CellTextOutput.test.tsx` -- output rendering |

> 6 files overlap between tiers. 67 unique files total. 55 are pure TypeScript, 12 are React.

### The boilerplate that makes this hard

The mock complexity lives in three files totaling ~2,500 lines:

| File | Lines | Service Stubs |
|------|-------|--------------|
| `workbenchTestServices.ts` | 2,146 | 81 (upstream VS Code) |
| `positronWorkbenchTestServices.ts` | 126 | 25 (Positron layer) |
| `testRuntimeSessionService.ts` | 141 | 18 (runtime/language) |
| **Total** | **~2,500** | **124** |

A "simple" test like `positronVariablesService.test.ts` (148 lines) hides its complexity behind `positronWorkbenchInstantiationService()`, which silently creates all 124+ stubs even if the test only touches one service.

---

## The Proposal: Vitest + Builder Pattern

### Why Vitest?

Vitest is built on Vite's transform pipeline. It uses **esbuild** to transpile TypeScript on the fly (~100x faster than `tsc`). This is the core value -- and it benefits **all** TypeScript equally, not just the 7% that is React.

| Pain Point | Can Mocha Fix It? | Vitest |
|---|---|---|
| Build daemon required before tests run | No -- Mocha runs compiled JS | **Eliminated** -- esbuild transpiles directly, no `out/` directory |
| No watch mode | No -- daemon must recompile first | **Built-in** -- HMR-based, re-runs only affected tests on save |
| 124-service mock boilerplate | Partially (could add builder) | **Builder + `vi.mock()`** for module-level mocking |
| 40-min CI pipeline | No -- Mocha runner IS Electron | **~30s CI step** -- plain Node.js, no Electron/xvfb/compilation |
| `suite/test` TDD style | Stuck | **`describe/it`** -- team already knows this from other projects |

### The developer experience change

**Before:**
```
1. Ensure build daemons are running
2. Edit code
3. Wait for recompilation
4. Run test
5. Repeat
```

**After:**
```
1. Run once: npm run test-vitest    (starts watch mode)
2. Edit code
3. Test re-runs instantly on save
4. Repeat
```

### The builder pattern: making tests accessible to everyone

The `PositronTestContainer` hides the 124-service DI complexity behind tiered presets:

```typescript
// Tier 0 -- no services needed
const container = createTestContainer();

// Tier 1 -- a few specific stubs
const container = createTestContainer()
    .stub(ILogService, new NullLogService());

// Tier 2 -- runtime preset (18 services pre-wired)
const container = createTestContainer()
    .withRuntimeServices();

// Tier 3 -- full workbench (124+ services pre-wired)
const container = createTestContainer()
    .withWorkbenchServices();

// Always: .build() returns what you need
const { get, disposables } = container.build();
const myService = get(IPositronVariablesService);
```

Each tier includes the one below it. Override any service after a preset with `.stub()`. The builder delegates to the existing infrastructure -- no logic reimplemented, no divergence from Mocha tests.

### Before and after: a real test

**Before (Mocha -- current):**
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

**After (Vitest -- proposed):**
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

## "But won't two test frameworks be confusing?"

This is the right question to ask. Here's why it's manageable:

**The boundary is the fork boundary.** If your code is Positron-specific (has "positron" in the path or the Posit copyright header), it uses Vitest. If it's upstream VS Code, it uses Mocha. Same rule we already follow for everything else in this fork.

**We can't replace upstream tests.** Positron merges upstream VS Code roughly every month (1.106, 1.107, 1.108, 1.109...). If we modified the 814 upstream test files, every merge would produce hundreds of conflicts. The fork boundary has to be the framework boundary.

**We already run multiple test frameworks.** Today we have Mocha (unit tests), Mocha (extension tests), and Playwright (e2e). Adding Vitest replaces one Mocha usage, not adds a fourth.

**The actual overhead is small:**

| Concern | Reality |
|---------|---------|
| "Which framework do I use?" | Positron code = Vitest. Upstream = Mocha. Same rule as everything else. |
| "Two configs to maintain?" | `vitest.config.ts` is ~20 lines. |
| "Two CI steps?" | Vitest adds ~30 seconds. |
| "Will people context-switch?" | Most devs work in either Positron or upstream code, not both in one PR. |

---

## Migration: All 67 Files

67 tests is not many. We migrate all of them to establish the pattern and set the precedent for new tests.

### Electron dependency audit

We audited every Positron test file for Electron API usage. **Zero files directly import Electron APIs.** All 67 can migrate.

### Migration by phase

| Phase | Files | Tier | Approach |
|-------|-------|------|----------|
| 1 | 20 | Tier 0 (pure logic) | Mechanical rename -- could be partially scripted |
| 2 | 17 | Tier 1 (light DI) | Mechanical + swap stubs to builder `.stub()` calls |
| 3 | 8 | Tier 2 (runtime) | Use `.withRuntimeServices()` preset |
| 4 | 16 | Tier 3 (workbench) | Use `.withWorkbenchServices()` preset |
| 5 | 12 | React/DOM | Adopt `@testing-library/react` where beneficial |

After migration, the original `.test.ts` files are deleted. No stale copies.

---

## CI Impact

### Current: Positron tests embedded in a 40-minute pipeline

```
1. Install Node deps
2. Download Electron binary
3. Install Playwright browsers
4. Compile the entire project          <-- the expensive step
5. Download R and install packages
6. Configure xvfb
7. Run all unit tests (814 upstream + 67 Positron)
```

### Proposed: Vitest runs first, in ~30 seconds

```
1. Install Node deps
2. Run Vitest (Positron)               <-- ~30s, needs nothing else
3. Download Electron
4. ... rest unchanged (upstream Mocha tests) ...
```

A broken Positron test reports in ~30 seconds instead of 20+ minutes. The step can run in parallel with compilation or as an early-exit gate.

---

## Technical Feasibility (Verified)

Every constraint was checked against the actual codebase:

| Constraint | Status | Details |
|-----------|--------|---------|
| Module system (ESM) | Compatible | Codebase uses `import`/`export`. Vitest is ESM-native. |
| `.js` extensions in TS imports | Compatible | esbuild resolves `.js` to `.ts` with `nodenext` resolution. |
| `experimentalDecorators` | Compatible | Already enabled in `src/tsconfig.base.json`. esbuild supports it. |
| React JSX | Compatible | `jsx: "react-jsx"` already configured. |
| Sinon mocking library | Compatible | Regular npm dep, not Mocha-coupled. Works in Vitest. |
| `TestInstantiationService` | Compatible | Uses Sinon internally. No Mocha dependency. |
| TypeScript type conflicts | Solved | Separate `tsconfig.vitest.json` with `vitest/globals` types. |
| Test file collision | Solved | `.vitest.ts` vs `.test.ts` -- zero overlap. |

---

## What This Does NOT Change

- **Upstream VS Code tests** -- all 814 files stay on Mocha, untouched
- **E2E tests** -- Playwright infrastructure unaffected
- **Extension tests** -- `npm run test-extension` pipeline unchanged
- **Build system** -- daemons, compilation, packaging unchanged
- **`scripts/test.sh`** -- continues running upstream Mocha tests

---

## Rollout Plan

| Phase | What | When |
|-------|------|------|
| **Foundation** | `vitest.config.ts`, `tsconfig.vitest.json`, `PositronTestContainer` builder, npm scripts | Week 1-2 |
| **Proof of Concept** | Migrate 3-5 tests across all tiers, validate end-to-end | Week 2-3 |
| **CI Integration** | Add Vitest step to `test-unit.yml` | Week 3 |
| **Full Migration** | Migrate remaining 62 tests, delete Mocha originals | Week 3-4 |
| **Documentation** | Update `CLAUDE.md`, developer testing guide | Week 4 |

---

## Summary

| | Current | Proposed |
|---|---|---|
| Framework for Positron tests | Mocha (2011), inside Electron | Vitest (2022), plain Node.js |
| Feedback loop | 30-60s (build daemon + Electron) | Instant (watch mode) |
| CI time for Positron tests | Embedded in 40-min pipeline | ~30 seconds standalone |
| Boilerplate per test | 40-60% setup code | Minimal (builder pattern) |
| Mocking | Sinon + 2,500 lines of manual stubs | `vi.mock()` + tiered builder presets |
| Can QA write tests? | Requires deep framework knowledge | Yes -- pick a tier, write assertions |
| React component testing | Raw DOM queries | `@testing-library/react` |
| Migration scope | 67 files, all eligible, zero Electron blockers | Full migration, phased by tier |
| Risk to upstream | None | None -- completely separate pipeline |

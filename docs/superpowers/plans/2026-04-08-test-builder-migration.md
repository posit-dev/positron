# Test Builder Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 47 Positron test files to use `createTestContainer()`, eliminating manual setup patterns.

**Architecture:** Three batches by complexity: disposables-only (36 files, trivial find-replace), createRuntimeServices (4 files, swap to `.withRuntimeServices()`), positronWorkbenchInstantiationService (7 files, swap to `.withWorkbenchServices()` or `.withNotebookServices()` + `.stub()`). Each batch is tested before moving to the next. Command/docs updated last.

**Tech Stack:** TypeScript, Mocha test framework, existing `positronTestContainer.ts` builder

**Design spec:** `docs/superpowers/specs/2026-04-08-test-builder-migration-design.md`

**Note on parameterized preset:** The design spec proposed a parameterized `.withNotebookServices(document?)`. Investigation revealed the notebook document depends on the instantiation service created in `setup()`, so it can't be a build-time param. The 3 notebook kernel files will use `.withNotebookServices()` + `ctx.instantiationService.stub(INotebookService, ...)` in `setup()` instead.

---

### Task 1: Migrate disposables-only files (batch 1 of 3)

**Files (36):**
- Modify: `src/vs/workbench/api/test/browser/positron/mainThreadPositronEphemeralStorage.test.ts`
- Modify: `src/vs/workbench/api/test/common/positron/extHostPositronEphemeralStorage.test.ts`
- Modify: `src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.test.ts`
- Modify: `src/vs/workbench/contrib/notebook/test/browser/positronNotebookCommandPalette.test.ts`
- Modify: `src/vs/workbench/contrib/positronAssistant/test/browser/languageModelSessionSync.test.ts`
- Modify: `src/vs/workbench/contrib/positronConsole/test/common/linkDetector.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronNotebookFind.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/copyImageUtils.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/notebookOutputUtils.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookCell.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookCellOutputs.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookConfigurationHandling.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookEditorResolution.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookInstance.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookOutline.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookSplitJoin.test.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.test.ts`
- Modify: `src/vs/workbench/contrib/positronPathUtils/test/browser/filePathConverter.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuarto/test/browser/quartoCellToolbar.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuarto/test/browser/quartoDocumentModel.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuarto/test/browser/quartoExecutionManager.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuarto/test/browser/quartoOutputManager.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuarto/test/common/quartoExecutionOptions.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuarto/test/common/quartoParser.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuartoNotebook/test/common/notebookToQmd.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuartoNotebook/test/common/qmdToNotebook.test.ts`
- Modify: `src/vs/workbench/contrib/positronQuartoNotebook/test/common/quartoNotebookRoundTrip.test.ts`
- Modify: `src/vs/workbench/contrib/positronWelcome/test/browser/helpers.test.ts`
- Modify: `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.test.ts`
- Modify: `src/vs/workbench/services/languageRuntime/test/common/languageRuntime.test.ts`
- Modify: `src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.test.ts`
- Modify: `src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.test.ts`
- Modify: `src/vs/workbench/services/positronDataExplorer/test/common/positronDataExplorerInternals.test.ts`
- Modify: `src/vs/workbench/services/positronDataExplorer/test/common/positronDataExplorerMocks.test.ts`
- Modify: `src/vs/workbench/services/positronHistory/test/common/executionHistoryService.test.ts`
- Modify: `src/vs/workbench/test/browser/layoutManager.test.ts`

- [ ] **Step 1: Migrate all 36 files**

For each file, make exactly two changes:

**Change 1 -- Import:** Replace:
```typescript
import { ensureNoDisposablesAreLeakedInTestSuite } from '<path>/base/test/common/utils.js';
```
With:
```typescript
import { createTestContainer } from '<path>/workbench/test/browser/positronTestContainer.js';
```
Keep the relative path depth correct for each file.

**Change 2 -- Declaration:** Replace:
```typescript
const disposables = ensureNoDisposablesAreLeakedInTestSuite();
```
With:
```typescript
const { disposables } = createTestContainer().build();
```

By destructuring `{ disposables }`, every reference to `disposables.add(...)` in the file continues to work unchanged.

**Files that also import other things from `utils.js`** (e.g., `toResource`): keep the `utils.js` import for those, only remove `ensureNoDisposablesAreLeakedInTestSuite` from it.

- [ ] **Step 2: Run tests for all 36 files**

```bash
./scripts/test.sh --runGlob '**/positron*.test.js'
```

Also run these files individually that have non-positron names:
```bash
./scripts/test.sh --run src/vs/workbench/test/browser/layoutManager.test.ts
./scripts/test.sh --run src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.test.ts
./scripts/test.sh --run src/vs/workbench/contrib/notebook/test/browser/positronNotebookCommandPalette.test.ts
./scripts/test.sh --run src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.test.ts
./scripts/test.sh --run src/vs/workbench/services/languageRuntime/test/common/languageRuntime.test.ts
./scripts/test.sh --run src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.test.ts
```

Expected: All tests pass with no changes to test logic.

- [ ] **Step 3: Commit**

```bash
git add -A src/vs/workbench/
git commit -m "Migrate 36 disposables-only test files to createTestContainer()"
```

---

### Task 2: Migrate createRuntimeServices files (batch 2 of 3)

**Files (4):**
- Modify: `src/vs/workbench/contrib/positronAssistant/test/browser/positronAssistantService.test.ts`
- Modify: `src/vs/workbench/services/positronConnections/test/positronConnectionsService.test.ts`
- Modify: `src/vs/workbench/services/runtimeSession/test/common/runtimeSession.test.ts`
- Modify: `src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.test.ts`

- [ ] **Step 1: Migrate each file**

For each file, the pattern is:

**Before:**
```typescript
import { ensureNoDisposablesAreLeakedInTestSuite } from '<path>/utils.js';
import { TestInstantiationService } from '<path>/instantiationServiceMock.js';
import { ServiceCollection } from '<path>/serviceCollection.js';
import { createRuntimeServices } from '<path>/testRuntimeSessionService.js';

suite('...', () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let instantiationService: TestInstantiationService;

    setup(() => {
        instantiationService = disposables.add(new TestInstantiationService(new ServiceCollection()));
        createRuntimeServices(instantiationService, disposables);
        // ...additional stubs and service access...
    });
});
```

**After:**
```typescript
import { createTestContainer } from '<path>/positronTestContainer.js';

suite('...', () => {
    const ctx = createTestContainer().withRuntimeServices().build();

    setup(() => {
        // ...additional stubs and service access using ctx.instantiationService and ctx.disposables...
    });
});
```

Key replacements in each file:
- `ensureNoDisposablesAreLeakedInTestSuite()` -> `createTestContainer().withRuntimeServices().build()`
- Remove `new TestInstantiationService(new ServiceCollection())` and `createRuntimeServices()` calls
- `instantiationService` -> `ctx.instantiationService`
- `disposables` -> `ctx.disposables`
- `instantiationService.get(IService)` -> `ctx.get(IService)`
- Remove unused imports (`TestInstantiationService`, `ServiceCollection`, `createRuntimeServices`, `ensureNoDisposablesAreLeakedInTestSuite`)

**For `runtimeSession.test.ts` specifically:** This file has 55 tests and 10+ helper functions that close over `instantiationService` and `disposables`. All helpers must be updated. The `setup()` block retains: `configService` configuration, `workspaceTrustManagementService` setup, `createTestLanguageRuntimeMetadata` calls, and session disposal cleanup. These move to use `ctx.instantiationService.get()` and `ctx.disposables`.

**For `positronAssistantService.test.ts`:** This file stubs services before calling `createRuntimeServices`. With the builder, static stubs go on `.stub()` and dynamic stubs (those depending on `ctx.instantiationService`) go in `setup()` via `ctx.instantiationService.stub()`.

- [ ] **Step 2: Run tests**

```bash
./scripts/test.sh --run src/vs/workbench/contrib/positronAssistant/test/browser/positronAssistantService.test.ts
./scripts/test.sh --run src/vs/workbench/services/positronConnections/test/positronConnectionsService.test.ts
./scripts/test.sh --run src/vs/workbench/services/runtimeSession/test/common/runtimeSession.test.ts
./scripts/test.sh --run src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A src/vs/workbench/
git commit -m "Migrate 4 createRuntimeServices test files to createTestContainer()"
```

---

### Task 3: Migrate positronWorkbenchInstantiationService files (batch 3 of 3)

**Files (7):**
- Modify: `src/vs/workbench/contrib/positronIPyWidgets/test/browser/positronIPyWidgetsService.test.ts`
- Modify: `src/vs/workbench/contrib/positronPlots/test/electron-browser/positronPlotsService.test.ts`
- Modify: `src/vs/workbench/contrib/positronWebviewPreloads/test/browser/positronWebviewPreloadService.test.ts`
- Modify: `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/notebookExecutionStatus.test.ts`
- Modify: `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernel.test.ts`
- Modify: `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernelService.test.ts`
- Modify: `src/vs/workbench/test/browser/services/positronVariablesService.test.ts`

- [ ] **Step 1: Migrate each file**

**Pattern for files using `PositronTestServiceAccessor`** (positronIPyWidgets, positronVariablesService, notebookExecutionStatus, runtimeNotebookKernelService):

**Before:**
```typescript
import { PositronTestServiceAccessor, positronWorkbenchInstantiationService } from '<path>/positronWorkbenchTestServices.js';

suite('...', () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let instantiationService: TestInstantiationService;

    setup(() => {
        instantiationService = positronWorkbenchInstantiationService(disposables);
        const accessor = instantiationService.createInstance(PositronTestServiceAccessor);
        someService = accessor.someService;
    });
});
```

**After:**
```typescript
import { createTestContainer } from '<path>/positronTestContainer.js';
import { PositronTestServiceAccessor } from '<path>/positronWorkbenchTestServices.js';

suite('...', () => {
    const ctx = createTestContainer().withWorkbenchServices().build();

    setup(() => {
        const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
        someService = accessor.someService;
    });
});
```

**Pattern for 3 notebook kernel files** (runtimeNotebookKernel, runtimeNotebookKernelService, notebookExecutionStatus):

These files create a test notebook document in `setup()` and stub `INotebookService` with it. Use `.withWorkbenchServices()` from the builder, then do the document creation and stubbing in `setup()`:

**After:**
```typescript
const ctx = createTestContainer().withWorkbenchServices().build();

setup(() => {
    // Create notebook document using the builder's instantiation service
    notebookDocument = createTestNotebookEditor(
        ctx.instantiationService,
        ctx.disposables.add(new DisposableStore()),
        [['1 + 1', 'text', CellKind.Code, [], {}]],
    ).viewModel.notebookDocument;

    // Stub INotebookService with the test document
    ctx.instantiationService.stub(INotebookService, new TestNotebookService([notebookDocument]));
    // ...rest of setup
});
```

Key replacements across all 7 files:
- `positronWorkbenchInstantiationService(disposables)` -> `createTestContainer().withWorkbenchServices().build()`
- `instantiationService` -> `ctx.instantiationService`
- `disposables` -> `ctx.disposables`
- Remove `ensureNoDisposablesAreLeakedInTestSuite` import
- Remove `positronWorkbenchInstantiationService` import (keep `PositronTestServiceAccessor` if used)

- [ ] **Step 2: Run tests**

```bash
./scripts/test.sh --run src/vs/workbench/contrib/positronIPyWidgets/test/browser/positronIPyWidgetsService.test.ts
./scripts/test.sh --run src/vs/workbench/contrib/positronPlots/test/electron-browser/positronPlotsService.test.ts
./scripts/test.sh --run src/vs/workbench/contrib/positronWebviewPreloads/test/browser/positronWebviewPreloadService.test.ts
./scripts/test.sh --run src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/notebookExecutionStatus.test.ts
./scripts/test.sh --run src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernel.test.ts
./scripts/test.sh --run src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernelService.test.ts
./scripts/test.sh --run src/vs/workbench/test/browser/services/positronVariablesService.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A src/vs/workbench/
git commit -m "Migrate 7 positronWorkbenchInstantiationService test files to createTestContainer()"
```

---

### Task 4: Update commands and documentation

**Files:**
- Modify: `.claude/commands/unit-tests-author.md`
- Modify: `.claude/commands/unit-tests-review.md`
- Modify: `.claude/rules/core-tests.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `/unit-tests-author` command**

Remove the "New test files vs extending existing files" section. Replace with a single rule:

```markdown
### Writing each test

Always use `createTestContainer()`. Every Positron test file uses the builder.
```

Remove the sentence: "Extending existing files: If the file already uses manual setup..."

- [ ] **Step 2: Update `/unit-tests-review` checklist**

In `.claude/commands/unit-tests-review.md`, simplify checklist item #2:

```markdown
### 2. Builder adoption

Is the test using `createTestContainer()`? Flag any usage of `positronWorkbenchInstantiationService()`, `createRuntimeServices()`, or raw `ensureNoDisposablesAreLeakedInTestSuite()` as a failure. All Positron tests use the builder.
```

Remove the "For extending existing files" exception.

- [ ] **Step 3: Update `.claude/rules/core-tests.md`**

In the Disposables section, remove the manual `ensureNoDisposablesAreLeakedInTestSuite()` example. Replace with:

```markdown
## Disposables

The builder handles disposable leak detection automatically. Access the disposable store via `ctx.disposables`:

\`\`\`typescript
const ctx = createTestContainer().build();
ctx.disposables.add(someDisposable);
\`\`\`
```

- [ ] **Step 4: Update `CLAUDE.md` testing section**

Remove references to manual `ensureNoDisposablesAreLeakedInTestSuite()` as a standalone pattern. The builder section already covers it.

- [ ] **Step 5: Commit**

```bash
git add .claude/ CLAUDE.md
git commit -m "Update commands and docs to reflect full builder migration"
```

---

### Task 5: Final verification

- [ ] **Step 1: Verify no manual patterns remain**

```bash
# Should return 0 Positron test files
grep -rl "ensureNoDisposablesAreLeakedInTestSuite" --include="*.test.ts" src/vs/workbench/ | while read f; do
  head -5 "$f" | grep -q "Posit Software" && echo "$f"
done | wc -l
```

Expected: `0`

```bash
# Verify no Positron tests use manual service setup
grep -rl "positronWorkbenchInstantiationService\|createRuntimeServices" --include="*.test.ts" src/vs/workbench/ | while read f; do
  head -5 "$f" | grep -q "Posit Software" && echo "$f"
done | wc -l
```

Expected: `0`

- [ ] **Step 2: Run full Positron test suite**

```bash
./scripts/test.sh
```

Expected: All tests pass, no regressions.

- [ ] **Step 3: Commit verification results**

If any fixes were needed during verification, commit them:

```bash
git add -A
git commit -m "Fix any remaining migration issues"
```

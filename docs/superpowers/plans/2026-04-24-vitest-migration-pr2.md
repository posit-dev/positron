# Vitest Migration PR2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the 19 remaining Positron-authored `*.test.ts` files under `src/vs/` to Vitest, and modernize the async `createPositronNotebookTestServices` helper onto PR1's `.withNotebookEditorServices()` preset.

**Architecture:** Each file is ported independently by creating a `*.vitest.ts` (or `*.vitest.tsx`) sibling, deleting the `*.test.ts`, and running `npx vitest run <file>` + `npx eslint <file>`. Files fall into three buckets — trivial (mechanical suite/test/assert → describe/it/expect swap), trivial+sinon (adds `sinon → vi` translation), and builder-fit (adds `createTestContainer()` swap-in). Three size-risk files (`ansiOutput`, `executionHistoryService`, `runtimeSession`) each land as their own commit to keep review tractable. The notebook helper is modernized last, once all builder presets are exercised by earlier tasks.

**Tech Stack:** Vitest, `@testing-library/react`, `@testing-library/jest-dom`, `eslint-plugin-testing-library`, Positron's `createTestContainer()` builder (`src/vs/test/vitest/positronTestContainer.ts`), presets `.withRuntimeServices()` / `.withNotebookServices()` / `.withNotebookEditorServices()` / `.withWorkbenchServices()`.

**Branch:** `mi/vitest-pr2-finish-migration`, stacked on `mi/vitest-pr1-rtl-modernize`. When PR1 merges, rebase this branch onto `main` — the PR1 commits will drop out cleanly.

---

## Resume point (as of 2026-04-24, pause)

**Branch HEAD:** `3bbcc151c8` on `mi/vitest-pr2-finish-migration`. Working tree clean.

**Completed:** Tasks 1–4 (8 files migrated across 8 commits; 3 doc/recipe-update commits).

| Task | Status | Commits |
| --- | --- | --- |
| 1. `ansiStyles` + `webviewPreloadUtils` | ✅ Done | `0e2f79140b` |
| 2. `linkDetector` + `notebookOutputWebviewServiceImpl` | ✅ Done | `618cb12dc2` |
| 3. `packagesQuery` + `provideStatementRange` | ✅ Done (+ 2 fixups) | `1a5fecd293`, `a894ec7a0a`, `60123162c5` |
| 4. `quartoExecutionOptions` + `quartoParser` | ✅ Done (+ 1 fixup) | `891256587d`, `3bbcc151c8` |

**Recipe updates committed during execution** (`2b512b7175`, `087e67bb5f`): added `assert.equal → toBe` row to recipe A; added explicit warning against the naive substring swap that produces `expect(a, b);` silent no-ops, with a grep guard.

**Next up:** Task 5 — port `src/vs/workbench/contrib/positronQuarto/test/browser/quartoKernelManager.test.ts` (265 lines, pure, own commit).

**Lessons baked into the plan/prompts:**
- Every implementer must grep for `^\s*expect\([^)]+,\s*[^)]+\);$` after editing and rewrite any match.
- Every implementer must grep for leftover `suite(` / `setup(` / `teardown(` to catch nested Mocha idioms — Vitest accepts `suite` as an alias so tests pass vacuously.
- `ensureNoLeakedDisposables()` goes at describe scope, never inside a `beforeEach`.
- Tasks 1–9 (trivial / trivial+sinon) can use haiku implementer + haiku reviewers. Builder-fit tasks (10–15) should escalate to sonnet for code quality review.

**Branch note:** this branch is stacked on the PR1 branch `mi/vitest-pr1-rtl-modernize`. Do NOT rebase onto `origin/main` while PR1 is open — a previous rebase attempt hit conflicts. Rebase once PR1 merges.

---

## Migration Recipe (reference for all tasks)

Every migration applies some subset of these translations. Each task lists which translations apply and any file-specific pitfalls.

### A. Structural (every file)

| Mocha | Vitest |
| --- | --- |
| `suite('X', () => {...})` | `describe('X', () => {...})` |
| `suite.skip(...)` / `suite.only(...)` | `describe.skip(...)` / `describe.only(...)` |
| `test('x', () => {...})` | `it('x', () => {...})` |
| `test.skip(...)` / `test.only(...)` | `it.skip(...)` / `it.only(...)` |
| `setup(() => {...})` | `beforeEach(() => {...})` |
| `teardown(() => {...})` | `afterEach(() => {...})` |
| `suiteSetup(...)` | `beforeAll(...)` |
| `suiteTeardown(...)` | `afterAll(...)` |
| `import * as assert from 'assert';` | remove (use `expect`) |
| `assert.strictEqual(a, b)` | `expect(a).toBe(b)` |
| `assert.equal(a, b)` | `expect(a).toBe(b)` for primitive values; `expect(a).toEqual(b)` if a/b could be objects |
| `assert.deepStrictEqual(a, b)` | `expect(a).toEqual(b)` |
| `assert.ok(x)` | `expect(x).toBeTruthy()` (or a more specific matcher) |
| `assert.rejects(p, /re/)` | `await expect(p).rejects.toThrow(/re/)` |
| `assert.throws(() => f(), /re/)` | `expect(() => f()).toThrow(/re/)` |

**Critical anti-pattern:** Do not do a substring swap `assert.strictEqual(` → `expect(` — that produces `expect(a, b);` which is a silent no-op (returns an assertion object, never runs a matcher, tests pass vacuously). Every translated line MUST end with a matcher call: `expect(a).toBe(b)`, not `expect(a, b)`. After editing, grep each file for `^\s*expect\([^)]+,\s*[^)]+\);$` — any match is a silent no-op and must be rewritten.

### B. File layout (every file)

- Rename `foo.test.ts` → `foo.vitest.ts` (or `.vitest.tsx` for React).
- Keep the copyright header. Add `/// <reference types="vitest/globals" />` after it.
- Indent with tabs.
- Delete the old `foo.test.ts`.

### C. Disposable leak tracking

Current Mocha form:
```ts
suite('X', () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    // ... disposables.add(...) inside tests ...
});
```

Vitest form (for **plain** tests with no builder):
```ts
import { ensureNoLeakedDisposables } from '<N slashes>/test/vitest/vitestUtils.js';

describe('X', () => {
    const disposables = ensureNoLeakedDisposables();
    // ... disposables.add(...) inside tests ...
});
```

Vitest form (for **builder** tests): the builder does this automatically — use `ctx.disposables.add(...)` and drop the `ensureNoLeakedDisposables()` call.

### D. Sinon → Vitest

| sinon | vitest |
| --- | --- |
| `import sinon from 'sinon'` | remove |
| `sinon.stub()` | `vi.fn()` |
| `sinon.stub().returns(x)` | `vi.fn().mockReturnValue(x)` |
| `sinon.stub().resolves(x)` | `vi.fn().mockResolvedValue(x)` |
| `sinon.stub().rejects(e)` | `vi.fn().mockRejectedValue(e)` |
| `sinon.spy()` | `vi.fn()` |
| `sinon.spy(obj, 'method')` | `vi.spyOn(obj, 'method')` |
| `sinon.stub(obj, 'method').returns(x)` | `vi.spyOn(obj, 'method').mockReturnValue(x)` |
| `sinon.assert.calledOnce(fn)` | `expect(fn).toHaveBeenCalledOnce()` |
| `sinon.assert.calledWith(fn, a, b)` | `expect(fn).toHaveBeenCalledWith(a, b)` |
| `sinon.assert.calledOnceWithExactly(fn, a)` | `expect(fn).toHaveBeenCalledExactlyOnceWith(a)` |
| `sinon.assert.notCalled(fn)` | `expect(fn).not.toHaveBeenCalled()` |
| `sinon.assert.called(fn)` | `expect(fn).toHaveBeenCalled()` |
| `sinon.assert.callOrder(a, b)` | `expect(a.mock.invocationCallOrder[0]).toBeLessThan(b.mock.invocationCallOrder[0])` |
| `sinon.match(/re/)` | `expect.stringMatching(/re/)` |
| `sinon.match.string` | `expect.any(String)` |
| `sinon.restore()` | remove — `restoreMocks: true` is set globally in `vitest.config.ts` |

### E. Builder swap (DI tests only)

Replace:
```ts
import { TestInstantiationService } from '<N>/platform/instantiation/test/common/instantiationServiceMock.js';
import { createRuntimeServices } from '<N>/workbench/services/runtimeSession/test/common/testRuntimeSessionService.js';

suite('X', () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let instantiationService: TestInstantiationService;

    setup(() => {
        instantiationService = disposables.add(new TestInstantiationService());
        createRuntimeServices(instantiationService, disposables);
        instantiationService.stub(IFoo, ...);
    });

    test('y', () => {
        const svc = disposables.add(instantiationService.createInstance(Svc));
        // ...
    });
});
```

With:
```ts
import { createTestContainer } from '<N>/test/vitest/positronTestContainer.js';

describe('X', () => {
    const ctx = createTestContainer()
        .withRuntimeServices()
        .stub(IFoo, ...)
        .build();

    it('y', () => {
        const svc = ctx.disposables.add(ctx.instantiationService.createInstance(Svc));
        // ...
    });
});
```

Preset choice (start low, let errors guide up):
- `.withRuntimeServices()` — runtime session + language runtime services (what `createRuntimeServices` provides).
- `.withNotebookServices()` — runtime + 8 notebook services.
- `.withNotebookEditorServices()` — workbench + editor/language/tree-sitter/webview-preload stubs for attaching `TestCodeEditor` to notebook cells.
- `.withWorkbenchServices()` — full Positron workbench (use only when a test needs `IEditorService`, `IChatWidgetService`, etc.).

### F. Run commands

After every migration:
```bash
npx vitest run <path-to-vitest-file>
npx eslint <path-to-vitest-file>
```

Both must pass before the commit.

---

## Task 1: ansiStyles.test.ts + webviewPreloadUtils.test.ts (paired trivial port)

Two tiny pure files. Paired in one commit because together they're under 70 lines.

**Files:**
- Rename: `src/vs/base/test/common/ansiStyles.test.ts` → `src/vs/base/test/common/ansiStyles.vitest.ts`
- Rename: `src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.test.ts` → `src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.vitest.ts`

- [ ] **Step 1: Rename both files**

```bash
git mv src/vs/base/test/common/ansiStyles.test.ts src/vs/base/test/common/ansiStyles.vitest.ts
git mv src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.test.ts src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B to both files**

In each file:
1. Add `/// <reference types="vitest/globals" />` after the copyright header.
2. Remove `import * as assert from 'assert';` (and any `ensureNoDisposablesAreLeakedInTestSuite` import if present).
3. Apply section A translations: `suite` → `describe`, `test` → `it`, `assert.*` → `expect().to*`.
4. If the file uses `ensureNoDisposablesAreLeakedInTestSuite`, apply section C.

- [ ] **Step 3: Run both new tests**

```bash
npx vitest run src/vs/base/test/common/ansiStyles.vitest.ts src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.vitest.ts
```

Expected: all tests pass.

- [ ] **Step 4: Lint both new files**

```bash
npx eslint src/vs/base/test/common/ansiStyles.vitest.ts src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.vitest.ts
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A src/vs/base/test/common/ansiStyles.vitest.ts src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.vitest.ts
git commit -m "test(vitest): port ansiStyles and webviewPreloadUtils to Vitest"
```

---

## Task 2: linkDetector.test.ts + notebookOutputWebviewServiceImpl.test.ts (paired trivial port)

Two more small pure files (~111 lines combined).

**Files:**
- Rename: `src/vs/workbench/contrib/positronConsole/test/common/linkDetector.test.ts` → `.vitest.ts`
- Rename: `src/vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename both files**

```bash
git mv src/vs/workbench/contrib/positronConsole/test/common/linkDetector.test.ts src/vs/workbench/contrib/positronConsole/test/common/linkDetector.vitest.ts
git mv src/vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl.test.ts src/vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B to both files**

Same mechanical translations as Task 1.

- [ ] **Step 3: Run both new tests**

```bash
npx vitest run src/vs/workbench/contrib/positronConsole/test/common/linkDetector.vitest.ts src/vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl.vitest.ts
```

Expected: all pass.

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/workbench/contrib/positronConsole/test/common/linkDetector.vitest.ts src/vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl.vitest.ts
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): port linkDetector and notebookOutputWebviewServiceImpl to Vitest"
```

---

## Task 3: packagesQuery.test.ts + provideStatementRange.test.ts (paired trivial port)

**Files:**
- Rename: `src/vs/workbench/contrib/positronPackages/test/browser/packagesQuery.test.ts` → `.vitest.ts`
- Rename: `src/vs/editor/contrib/positronStatementRange/test/browser/provideStatementRange.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename both files**

```bash
git mv src/vs/workbench/contrib/positronPackages/test/browser/packagesQuery.test.ts src/vs/workbench/contrib/positronPackages/test/browser/packagesQuery.vitest.ts
git mv src/vs/editor/contrib/positronStatementRange/test/browser/provideStatementRange.test.ts src/vs/editor/contrib/positronStatementRange/test/browser/provideStatementRange.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C**

- [ ] **Step 3: Run**

```bash
npx vitest run src/vs/workbench/contrib/positronPackages/test/browser/packagesQuery.vitest.ts src/vs/editor/contrib/positronStatementRange/test/browser/provideStatementRange.vitest.ts
```

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/workbench/contrib/positronPackages/test/browser/packagesQuery.vitest.ts src/vs/editor/contrib/positronStatementRange/test/browser/provideStatementRange.vitest.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): port packagesQuery and provideStatementRange to Vitest"
```

---

## Task 4: Quarto common tests (paired)

Two files in `positronQuarto/test/common/`, together ~582 lines but mechanically trivial.

**Files:**
- Rename: `src/vs/workbench/contrib/positronQuarto/test/common/quartoExecutionOptions.test.ts` → `.vitest.ts`
- Rename: `src/vs/workbench/contrib/positronQuarto/test/common/quartoParser.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/contrib/positronQuarto/test/common/quartoExecutionOptions.test.ts src/vs/workbench/contrib/positronQuarto/test/common/quartoExecutionOptions.vitest.ts
git mv src/vs/workbench/contrib/positronQuarto/test/common/quartoParser.test.ts src/vs/workbench/contrib/positronQuarto/test/common/quartoParser.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C**

- [ ] **Step 3: Run**

```bash
npx vitest run src/vs/workbench/contrib/positronQuarto/test/common/
```

- [ ] **Step 4: Lint**

```bash
npx eslint 'src/vs/workbench/contrib/positronQuarto/test/common/*.vitest.ts'
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): port quartoExecutionOptions and quartoParser to Vitest"
```

---

## Task 5: quartoKernelManager.test.ts

265 lines, pure, alone because it lives in `browser/` (different preset-readiness pattern from `common/`). Even though it has no DI, keeping it separate so the commit is self-contained.

**Files:**
- Rename: `src/vs/workbench/contrib/positronQuarto/test/browser/quartoKernelManager.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/contrib/positronQuarto/test/browser/quartoKernelManager.test.ts src/vs/workbench/contrib/positronQuarto/test/browser/quartoKernelManager.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C**

- [ ] **Step 3: Run**

```bash
npx vitest run src/vs/workbench/contrib/positronQuarto/test/browser/quartoKernelManager.vitest.ts
```

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/workbench/contrib/positronQuarto/test/browser/quartoKernelManager.vitest.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): port quartoKernelManager to Vitest"
```

---

## Task 6: languageRuntimeIPyWidgetClient.test.ts

222 lines, pure (despite name — no DI). Common test directory.

**Files:**
- Rename: `src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.test.ts src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C**

- [ ] **Step 3: Run**

```bash
npx vitest run src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.vitest.ts
```

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.vitest.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): port languageRuntimeIPyWidgetClient to Vitest"
```

---

## Task 7: cellEditorPrimitives.test.ts

293 lines, pure. Has nested `suite()` calls — `describe()` nests the same way.

**Files:**
- Rename: `src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.test.ts src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C**

Nested `suite()` becomes nested `describe()`. No special handling.

- [ ] **Step 3: Run**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.vitest.ts
```

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.vitest.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): port cellEditorPrimitives to Vitest"
```

---

## Task 8: ansiOutput.test.ts (size-risk — own commit)

1887 lines, pure. Mechanically trivial but voluminous. Apply recipe and verify — don't hand-audit every assertion.

**Files:**
- Rename: `src/vs/base/test/common/ansiOutput.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/base/test/common/ansiOutput.test.ts src/vs/base/test/common/ansiOutput.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C**

Use find-and-replace across the full file:
- `suite(` → `describe(`
- `test(` → `it(` (watch for `test.skip` → `it.skip` too)
- `assert.strictEqual(` → replace-and-rewrite to `expect(first).toBe(second)` (needs two-argument rewrite, not a plain substring swap; walk through each occurrence)
- `assert.deepStrictEqual(` → `expect(first).toEqual(second)`
- `assert.ok(` → `expect(` + `).toBeTruthy()` (needs inspection for negated forms)
- Remove `import * as assert from 'assert';`
- Add `/// <reference types="vitest/globals" />` after the header
- Apply section C for the disposables helper

- [ ] **Step 3: Run**

```bash
npx vitest run src/vs/base/test/common/ansiOutput.vitest.ts
```

Expected: ~200+ tests pass. If any fail, read the diff — do not paper over a real behavioral difference.

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/base/test/common/ansiOutput.vitest.ts
```

- [ ] **Step 5: Commit (own commit because of size)**

```bash
git add -A
git commit -m "test(vitest): port ansiOutput to Vitest"
```

---

## Task 9: positronActionBarWidgetRegistry.test.ts (trivial + sinon)

270 lines. No DI container, but uses sinon for one stub on a fake `IContextKeyService`. Migrate with recipe sections A + B + C + D.

**Files:**
- Rename: `src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.test.ts src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C**

Suite/test/assert → describe/it/expect. Disposable helper swap.

- [ ] **Step 3: Apply recipe section D**

Specifically:
- Remove `import sinon from 'sinon';`
- `sinon.stub().returns(true)` → `vi.fn().mockReturnValue(true)`
- `contextMatchesRulesStub: sinon.SinonStub` → `contextMatchesRulesStub: ReturnType<typeof vi.fn>` (or just `any` — the sinon type reference is the only reason it existed)
- Delete `teardown(() => sinon.restore())` — global `restoreMocks: true` handles it.

- [ ] **Step 4: Run**

```bash
npx vitest run src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.vitest.ts
```

- [ ] **Step 5: Lint**

```bash
npx eslint src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.vitest.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(vitest): port positronActionBarWidgetRegistry to Vitest"
```

---

## Task 10: languageRuntime.test.ts (smallest builder-fit — establishes recipe E pattern)

100 lines, 5 DI hits. Port first among builder-fit files because it's the simplest example of the builder swap.

**Files:**
- Rename: `src/vs/workbench/services/languageRuntime/test/common/languageRuntime.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/services/languageRuntime/test/common/languageRuntime.test.ts src/vs/workbench/services/languageRuntime/test/common/languageRuntime.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B**

- [ ] **Step 3: Apply recipe section E (builder swap)**

Exact transformation:
1. Remove imports: `TestInstantiationService`, `createRuntimeServices`, `ensureNoDisposablesAreLeakedInTestSuite`.
2. Add: `import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';`
3. Delete the `let instantiationService: TestInstantiationService;` + `setup(() => { ... })` block.
4. Add at the top of the describe:
   ```ts
   const ctx = createTestContainer()
       .withRuntimeServices()
       .build();
   ```
5. Replace every `instantiationService.createInstance(X)` with `ctx.instantiationService.createInstance(X)`.
6. Replace every `disposables.add(...)` with `ctx.disposables.add(...)`.

- [ ] **Step 4: Run**

```bash
npx vitest run src/vs/workbench/services/languageRuntime/test/common/languageRuntime.vitest.ts
```

If a "missing service" error appears, add the specific stub: `.stub(IMissing, {})` above `.build()`. Start with `{}` and let the next error drive what method to stub.

- [ ] **Step 5: Lint**

```bash
npx eslint src/vs/workbench/services/languageRuntime/test/common/languageRuntime.vitest.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(vitest): port languageRuntime service tests to Vitest"
```

---

## Task 11: runtimeStartup.test.ts

168 lines, 11 DI hits (via a helper `createCommonStubs` that stubs 6 services). Uses `isWeb ? test.skip : test` pattern.

**Files:**
- Rename: `src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.test.ts src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C + E**

Build skeleton:
```ts
describe('Positron - RuntimeStartupService Architecture Mismatch', () => {
    describe('Local sessions', () => {
        const notificationService = new MockNotificationService();
        const ctx = createTestContainer()
            .withRuntimeServices()
            .stub(INotificationService, notificationService)
            .stub(IEphemeralStateService, {
                getItem: () => Promise.resolve(undefined),
                setItem: () => Promise.resolve(),
            })
            .stub(ILifecycleService, {
                onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
                onWillShutdown: new Emitter<WillShutdownEvent>().event,
            })
            .stub(IPositronNewFolderService, {
                onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
                startupPhase: NewFolderStartupPhase.Complete,
            })
            .stub(IProgressService, {})
            .stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
            .build();

        let runtimeStartupService: RuntimeStartupService;
        beforeEach(() => {
            runtimeStartupService = ctx.disposables.add(
                ctx.instantiationService.createInstance(RuntimeStartupService)
            );
        });

        // ... tests
    });

    describe('Remote SSH sessions', () => {
        // same but with remoteAuthority: 'ssh-remote+myserver'
    });
});
```

Note: the original `createCommonStubs()` helper becomes inline `.stub()` chains on each preset. Do not keep the helper — describe-level `.stub()` captures references at `.build()` time.

- [ ] **Step 3: Apply `isWeb` skip translation**

```ts
// Mocha:
(isWeb ? test.skip : test)('name', ...)
// Vitest:
(isWeb ? it.skip : it)('name', ...)
```

- [ ] **Step 4: Run**

```bash
npx vitest run src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.vitest.ts
```

- [ ] **Step 5: Lint**

```bash
npx eslint src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.vitest.ts
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(vitest): port runtimeStartup service tests to Vitest"
```

---

## Task 12: activeRuntimeNotebookContextManager.test.ts

261 lines, 4 DI hits. Notebook-adjacent — try `.withRuntimeServices()` first; escalate to `.withNotebookServices()` only if a notebook service is actually wired.

**Files:**
- Rename: `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.test.ts` → `.vitest.ts`

Note the path uses `tests/` (plural), not `test/` — follow existing convention.

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.test.ts src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C + E**

Start with `.withRuntimeServices()`. If the test calls `createInstance(ActiveRuntimeNotebookContextManager)` and errors on a missing notebook service, escalate to `.withNotebookServices()`.

- [ ] **Step 3: Run and escalate preset if needed**

```bash
npx vitest run src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.vitest.ts
```

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.vitest.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): port activeRuntimeNotebookContextManager to Vitest"
```

---

## Task 13: chatRuntimeSessionContext.test.ts

486 lines, 6 DI hits, 8 `.stub()` calls across services. Hand-rolled `MockRuntimeSession` class stays in the file.

**Files:**
- Rename: `src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.test.ts src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C + E**

Use `.withWorkbenchServices()` — the file stubs `IEditorService`, `IChatWidgetService`, `IChatService`, which are workbench-level. Keep the 8 existing `.stub()` calls as chained calls on the builder. The `MockRuntimeSession` class definition stays verbatim.

- [ ] **Step 3: Run**

```bash
npx vitest run src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.vitest.ts
```

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.vitest.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): port chatRuntimeSessionContext to Vitest"
```

---

## Task 14: executionHistoryService.test.ts (size-risk — own commit)

1054 lines, 4 DI hits, 8 sinon usages. Apply recipe sections A + B + C + D + E. Uses `sinon.spy(storageService, 'store')` on real service instances — translates to `vi.spyOn(storageService, 'store')`.

**Files:**
- Rename: `src/vs/workbench/services/positronHistory/test/common/executionHistoryService.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/services/positronHistory/test/common/executionHistoryService.test.ts src/vs/workbench/services/positronHistory/test/common/executionHistoryService.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C + E**

Builder: `.withRuntimeServices()` + `.stub(IStorageService, new TestStorageService())` + other existing stubs. The file already uses `TestStorageService` directly — keep it as the stub value.

- [ ] **Step 3: Apply recipe section D**

Specific translations in this file:
- `sinon.spy(storageService, 'store')` → `vi.spyOn(storageService, 'store')`
- `sinon.spy(storageService, 'remove')` → `vi.spyOn(storageService, 'remove')`
- `storageSpy.calledWith(sinon.match(/positron\.executionHistory\.test-session-8/), null)` → `expect(storageSpy).toHaveBeenCalledWith(expect.stringMatching(/positron\.executionHistory\.test-session-8/), null)` — wrapped in `expect`, not inside `assert.ok`.
- `sinon.restore()` → delete (global config handles it).

- [ ] **Step 4: Run**

```bash
npx vitest run src/vs/workbench/services/positronHistory/test/common/executionHistoryService.vitest.ts
```

- [ ] **Step 5: Lint**

```bash
npx eslint src/vs/workbench/services/positronHistory/test/common/executionHistoryService.vitest.ts
```

- [ ] **Step 6: Commit (own commit because of size)**

```bash
git add -A
git commit -m "test(vitest): port executionHistoryService to Vitest"
```

---

## Task 15: runtimeSession.test.ts (size-risk — own commit, largest)

1444 lines, 5 DI hits, 41 sinon usages. Largest single item. Port last so every sinon→vi pattern is already proven by tasks 9 and 14.

**Files:**
- Rename: `src/vs/workbench/services/runtimeSession/test/common/runtimeSession.test.ts` → `.vitest.ts`

- [ ] **Step 1: Rename**

```bash
git mv src/vs/workbench/services/runtimeSession/test/common/runtimeSession.test.ts src/vs/workbench/services/runtimeSession/test/common/runtimeSession.vitest.ts
```

- [ ] **Step 2: Apply recipe sections A + B + C + E**

Builder: `.withRuntimeServices()`. Keep the `TestRuntimeSessionManager` and other test fixtures from `testRuntimeSessionService.ts` as-is.

- [ ] **Step 3: Apply recipe section D (sinon translations)**

Walk the file top-to-bottom, translating each sinon call. Three tricky patterns:

1. **Spy call-order assertions:** `sinon.assert.callOrder(willStartSession, didStartRuntime)` → `expect(willStartSession.mock.invocationCallOrder[0]).toBeLessThan(didStartRuntime.mock.invocationCallOrder[0])`.

2. **Stub-replacing a method on a real object to throw:** `sinon.stub(e.session, 'start').rejects(new Error('...'))` → `vi.spyOn(e.session, 'start').mockRejectedValue(new Error('...'))`. (Keep it inside the spy callback as before — Vitest restores automatically.)

3. **`calledOnceWithExactly`:** use the dedicated matcher `expect(fn).toHaveBeenCalledExactlyOnceWith(...)` (added in `@vitest/expect`). If tests fail on this, fall back to `expect(fn).toHaveBeenCalledOnce(); expect(fn).toHaveBeenCalledWith(...)`.

- [ ] **Step 4: Run**

```bash
npx vitest run src/vs/workbench/services/runtimeSession/test/common/runtimeSession.vitest.ts
```

If tests fail, isolate: `npx vitest run -t 'name of failing test' src/vs/workbench/services/runtimeSession/test/common/runtimeSession.vitest.ts`.

- [ ] **Step 5: Lint**

```bash
npx eslint src/vs/workbench/services/runtimeSession/test/common/runtimeSession.vitest.ts
```

- [ ] **Step 6: Commit (own commit — largest file)**

```bash
git add -A
git commit -m "test(vitest): port runtimeSession service tests to Vitest"
```

---

## Task 16: Modernize `createPositronNotebookTestServices` internals onto `.withNotebookEditorServices()`

Swap the `positronWorkbenchInstantiationService(disposables)` call (anti-pattern per `.claude/rules/vitest-tests.md`) for `createTestContainer().withNotebookEditorServices().build()`. Keep the async `createEditorPart` layer and the custom notebook service mocks.

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts`

- [ ] **Step 1: Rewrite the helper internals**

Open `src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts` and replace the helper body.

Current (abbreviated):
```ts
export async function createPositronNotebookTestServices(disposables: DisposableStore): Promise<TestServices> {
    const instantiationService = positronWorkbenchInstantiationService(disposables);
    const configurationService = new TestConfigurationService();
    instantiationService.stub(IConfigurationService, configurationService);
    const part = await createEditorPart(instantiationService, disposables);
    instantiationService.stub(IEditorGroupsService, part);
    const editorResolverService = instantiationService.createInstance(EditorResolverService);
    instantiationService.stub(IEditorResolverService, editorResolverService);
    disposables.add(editorResolverService);
    // ... INotebookService, INotebookEditorModelResolverService, INotebookKernelService,
    //     INotebookExecutionService, INotebookExecutionStateService, ICommandService,
    //     IRuntimeSessionService, IPositronNotebookService, IPositronWebviewPreloadService mocks ...
    return { instantiationService, configurationService, editorResolverService, part };
}
```

Replacement:
```ts
export async function createPositronNotebookTestServices(disposables: DisposableStore): Promise<TestServices> {
    const configurationService = new TestConfigurationService();
    const ctx = createTestContainer()
        .withNotebookEditorServices()
        .stub(IConfigurationService, configurationService)
        // Keep the mocks that testUtils uses today; they override the preset's defaults.
        .stub(INotebookService, mockNotebookService)
        .stub(INotebookEditorModelResolverService, mockModelResolverService)
        .stub(INotebookKernelService, mockKernelService)
        .stub(INotebookExecutionService, mockExecutionService)
        .stub(INotebookExecutionStateService, mockExecutionStateService)
        .stub(ICommandService, mockCommandService)
        .stub(IRuntimeSessionService, mockRuntimeSessionService)
        .stub(IPositronNotebookService, mockPositronNotebookService)
        .stub(IPositronWebviewPreloadService, mockPreloadService)
        .build();

    // Async layer: real EditorPart + EditorResolverService.
    const part = await createEditorPart(ctx.instantiationService, disposables);
    ctx.instantiationService.stub(IEditorGroupsService, part);
    const editorResolverService = ctx.instantiationService.createInstance(EditorResolverService);
    ctx.instantiationService.stub(IEditorResolverService, editorResolverService);
    disposables.add(editorResolverService);

    return {
        instantiationService: ctx.instantiationService,
        configurationService,
        editorResolverService,
        part,
    };
}
```

Define each `mockX` as a `Partial<IX>` constant above the function body — lift the existing inline mock objects out of the helper so the `.stub()` chain stays readable. Do not inline them inside `.stub()` calls.

The `disposables: DisposableStore` parameter is still needed for `createEditorPart`. Keep the signature.

- [ ] **Step 2: Update the import block**

Remove:
- `import { positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';`

Add:
- `import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';`

Keep: all existing service-identifier imports (`IConfigurationService`, `IEditorResolverService`, `INotebookService`, etc.) and `createEditorPart`.

- [ ] **Step 3: Run the two consumer tests**

```bash
npx vitest run \
    src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookEditorResolution.vitest.ts \
    src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookConfigurationHandling.vitest.ts
```

Expected: both pass.

- [ ] **Step 4: Lint**

```bash
npx eslint src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts
git commit -m "test(vitest): rewrite createPositronNotebookTestServices on withNotebookEditorServices"
```

---

## Task 17: Rename `createPositronNotebookTestServices` → `setupNotebookEditorTest` + add steering JSDoc

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts`
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookEditorResolution.vitest.ts` (consumer)
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookConfigurationHandling.vitest.ts` (consumer)

- [ ] **Step 1: Rename the export and add JSDoc**

In `testUtils.ts`, replace the function declaration:

```ts
/**
 * Sets up a notebook test with a real `EditorPart` and `EditorResolverService`.
 *
 * Use this **only when a test needs a real `EditorPart`** (typically to exercise
 * editor resolution). Most notebook tests should use
 * `createTestContainer().withNotebookEditorServices()` directly -- it's
 * synchronous and covers every notebook-editor case that doesn't depend on
 * `IEditorGroupsService` being a real instance.
 */
export async function setupNotebookEditorTest(disposables: DisposableStore): Promise<TestServices> {
    // ... body from Task 16 ...
}
```

- [ ] **Step 2: Update consumers**

In both consumer test files, replace `createPositronNotebookTestServices(` with `setupNotebookEditorTest(` (import name and call site).

```bash
grep -rln 'createPositronNotebookTestServices' src/vs
```

Expected: only `testUtils.ts` (if any bridge comment) and the two consumer tests before the rename. After the rename: zero matches.

- [ ] **Step 3: Run the two consumer tests**

```bash
npx vitest run \
    src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookEditorResolution.vitest.ts \
    src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookConfigurationHandling.vitest.ts
```

- [ ] **Step 4: Verify no stale references remain**

```bash
grep -rln 'createPositronNotebookTestServices' src/vs
```

Expected: no output.

- [ ] **Step 5: Lint all three files**

```bash
npx eslint \
    src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts \
    src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookEditorResolution.vitest.ts \
    src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookConfigurationHandling.vitest.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/
git commit -m "test(vitest): rename createPositronNotebookTestServices to setupNotebookEditorTest"
```

---

## Task 18: Evaluate colocation of `setupNotebookEditorTest` with `setupRTLRenderer`

Goal: move the helper to `src/vs/test/vitest/` if imports allow, so both test-setup helpers are colocated. If the move pulls in workbench-only types (common for `IEditorResolverService`, `IEditorGroupsService`, `createEditorPart`), keep the helper in place.

**Files:**
- Possibly: `src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts` → `src/vs/test/vitest/setupNotebookEditorTest.ts`

- [ ] **Step 1: Attempt the move**

```bash
git mv src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts src/vs/test/vitest/setupNotebookEditorTest.ts
```

- [ ] **Step 2: Fix relative imports inside the moved file**

Imports using `../` need to be rewritten for the new depth. Key paths after move:
- `createTestContainer` → `./positronTestContainer.js` (same directory)
- `createEditorPart` → `../../workbench/test/browser/workbenchTestServices.js`
- `EditorResolverService` → `../../workbench/services/editor/browser/editorResolverService.js`
- Positron-specific service identifiers → paths under `../../workbench/contrib/...` or `../../workbench/services/...`

- [ ] **Step 3: Fix consumer imports**

Both consumer test files need their import path updated:
```ts
// Before:
import { setupNotebookEditorTest } from './testUtils.js';
// After (from src/vs/workbench/contrib/positronNotebook/test/browser/ to src/vs/test/vitest/):
import { setupNotebookEditorTest } from '../../../../../test/vitest/setupNotebookEditorTest.js';
```

- [ ] **Step 4: Run the two consumer tests**

```bash
npx vitest run \
    src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookEditorResolution.vitest.ts \
    src/vs/workbench/contrib/positronNotebook/test/browser/positronNotebookConfigurationHandling.vitest.ts
```

If the move succeeds: both tests pass. Proceed to Step 5.

If the move fails with "cannot find module" or the imports pull in a tangle of workbench-only code that breaks `src/vs/test/vitest/` layering: abort the move.

- [ ] **Step 5a (move succeeded): Commit**

```bash
git add -A
git commit -m "test(vitest): colocate setupNotebookEditorTest with other test-setup helpers"
```

- [ ] **Step 5b (move aborted): Revert and document**

```bash
git checkout HEAD -- src/vs/test/vitest/setupNotebookEditorTest.ts
git mv src/vs/test/vitest/setupNotebookEditorTest.ts src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts
```

Then add a one-line pointer comment above the function in `testUtils.ts`:
```ts
// This helper lives in the notebook test directory because it depends on
// IEditorResolverService/IEditorGroupsService which pull in workbench layers
// unavailable to src/vs/test/vitest/.
```

Commit the no-op (if git shows changes after the move+revert):
```bash
git add -A
git commit --allow-empty -m "test(vitest): document why setupNotebookEditorTest stays in-tree"
```

---

## Task 19: Clean up grandfathered lint disables from PR1

PR1 promoted `local/code-no-any-casts` and the selector-family `no-restricted-syntax` rules to `error` for `.vitest.*` files, and landed line-scoped `eslint-disable-next-line` comments on 10 pre-existing violations with a "deferred to follow-up cleanup PR" justification. This task does those real fixes and removes the disables.

**Files + sites (each disable carries a comment starting with "deferred to follow-up cleanup PR"):**

1. `src/vs/workbench/api/test/browser/positron/mainThreadPositronEphemeralStorage.vitest.ts` — 2 sites: `{ id: ..., folders: [] } as any` casting a partial `IWorkspace`. Fix: construct full `IWorkspace` stubs with all 4 fields (`id`, `folders`, `configuration`, `transient`); drop `as any` and drop the two disables.
2. `src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts` — 2 sites: `consoleContainer.querySelector('.console-instance')!` in test-setup code that builds a fake console container. Fix: change `createConsoleDOM` to return `{ container, instance }` so the test keeps a direct reference to the inner `.console-instance` element instead of re-querying via selector; drop both disables.
3. `src/vs/workbench/contrib/positronPlots/test/electron-browser/positronPlotsService.vitest.ts` — 1 site: `(plotInstance as any)._commProxy` reaches into a private field to inject stub comms. Fix: add a test-only hook in `PlotClientInstance` source (`setCommProxyForTesting(proxy)` or similar `@internal` method), call that from the test instead; drop the disable.
4. `src/vs/workbench/contrib/positronWebviewPreloads/browser/positronWebviewPreloadService.vitest.ts` — 3 sites: stub factories returning object literals `as any` because they implement `Partial<IPositronNotebookInstance>` / `Partial<IPositronNotebookOutputWebviewService>` / access a union-typed `result.webview` field. Fix: use `satisfies Partial<...>` where possible (2 sites) and narrow `addNotebookOutput`'s union return via a type guard (1 site); drop all three disables.
5. `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/notebookExecutionStatus.vitest.ts` — 1 site: `{ affectsConfiguration: () => true } as any` is a partial `IConfigurationChangeEvent`. Fix: construct a full stub with `source: ConfigurationTarget.USER`, `affectedKeys: new Set()`, `change: { keys: [], overrides: [] }`, and `affectsConfiguration: () => true`; drop the disable.
6. `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/runtimeNotebookKernelService.vitest.ts` — 1 site: `(notebookDocument.metadata.metadata as any).language_info.name` reads Jupyter notebook metadata shape that is loosely typed. Fix: define a local `NotebookLanguageInfo` interface (`{ language_info: { name: string } }`) and cast to that; drop the disable.

- [ ] **Step 1: Find all grandfathered disables**

```bash
grep -rnE "eslint-disable-next-line.*-- .*deferred to follow-up cleanup PR" src/vs --include='*.vitest.ts' --include='*.vitest.tsx'
```

Expected: 10 hits across the 6 files above. This is the worklist.

- [ ] **Step 2: Fix each site**

Work through the 6 files in the order listed above. For each:
1. Rewrite the cast/querySelector per the fix description.
2. Delete the `eslint-disable-next-line` comment.
3. Run `npx vitest run <file>` to confirm the test still passes.
4. Run `npx eslint --max-warnings 0 <file>` to confirm no regression.

The type-stub expansions (1, 5) need to verify interface shapes against the current source; check imports in the source file before writing the stub. The test-only hook (3) needs a small source change in `PlotClientInstance`.

- [ ] **Step 3: Confirm all disables are gone**

```bash
grep -rnE "eslint-disable-next-line.*-- .*deferred to follow-up cleanup PR" src/vs --include='*.vitest.ts' --include='*.vitest.tsx'
```

Expected: no output.

- [ ] **Step 4: Full suite + lint**

```bash
npm run test:positron
npx eslint 'src/vs/**/*.vitest.ts' 'src/vs/**/*.vitest.tsx'
```

Expected: all tests pass; 0 errors on lint.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(vitest): replace grandfathered lint disables with proper fixes

Clears the 10 line-scoped eslint-disable-next-line comments that PR1
left in place with a 'deferred to follow-up cleanup PR' justification.
Each site was rewritten with a typed stub, typed narrowing, or a
test-only source hook so the assertion reads cleanly without the
disable."
```

---

## Task 20: Swap PR1's testids for accessibility-first queries where it fits

PR1 added a handful of `data-testid`s to source components under time pressure (see Nathan's review on #13165). Testid is supposed to be last resort in the RTL query ladder; for several of these the component can be made more accessible instead, which is both a better testing handle AND a real a11y improvement.

**Sites to revisit:**

1. **`PositronFindWidget.tsx`** — has `data-testid='positron-find-widget'` on the root and `data-testid='positron-find-widget-results'` on the match-count div.
   - Root: add `role='search'` + `aria-label` (localized). Tests query via `screen.getByRole('search', { name: /Find/ })`.
   - Results div: add `role='status'`. Match-count counters are the textbook use of the `status` live region. Tests query via `screen.getByRole('status')`.
   - Drop both testids once tests migrate.

2. **`topActionBarSessionManager.tsx`** — has `data-testid='session-manager-label'` and `data-testid='session-manager-icon'`. The parent button already has `ariaLabel={CommandCenter.title(command)}`.
   - Label assertions switch to `getByRole('button', { name: ... })` + `toHaveTextContent(...)` or `within(button).getByText(...)`.
   - Icon assertions: audit whether specific-class checks (e.g. `python-lang-file-icon`) are genuine behavior or over-specifying. Keep the ones that are real state transitions (arrow-swap ↔ runtime-session-icon); drop the ones that just echo the test fixture.
   - Drop both testids once tests migrate.

3. **`CellActionButton.tsx`** (+ `DevErrorIcon`, `Icon` in `src/vs/platform/positronActionBar/browser/components/icon.tsx`) — passes `data-testid='cell-action-button-icon'` through to the Icon components. The button already has `ariaLabel={action.label}`.
   - Audit the 4 `getByTestId('cell-action-button-icon')` sites in `CellActionButton.vitest.tsx`:
     - "icon exists at all" → drop, button role+label covers it.
     - "icon becomes `codicon-check` momentarily after success" → keep (real behavior). Query via `within(button).querySelector('.codicon')` with a scoped `// eslint-disable-next-line no-restricted-syntax --` and a comment naming the constraint.
     - "icon is `codicon-chevron-down` because fixture passed iconId='chevron-down'" → drop, that's testing the fixture.
   - Remove the `data-testid` prop from `CellActionButton.tsx`, and revert the `data-testid` addition on `Icon` / `DevErrorIcon` — the prop was added specifically for this test and should go away with it.

**Keep:**

- **`positron-modal-overlay`** on `PositronModalReactRenderer.tsx`. The overlay is a structural click-catcher with no user-facing affordance; no accessible role applies.

- [ ] **Step 1: PositronFindWidget — biggest accessibility win**

Edit `src/vs/workbench/contrib/positronNotebook/browser/contrib/find/PositronFindWidget.tsx`:
- Replace `data-testid='positron-find-widget'` with `role='search' aria-label={findLabel}` (add `findLabel` via `localize('positronNotebook.find.label', "Find in notebook")`).
- Replace `data-testid='positron-find-widget-results'` with `role='status'` on the `.results` div.

Edit `src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx`:
- Swap `screen.getByTestId('positron-find-widget')` for `screen.getByRole('search', { name: /Find/ })`.
- Swap `screen.getByTestId('positron-find-widget-results')` for `screen.getByRole('status')`.

Run `npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx`. All tests pass.

- [ ] **Step 2: Audit topActionBarSessionManager assertions**

For each test using `getByTestId('session-manager-label')`: swap to `getByRole('button', { name: ... })` + `toHaveTextContent(...)`.

For `session-manager-icon` assertions: keep the state-transition ones (no-session arrow-swap ↔ session-present runtime-session-icon). Drop the ones that just verify the test fixture's language class passed through.

Remove the two `data-testid` props from `src/vs/workbench/browser/parts/positronTopActionBar/components/topActionBarSessionManager.tsx` once the test file compiles without them.

- [ ] **Step 3: Audit CellActionButton icon assertions**

Walk the 4 `getByTestId('cell-action-button-icon')` sites per the audit rules above. Drop or migrate each.

Then remove:
- `data-testid='cell-action-button-icon'` from `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/actionBar/CellActionButton.tsx`.
- The `data-testid` prop plumbing in `src/vs/platform/positronActionBar/browser/components/icon.tsx` (`Icon`, `ThemeIcon`, `URIIcon`, `DevErrorIcon`) — it was added for this test, revert cleanly.

- [ ] **Step 4: Full suite + lint**

```bash
npm run test:positron
npx eslint --max-warnings 0 'src/vs/**/*.vitest.ts' 'src/vs/**/*.vitest.tsx'
```

Expected: all tests pass, 0 lint errors.

- [ ] **Step 5: Update `vitest-rtl.md`** if the steps reveal a pattern worth codifying. Concrete candidate: add "live-region match-count displays use `role='status'`" as an explicit example in the query priority section. Otherwise skip.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test(vitest): prefer accessibility-first queries over testids from PR1

Replaces data-testid additions made under PR1 time pressure with roles
that make the components more accessible and queryable via getByRole:
role='search' on the find widget, role='status' on the match-count
live region, and button aria-label for session manager and cell action
button assertions. The modal overlay's testid stays - it has no
user-facing handle to make accessible.

Context: https://github.com/posit-dev/positron/pull/13165#pullrequestreview-<N>
EOF
)"
```

---

## Task 21: Full verification

- [ ] **Step 1: Verify no Positron `.test.ts` files remain in src/vs/**

```bash
find src/vs -name "*.test.ts" -not -path "*/node_modules/*" -exec grep -l "Posit Software" {} \;
```

Expected: no output.

- [ ] **Step 2: Run the full Vitest suite**

```bash
npm run test:positron
```

Expected: all tests pass, no stale `.test.ts` references, no missed files.

- [ ] **Step 3: Lint the entire Vitest surface**

```bash
npx eslint 'src/vs/**/*.vitest.ts' 'src/vs/**/*.vitest.tsx'
```

Expected: no errors.

- [ ] **Step 4: Confirm commit boundaries**

```bash
git log --oneline origin/main..HEAD
```

Expected: the three size-risk files (`ansiOutput`, `executionHistoryService`, `runtimeSession`) each have their own commit. Small files are grouped 2-3 per commit. The helper modernization, rename, and (possible) move are separate commits.

---

## Self-review notes

Spec coverage verified:
- 12 trivial files → Tasks 1–8 (`ansiStyles`, `webviewPreloadUtils`, `linkDetector`, `notebookOutputWebviewServiceImpl`, `packagesQuery`, `provideStatementRange`, `quartoExecutionOptions`, `quartoParser`, `quartoKernelManager`, `languageRuntimeIPyWidgetClient`, `cellEditorPrimitives`, `ansiOutput`).
- 1 trivial+sinon file → Task 9 (`positronActionBarWidgetRegistry`).
- 6 builder-fit files → Tasks 10–15 (`languageRuntime`, `runtimeStartup`, `activeRuntimeNotebookContextManager`, `chatRuntimeSessionContext`, `executionHistoryService`, `runtimeSession`).
- Size-risk files each in own commit: `ansiOutput` (Task 8), `executionHistoryService` (Task 14), `runtimeSession` (Task 15).
- Helper polish: Task 16 (modernize), Task 17 (rename + JSDoc), Task 18 (evaluate colocation).
- Full verification: Task 19 (spec success criteria 1, 3, 4).

Spec success criterion 5 (docs decision-table unchanged) is met implicitly — the plan does not touch `.claude/rules/vitest-tests.md`. Only update it if Task 18's colocation succeeds and the `setupNotebookEditorTest` path needs documenting in the "Where should I put my test?" table.

Type consistency: `setupNotebookEditorTest` is the name used in Tasks 16–18. `.withRuntimeServices()`, `.withNotebookServices()`, `.withNotebookEditorServices()`, `.withWorkbenchServices()` are the preset methods, consistent throughout. `ctx.instantiationService`, `ctx.disposables`, `ctx.reactServices` are the builder fields, consistent throughout.

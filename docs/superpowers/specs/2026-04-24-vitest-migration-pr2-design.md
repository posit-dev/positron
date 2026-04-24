# Vitest Migration PR2 — Design

**Goal:** Finish the Mocha→Vitest migration for Positron code under `src/vs/` and polish the one test helper that can't fit the sync builder pattern, so future authors land on a single, consistent test authoring surface.

**Context:** PR1 (#12893 and merged #13033) modernized 14 existing `.vitest.*` files to the `createTestContainer()` + `setupRTLRenderer()` + jest-dom + explicit-assert convention, installed `eslint-plugin-testing-library` to lock the convention in, and split authoring docs into `.claude/rules/vitest-tests.md` (core) + `vitest-rtl.md` (React). PR2 ports the remaining Mocha tests over and cleans up the one async helper that PR1 left in an inconsistent shape.

## Scope

### 1. Mocha → Vitest migrations (19 files)

All 19 remaining Positron-authored `*.test.ts` files in `src/vs/` have a known migration path after source scan. No files need further investigation; no files are deferred.

**Trivial — 12 files (pure, no DI, no sinon).** Direct port to plain `.vitest.ts`: `suite/test` → `describe/it`, `assert.*` → `expect(*).to*`, `ensureNoDisposablesAreLeakedInTestSuite` → `beforeEach(() => ensureNoLeakedDisposables())`.

- `src/vs/base/test/common/ansiOutput.test.ts`
- `src/vs/base/test/common/ansiStyles.test.ts`
- `src/vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl.test.ts`
- `src/vs/workbench/contrib/positronConsole/test/common/linkDetector.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/browser/quartoKernelManager.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/common/quartoExecutionOptions.test.ts`
- `src/vs/workbench/contrib/positronQuarto/test/common/quartoParser.test.ts`
- `src/vs/workbench/contrib/positronPackages/test/browser/packagesQuery.test.ts`
- `src/vs/editor/contrib/positronStatementRange/test/browser/provideStatementRange.test.ts`
- `src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.test.ts`
- `src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.test.ts`
- `src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.test.ts`

**Trivial + sinon — 1 file (no DI, single sinon stub).** Adds one translation step: `sinon.stub().returns(x)` → `vi.fn().mockReturnValue(x)`. No builder needed — the registry is directly instantiable.

- `src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.test.ts`

**Builder-fit — 6 files (need `createTestContainer().with*().build()`).** Swap `TestInstantiationService` + `createRuntimeServices(...)` → `.withRuntimeServices()` (or `.withWorkbenchServices()` for the chat file). `createRuntimeServices` is already the preset's internal wiring, so the swap is clean. Sinon usage in the bottom two files translates mechanically: `sinon.spy/stub` → `vi.fn()` / `vi.spyOn()`, `sinon.assert.*` → `expect(fn).toHaveBeenCalled*`, `sinon.match(/re/)` → `expect.stringMatching(/re/)`, `sinon.assert.callOrder(a, b)` → compare `a.mock.invocationCallOrder[0]` < `b.mock.invocationCallOrder[0]`.

- `src/vs/workbench/services/languageRuntime/test/common/languageRuntime.test.ts` — `.withRuntimeServices()`
- `src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.test.ts` — `.withRuntimeServices()` + 6 stubs (existing in-file helper translates cleanly)
- `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.test.ts` — `.withRuntimeServices()` or `.withNotebookServices()` (lowest that covers)
- `src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.test.ts` — `.withWorkbenchServices()` + 8 stubs (hand-rolled mock classes stay in-file)
- `src/vs/workbench/services/positronHistory/test/common/executionHistoryService.test.ts` — `.withRuntimeServices()` + `IStorageService`; translates 8 sinon calls
- `src/vs/workbench/services/runtimeSession/test/common/runtimeSession.test.ts` — `.withRuntimeServices()`; translates 41 sinon calls

### 1a. Size-risk files — scope markers for writing-plans

Three files are large enough to bound how writing-plans splits the work. These are **not** deferral candidates — they're tractable — but each should likely be its own commit:

- `ansiOutput.test.ts` (1887 lines) — pure, mechanical, voluminous.
- `executionHistoryService.test.ts` (1054 lines) — mechanical once the sinon→vi patterns are established from earlier files.
- `runtimeSession.test.ts` (1444 lines, 41 sinon calls) — the largest single item. Port last so the sinon translation patterns are well-worn by then.

### 2. Async notebook test helper — keep, modernize internals, rename, document

`src/vs/workbench/contrib/positronNotebook/test/browser/testUtils.ts` exports `createPositronNotebookTestServices(disposables): Promise<TestServices>`. Two consumer tests (`positronNotebookEditorResolution.vitest.ts`, `positronNotebookConfigurationHandling.vitest.ts`) depend on its `await createEditorPart(...)` to exercise the **real** editor resolver against real editor groups. Mocking `IEditorGroupsService` would reduce those tests to testing our mock.

**Decision: keep the async helper. Don't make `.build()` async.**

Rationale:
- The async is load-bearing for 2 tests. The other ~100 notebook tests never need it and shouldn't pay for it.
- Making `.build()` return a `Promise` to accommodate 2 files forces `await` on every author. That's the opposite of "easy for anyone to write."
- A narrow async helper alongside the sync builder is the cleanest division of responsibility: the builder handles 99% of cases; the helper handles the editor-resolver case explicitly.

**Polish applied in PR2.** The helper currently calls `positronWorkbenchInstantiationService(disposables)` directly — an anti-pattern per PR1's own rules. PR1 added the `.withNotebookEditorServices()` preset (which wires the workbench + editor/language/tree-sitter/webview-preload stubs needed to attach `TestCodeEditor` to notebook cells), so the helper can now compose that preset internally instead.

- **Modernize internals.** Replace `positronWorkbenchInstantiationService(disposables)` with `createTestContainer().withNotebookEditorServices().build()`, then layer the async-only work on top (`await createEditorPart`, real `EditorResolverService`, the handful of notebook-specific service mocks that are unique to these 2 tests).
- **Rename** `createPositronNotebookTestServices` → `setupNotebookEditorTest`. Verb-first, matches `setupRTLRenderer` naming.
- **Add a JSDoc block** steering authors away by default: "Use this only when your test needs a real `EditorPart`. Most notebook tests should use `createTestContainer().withNotebookEditorServices()` directly."
- **Colocate** with `setupRTLRenderer` in `src/vs/test/vitest/` so the two test-setup helpers are discoverable together. (Or keep in-tree with a cross-link if the move turns out to pull in workbench-only imports — plan phase decides.)
- Update the two consumer tests to the new name.

### 3. Optional ride-alongs

- If `KernelStatusBadge.vitest.tsx` from the skill-validation exercise is still on disk and passing, include it. Otherwise skip.

## Out of scope

- **Further builder preset extraction.** PR1 already added `.withNotebookServices()` and `.withNotebookEditorServices()`. PR2 uses them, doesn't add more. If a migration needs something neither preset covers, extend via `.stub()` in-test rather than growing the builder.
- **Extension-host tests** (`extensions/*/src/test/`). Those stay on Mocha by design — they need an activated extension host.
- **E2E tests.** Out of scope entirely.
- **Further RTL or builder convention changes.** PR1's conventions are frozen; PR2 applies them, doesn't rewrite them.
- **Upstream Mocha tests** (`src/vs/**/*.test.ts` with Microsoft copyright). Not touched.

## Success criteria

1. No Positron-authored `*.test.ts` files remain in `src/vs/`. All 19 have been ported to `.vitest.ts`.
2. `setupNotebookEditorTest` is named, documented, and used by both consumer tests; no stale `createPositronNotebookTestServices` references.
3. `npm run test:positron` passes, and the migrated files run in under the Mocha baseline (migration should not regress wall time).
4. `npx eslint src/vs/**/*.vitest.*` is clean — every migrated file conforms to the PR1 conventions without further edits.
5. The `.claude/rules/vitest-tests.md` "Where should I put my test?" decision table still reflects the test surface — no doc changes needed unless the helper move changes the React-Quick-Start file path.

## Risks and mitigations

- **Builder preset surprises.** A migrated file may need a preset we haven't used before. Mitigation: start low, let errors guide up (already the documented pattern). Plan phase flags any file whose dependency tree looks exotic.
- **Sinon translation gotchas.** The two sinon-heavy files (`runtimeSession`, `executionHistoryService`) use `sinon.assert.callOrder`, `sinon.match`, and spies-on-real-services. Mitigation: port the smaller sinon-using files first so the translation recipes (`vi.fn().mock.invocationCallOrder`, `expect.stringMatching`, `vi.spyOn`) are proven by the time we hit `runtimeSession.test.ts`.
- **PR size.** 19 files including one 1887-line and one 1444-line file will produce a large diff. Mitigation: land each size-risk file as its own commit so review can happen commit-by-commit. Writing-plans phase decides the exact commit boundaries.
- **Helper move breaks imports.** If `setupNotebookEditorTest` moves to `src/vs/test/vitest/` and pulls in workbench-only types, revert the move and keep the helper where it is. The rename + JSDoc alone capture most of the value.

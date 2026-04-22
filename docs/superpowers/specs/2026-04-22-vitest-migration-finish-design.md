# Finish Positron Vitest Migration + RTL Modernization

**Status:** Draft
**Author:** Marie Idleman
**Date:** 2026-04-22
**Related PRs:** [#12893](https://github.com/posit-dev/positron/pull/12893) (phase 1), [#13033](https://github.com/posit-dev/positron/pull/13033) (phase 2)

## Goal

Finish the Positron Vitest migration started in PRs #12893 and #13033, and apply Dhruvi-style RTL feedback to already-migrated tests so the new conventions are in place before the final batch of Mocha files lands.

## Context

Phase 1 (#12893) introduced the `createTestContainer()` builder and migrated a first wave of tests. Phase 2 (#13033) added Vitest infrastructure (happy-dom, RTL via `setupRTLRenderer()`, 4-preset builder), the `author-vitest-tests` / `review-vitest-tests` skills, and migrated 60 Positron-authored test files.

Three pieces of work are outstanding:

1. **18 Positron-origin `.test.ts` files in `src/vs/` still run on Mocha.** They were triaged in the original PR3 plan into 6 trivial, 10 builder-fit, 3 needs-investigation, 1 defer. Since then, 3 were migrated (Quarto notebook files) and 2 new files appeared (`quartoKernelManager.test.ts`, `activeRuntimeNotebookContextManager.test.ts`). Net: 18 files, both new additions are builder-fit.
2. **11 already-migrated `.vitest.tsx` files still use raw `container.querySelector(...)`** for assertion targets instead of RTL queries. Dhruvi flagged this on `columnSummaryCell.vitest.tsx` in the #13033 review with a concrete rewrite example: `getByText('0%', { selector: '.text-percent' })` over `container.querySelector('.text-percent')` + `assert.strictEqual`. The feedback is a pattern preference that applies broadly, not just to the one file.
3. **6 already-migrated `.vitest.*` files still hand-roll DI** with `TestInstantiationService`, upstream `workbenchInstantiationService()`, or `as unknown as PositronReactServices` accessor casts. Everything else in the codebase uses `createTestContainer()`.

The hygiene relax for inline snapshots (originally scoped as a 4th workstream) already shipped in #13033 — `build/hygiene.ts:117-122` exempts `.vitest.{ts,tsx}`.

## Scope

Two PRs, sequential:

| PR | Title | Scope |
|---|---|---|
| **PR1** | `test: modernize Vitest tests with RTL idioms and builder adoption` | RTL sweep (11 files) + builder cleanup (6 files, 3 overlap) + new "RTL idioms" section in `.claude/rules/vitest-tests.md` + `review-vitest-tests` skill checklist update |
| **PR2** | `test: finish Positron Mocha → Vitest migration` | 15 trivial+builder-fit migrations + inline investigation of 2 ambiguous files (migrate or document keep-on-Mocha) + 1 deferred with PR-body note |

PR1 lands first so PR2's migrations follow the new RTL conventions automatically, and the `review-vitest-tests` skill enforces them during review.

### Out of scope

- Upstream VS Code `*.test.ts` files — these stay on Mocha per established convention.
- `executionHistoryService.test.ts` (~1000 LOC, sinon-heavy workspace/storage/runtime mocking) — deferred with a one-sentence note in PR2 body. Revisit when builder patterns mature further.
- Source-component accessibility refactors (adding `role` / `aria-label` to make `getByRole` viable where it isn't today). The RTL conventions are pragmatic — `getByText({ selector })` and `getByTestId` are allowed with an intent comment.
- Extension host tests (`extensions/**/*.test.ts`) and e2e tests.

## PR1 — RTL modernization + builder cleanup + conventions

### Files

| File | RTL sweep | Builder cleanup |
|---|---|---|
| `src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx` | yes | — |
| `src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx` | yes | — |
| `src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx` | yes | — |
| `src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx` | yes | — |
| `src/vs/workbench/contrib/positronNotebook/test/browser/notebookErrorBoundary.vitest.tsx` | yes | — |
| `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputCollapseButton.vitest.tsx` | yes | — |
| `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellActionButton.vitest.tsx` | yes | — |
| `src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx` | yes | — |
| `src/vs/platform/positronActionBar/test/browser/actionBarWidget.vitest.tsx` | yes | yes (overlap) |
| `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.vitest.tsx` | yes | yes (overlap) |
| `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.vitest.tsx` | yes | yes (overlap) |
| `src/vs/workbench/contrib/positronNotebook/test/browser/useMenuActions.vitest.tsx` | — | yes |
| `src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.vitest.ts` | — | yes |
| `src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts` | — | yes |

14 unique files. Overlap files get both rewrites in one pass.

### Per-file work

**RTL sweep (mechanical):**
- `container.querySelector('.x')` → `getByRole(...)` / `getByText(...)` / `getByLabelText(...)` / `getByTestId(...)` per priority ladder.
- `expect(el).toBeTruthy()` → `expect(el).toBeInTheDocument()`.
- `expect(el).toBeFalsy()` or `expect(el).toBeNull()` (when asserting absence) → `queryBy*` returning null check, or `expect(el).not.toBeInTheDocument()`.
- `assert.strictEqual(el.textContent, 'x')` → `expect(el).toHaveTextContent('x')`.
- `assert.ok(el)` / `assert.strictEqual(el, null)` → equivalent `expect()` forms.
- Class checks → `expect(el).toHaveClass(...)`.
- Disabled state → `expect(el).toBeDisabled()`.

**Builder cleanup (mechanical):**
- Replace `TestInstantiationService` / `workbenchInstantiationService()` / hand-rolled `PositronReactServices` accessor with:
  ```tsx
  const ctx = createTestContainer()
      .withReactServices()
      .stub(IService, stub)
      .build();
  const rtl = setupRTLRenderer(() => ctx.reactServices);
  ```
- Drop manual `PositronReactServicesContext.Provider` wrapping in render helpers — `setupRTLRenderer` handles it.
- Drop manual `PositronReactServices.services = mockServices` singleton mutation and associated `beforeEach`/`afterEach` save/restore (applies to `tableSummaryDataGridInstance.vitest.ts`).
- For `positronConsoleFindWidget.vitest.ts`: replace `workbenchInstantiationService()` with `.withWorkbenchServices()` preset; expect ~5-10 `.stub()` calls to cover what the upstream helper was providing implicitly. Iterate as missing-service errors surface.

### Documentation — `.claude/rules/vitest-tests.md`

Add a new section **"RTL idioms"** between "The Builder" and "Run commands":

> **Query priority.** Prefer Testing Library queries in this order: `getByRole` → `getByLabelText` → `getByPlaceholderText` → `getByText` → `getByDisplayValue` → `getByAltText` → `getByTitle` → `getByTestId`. The escape hatches `getByText('text', { selector: '.css' })` and `getByTestId(...)` are fine when a role or label isn't available — add a brief inline comment if the choice isn't obvious.
>
> **Assertions.** Use `@testing-library/jest-dom` matchers: `toBeInTheDocument()` over `toBeTruthy()`, `toHaveTextContent('x')` over `assert.strictEqual(el.textContent, 'x')`, `toHaveClass(...)`, `toBeDisabled()`, etc.
>
> **Anti-patterns to avoid:**
> - `container.querySelector(...)` as an assertion target — use a query.
> - `assert.strictEqual` / `assert.ok` / `assert.equal` — use `expect()`.
> - `expect(el).toBeTruthy()` / `toBeFalsy()` to assert DOM presence or absence — use `toBeInTheDocument()` / `not.toBeInTheDocument()`.

Add a showcase entry in the existing "Working examples" list pointing at the rewritten `columnSummaryCell.vitest.tsx` as the canonical small RTL example.

### Skill update — `.claude/skills/review-vitest-tests/SKILL.md`

Add three checks to the skill's review checklist:

1. **No raw `container.querySelector(...)` for assertion targets** in `.vitest.tsx`. Point to RTL idioms section.
2. **No `assert.strictEqual` / `assert.ok` / `toBeTruthy` for DOM assertions.** Point to jest-dom matchers.
3. **No hand-rolled DI** — flag `TestInstantiationService`, `workbenchInstantiationService`, `as unknown as PositronReactServices`. Point to `createTestContainer()` builder.

### Verification

- Per file: `npx vitest run <file>` green; test count and assertion count preserved (no behavior change).
- Whole suite: `npm run test:positron` green (currently 619 tests).
- Grep gate: `grep -rln 'querySelector' src/vs --include='*.vitest.tsx'` returns zero matches.
- Grep gate: `grep -rln 'TestInstantiationService\|workbenchInstantiationService\|as unknown as PositronReactServices' src/vs --include='*.vitest.*'` returns zero matches (or only files explicitly out of scope).

### Risks

- **Behavior preservation on `querySelector` → RTL query swaps.** A `querySelector('.x')` matches any descendant; `getByText` is exact-match by default, `getByRole` requires the element to have a matching role. Tests that relied on partial-match or multiple-match semantics need `getAllByText` or a different query. `npx vitest run <file>` catches this per file — not silent.
- **Builder may surface missing-service errors** for the 6 hand-rolled DI files when stubs don't cover what the old accessor implicitly provided. Standard workflow: let the error name the missing service, add `.stub()`, re-run.
- **`positronConsoleFindWidget.vitest.ts` workbench preset stress.** Largest file (356 LOC, 23 tests) and the only user of the upstream `workbenchInstantiationService()` helper. Budget extra time (~60-90 min) and expect iteration on stubs.

## PR2 — Finish Mocha → Vitest migration

### Files

**Trivial — 5 files** (rename + `suite/test` → `describe/it` + `assert.X(a,b)` → `expect(a).toX(b)`):

- `src/vs/base/test/common/ansiStyles.test.ts` (3 tests)
- `src/vs/base/test/common/ansiOutput.test.ts` (53 tests)
- `src/vs/workbench/contrib/positronConsole/test/common/linkDetector.test.ts` (5 tests)
- `src/vs/workbench/contrib/positronQuarto/test/common/quartoParser.test.ts` (14 tests)
- `src/vs/workbench/contrib/positronQuarto/test/common/quartoExecutionOptions.test.ts` (11 tests)

**Builder-fit — 10 files** (rename + builder + `sinon` → `vi.fn` / `vi.spyOn`):

| File | Preset | Notes |
|---|---|---|
| `src/vs/editor/contrib/positronStatementRange/test/browser/provideStatementRange.test.ts` | bare | `LanguageFeatureRegistry` stub |
| `src/vs/workbench/contrib/positronNotebook/test/common/editor/cellEditorPrimitives.test.ts` | bare | originally ambiguously triaged; re-confirm bucket during pickup and move to investigation if blocked |
| `src/vs/platform/positronActionBar/test/browser/positronActionBarWidgetRegistry.test.ts` | bare | `IContextKeyService` stub |
| `src/vs/workbench/services/positronIPyWidgets/test/common/webviewPreloadUtils.test.ts` | bare | pure HTML validation |
| `src/vs/workbench/services/languageRuntime/test/common/languageRuntime.test.ts` | runtime | `LanguageRuntimeService` + config stubs |
| `src/vs/workbench/services/languageRuntime/test/common/languageRuntimeIPyWidgetClient.test.ts` | runtime | IPyWidget client, async messaging |
| `src/vs/workbench/services/runtimeSession/test/common/runtimeSession.test.ts` | runtime or notebook | 16 tests, complex mocks; already uses `createRuntimeServices()` |
| `src/vs/workbench/services/runtimeStartup/test/common/runtimeStartup.test.ts` | workbench | notification/lifecycle/environment services |
| `src/vs/workbench/contrib/positronQuarto/test/browser/quartoKernelManager.test.ts` *(new)* | runtime | 6 tests, `TestRuntimeStartupService` + `IRuntimeSessionService` |
| `src/vs/workbench/contrib/runtimeNotebookKernel/tests/browser/activeRuntimeNotebookContextManager.test.ts` *(new)* | workbench | 11 tests, extends upstream `TestEditorService`, `TestInstantiationService` |

**Needs investigation — 2 files** (decide inline during PR2: migrate or document keep-on-Mocha):

- `src/vs/workbench/contrib/chat/test/browser/chatRuntimeSessionContext.test.ts` — 12+ service mocks, complex Emitter wiring.
- `src/vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl.test.ts` — uses `WebviewInitInfo` browser API; happy-dom coverage unclear.

(`cellEditorPrimitives.test.ts` could land here instead of builder-fit if pickup reveals blockers — tracked in the builder-fit table note above.)

**Deferred — 1 file:**

- `src/vs/workbench/services/positronHistory/test/common/executionHistoryService.test.ts` (~1000 LOC, sinon-heavy). Documented in PR2 body as "stays on Mocha because: low ROI until builder patterns mature further; not blocking." Revisit in a follow-up.

### Per-file workflow

1. `git mv foo.test.ts foo.vitest.ts`
2. Add `/// <reference types="vitest/globals" />` after the copyright header.
3. Trivial: syntax swap. Builder-fit: add `createTestContainer().with<Preset>().stub(...).build()`, migrate `sinon.stub()` → `vi.fn()` / `vi.spyOn()`.
4. Emitters at describe scope (captured by stub at `build()` time).
5. If the file is a React component (none in current scope, but for completeness): apply PR1's RTL conventions from the start.
6. `npx vitest run <file>` — iterate stubs upward until green.
7. After each file: `npm run test:positron` to confirm no cross-file leakage.

### Investigation playbook

For each of the 3 needs-investigation files, budget ~30 minutes:

1. Read the file. Enumerate service dependencies and any DOM/webview API usage.
2. Check `src/vs/test/vitest/positronTestContainer.ts` preset coverage.
3. If migratable in the time budget: do it, move to builder-fit bucket.
4. If not: add a 2-3 line header comment — `// Stays on Mocha because: <specific reason, e.g., "happy-dom lacks WebviewInitInfo support">` — and move on. Document in PR2 body.

### Verification

- Per file: `npx vitest run <file>` green; test count + assertion count preserved.
- Whole suite: `npm run test:positron` green. PR2 should add ~150-200 tests to the existing 619.
- Grep gate at end: `find src/vs -name '*.test.ts' | xargs grep -l 'Posit Software' 2>/dev/null` returns only `executionHistoryService.test.ts` plus any investigation-bucket files explicitly kept on Mocha with a documented reason.

### Risks

- **happy-dom vs Electron divergence** (flagged in `.claude/rules/vitest-tests.md`). If a builder-fit test fails with DOM-related errors, escalate to the investigation bucket rather than forcing the migration.
- **Disposable leaks in `runtimeSession.test.ts`** (16 tests, complex mocks). The builder handles disposables automatically; strip any manual wiring carried over from the Mocha version.
- **Investigation budget overrun.** If all 3 investigation files need >30 min, document them as keep-on-Mocha rather than blocking PR2. The bar is "document the reason so the next person doesn't have to re-triage."

## Cross-cutting

### Branch / worktree

Current branch is `mi/vitest-phase-3`. Two options — decide during plan-writing:

- **Use current worktree for PR1 first**, merge, rebase/reset for PR2. Re-uses existing worktree; branch name becomes a mild misnomer for PR1.
- **Create a fresh branch `mi/vitest-rtl-modernize` for PR1**, keep `mi/vitest-phase-3` for PR2. Cleaner labels, one worktree swap.

Either works. Plan-writing will pick one.

### PR dependency

PR2 must rebase onto PR1's merged state so:

1. React-component migrations (rare in PR2 scope but possible) follow PR1's RTL conventions.
2. `review-vitest-tests` skill enforces the new checks during PR2 review, catching regressions.

### Regression prevention

The skill update in PR1 is the durable guard. Without it, a future `.vitest.tsx` file can reintroduce `querySelector` and nobody catches it in review. Rules + skill together mean Dhruvi's feedback doesn't need to be repeated on the next migration.

## Success criteria

**After PR1:**
- `grep -rln 'querySelector' src/vs --include='*.vitest.tsx'` returns 0.
- `grep -rln 'TestInstantiationService\|workbenchInstantiationService\|as unknown as PositronReactServices' src/vs --include='*.vitest.*'` returns 0.
- `.claude/rules/vitest-tests.md` has the "RTL idioms" section.
- `review-vitest-tests` skill flags the three new anti-patterns.
- `npm run test:positron` green.

**After PR2:**
- `find src/vs -name '*.test.ts' | xargs grep -l 'Posit Software'` returns only the documented exceptions (`executionHistoryService.test.ts` + any post-investigation keep-on-Mocha files).
- `npm run test:positron` green; test count increased by ~150-200.

## References

- [PR #12893 — phase 1](https://github.com/posit-dev/positron/pull/12893)
- [PR #13033 — phase 2](https://github.com/posit-dev/positron/pull/13033)
- `.claude/rules/vitest-tests.md` — current Vitest conventions (target for additions)
- `src/vs/test/vitest/positronTestContainer.ts` — builder preset definitions
- `src/vs/test/vitest/reactTestingLibrary.vitest.tsx` — RTL infrastructure reference
- Showcase tests cited in `.claude/rules/vitest-tests.md`: `positronUpdateUtils.vitest.ts`, `qmdToNotebook.vitest.ts`, `emptyConsole.vitest.tsx`, `webviewPlotThumbnail.vitest.tsx`, `startupStatus.vitest.tsx`.

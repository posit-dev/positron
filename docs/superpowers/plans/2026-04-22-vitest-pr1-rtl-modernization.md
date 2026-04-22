# Vitest PR1 — RTL Modernization + Builder Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize 14 already-migrated Positron Vitest test files — sweep raw `querySelector` and `assert.*` usage to RTL queries + jest-dom matchers, replace hand-rolled DI with the `createTestContainer()` builder, and codify the new conventions in `.claude/rules/vitest-tests.md` and the `review-vitest-tests` skill.

**Architecture:** Two doc updates (rules + skill) land first so per-file rewrites can reference them in commit messages. Files are then rewritten in increasing-difficulty order: 8 RTL-only sweeps, 3 builder-only migrations, 3 combined RTL+builder rewrites for files in both lists. Each file rewrite preserves test count and assertion semantics — verified by `npx vitest run <file>` per task and `npm run test:positron` at the end.

**Tech Stack:** Vitest, `@testing-library/react`, `@testing-library/jest-dom`, `createTestContainer()` builder, `setupRTLRenderer()`, happy-dom.

**Spec:** `docs/superpowers/specs/2026-04-22-vitest-migration-finish-design.md`

---

## File Map

### Created
- None.

### Modified — conventions
- `.claude/rules/vitest-tests.md` — new "RTL idioms" section between "The Builder" and "Run commands"; new entry in "Working examples"
- `.claude/skills/review-vitest-tests/SKILL.md` — strengthen check #2 (builder adoption) and check #11 (RTL queries); add check #12 (assertion idioms)

### Modified — RTL sweep only (8 files)
- `src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx` (4 querySelector calls)
- `src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx`
- `src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx`
- `src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookErrorBoundary.vitest.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputCollapseButton.vitest.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellActionButton.vitest.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx`

### Modified — builder cleanup only (3 files)
- `src/vs/workbench/contrib/positronNotebook/test/browser/useMenuActions.vitest.tsx` (hand-rolled accessor with single service)
- `src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.vitest.ts` (singleton mutation)
- `src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts` (upstream `workbenchInstantiationService()` helper)

### Modified — RTL + builder combined (3 files)
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.vitest.tsx`
- `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.vitest.tsx`
- `src/vs/platform/positronActionBar/test/browser/actionBarWidget.vitest.tsx`

---

## Shared conversion recipe (referenced by per-file tasks)

### RTL sweep recipe

Apply mechanically per match in the file. Decide the replacement using the query priority: `getByRole` > `getByLabelText` > `getByPlaceholderText` > `getByText` > `getByDisplayValue` > `getByAltText` > `getByTitle` > `getByTestId`.

| Old pattern | Replacement |
|---|---|
| `const el = container.querySelector('.x'); expect(el).toBeTruthy();` | `const el = getByRole('button', { name: 'label' });` (or appropriate query) |
| `const el = container.querySelector('.x'); expect(el).toBeFalsy();` | `expect(queryByRole('button', { name: 'label' })).not.toBeInTheDocument();` |
| `assert.strictEqual(el.textContent, 'x')` | `expect(el).toHaveTextContent('x')` |
| `assert.ok(el)` | `expect(el).toBeInTheDocument()` |
| `assert.strictEqual(el, null)` | `expect(el).not.toBeInTheDocument()` (with `queryBy*`) |
| `el.classList.contains('x') === true` | `expect(el).toHaveClass('x')` |
| `el.disabled === true` | `expect(el).toBeDisabled()` |
| `el.getAttribute('aria-pressed') === 'true'` | `expect(el).toHaveAttribute('aria-pressed', 'true')` |

When a CSS class is the only handle (no role, no text), use `getByText('text', { selector: '.css' })` and add a one-line comment explaining why role/label isn't available.

If a `querySelector('.x')` matched multiple descendants (relying on `querySelectorAll` semantics elsewhere or assertion lenience), use `getAllByText` / `getAllByRole` and assert `.length`, or scope with `within(parent)`.

### Builder cleanup recipe

| Old pattern | Replacement |
|---|---|
| `const services = { ... } as unknown as PositronReactServices;` | `const ctx = createTestContainer().withReactServices().stub(IService, stubObj).build();` then `const rtl = setupRTLRenderer(() => ctx.reactServices);` |
| `const services = workbenchInstantiationService();` | `const ctx = createTestContainer().withWorkbenchServices().build();` (add `.stub()` calls iteratively as missing-service errors surface) |
| `const instantiationService = new TestInstantiationService(); instantiationService.stub(IService, ...);` | `const ctx = createTestContainer().with<Preset>().stub(IService, ...).build();` |
| `PositronReactServices.services = mockServices;` (with save/restore in `beforeEach`/`afterEach`) | Move every property of `mockServices` into `.stub()` calls in the builder; delete the save/restore. |
| Render helper wraps in `<PositronReactServicesContext.Provider value={services}>` | Drop the wrap -- `setupRTLRenderer(() => ctx.reactServices)` provides the context. |

For React tests, always pair the builder with `setupRTLRenderer(() => ctx.reactServices)` -- never reach for the container's accessor manually.

---

## Task 1: Capture baseline

**Files:** none.

- [ ] **Step 1: Verify clean working tree**

```bash
git status
```

Expected: only `.superset/` untracked (project worktree marker), nothing else.

- [ ] **Step 2: Run the full Vitest suite to capture green baseline**

```bash
npm run test:positron
```

Expected: green. Note the test count (currently ~619) — every subsequent task should preserve or increase this count, never decrease.

- [ ] **Step 3: Capture grep-gate baseline counts (will be checked at end)**

```bash
echo "querySelector in .vitest.tsx:"
grep -rln 'querySelector' src/vs --include='*.vitest.tsx' | wc -l

echo "Hand-rolled DI:"
grep -rln 'TestInstantiationService\|workbenchInstantiationService\|as unknown as PositronReactServices' src/vs --include='*.vitest.*' | wc -l
```

Expected: 11 querySelector files, 6 hand-rolled DI files. Record these numbers; final task should drive both to 0.

---

## Task 2: Add "RTL idioms" section to `.claude/rules/vitest-tests.md`

**Files:**
- Modify: `.claude/rules/vitest-tests.md`

- [ ] **Step 1: Read the current rules file**

```bash
cat .claude/rules/vitest-tests.md
```

Locate the section break between "The Builder" (ending with the **Common mistakes** block) and "Run commands".

- [ ] **Step 2: Insert the new "RTL idioms" section**

Insert the following between the end of "The Builder" section and the start of "## Run commands":

```markdown
## RTL idioms

For React component tests using `setupRTLRenderer()`:

**Query priority.** Prefer Testing Library queries in this order: `getByRole` -> `getByLabelText` -> `getByPlaceholderText` -> `getByText` -> `getByDisplayValue` -> `getByAltText` -> `getByTitle` -> `getByTestId`. Use `getByText('text', { selector: '.css' })` or `getByTestId(...)` when role/label aren't available -- add a brief inline comment if the choice isn't obvious.

**Assertions.** Use `@testing-library/jest-dom` matchers:

- `toBeInTheDocument()` over `toBeTruthy()` for presence checks.
- `not.toBeInTheDocument()` (with `queryBy*`) over `toBeNull()` / `toBeFalsy()` for absence.
- `toHaveTextContent('x')` over `assert.strictEqual(el.textContent, 'x')`.
- `toHaveClass(...)`, `toBeDisabled()`, `toBeVisible()`, `toHaveAttribute(...)` -- prefer the dedicated matcher over manual property reads.

**Anti-patterns to avoid:**

- `container.querySelector(...)` as an assertion target -- use a query.
- `assert.strictEqual` / `assert.ok` / `assert.equal` in `.vitest.tsx` -- use `expect()`.
- `expect(el).toBeTruthy()` / `toBeFalsy()` for DOM presence/absence -- use `toBeInTheDocument()` / `not.toBeInTheDocument()`.
```

- [ ] **Step 3: Add a showcase entry**

In the existing "## Working examples" section (at the bottom of the file), add a new bullet after the existing showcase entries:

```markdown
- [columnSummaryCell](../../src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx) -- RTL idioms: `getByText({ selector })`, `toHaveTextContent`, no `querySelector`
```

- [ ] **Step 4: Verify formatting**

```bash
npm run precommit -- .claude/rules/vitest-tests.md
```

Expected: pass (only formatting/copyright/whitespace checks; no eslint on `.md`).

- [ ] **Step 5: Commit**

```bash
git add .claude/rules/vitest-tests.md
git commit -m "$(cat <<'EOF'
docs(vitest): add RTL idioms section with query priority and jest-dom matchers

Codifies the conventions Dhruvi flagged in the #13033 review: prefer
RTL queries over container.querySelector, jest-dom matchers over raw
asserts, and toBeInTheDocument over toBeTruthy for DOM presence.

EOF
)"
```

---

## Task 3: Tighten `review-vitest-tests` skill checks

**Files:**
- Modify: `.claude/skills/review-vitest-tests/SKILL.md`

- [ ] **Step 1: Read the current skill checklist**

```bash
cat .claude/skills/review-vitest-tests/SKILL.md
```

Locate check #2 ("Builder adoption") and check #11 ("RTL query usage").

- [ ] **Step 2: Replace check #2 with strengthened wording**

Replace the existing check #2 block:

```markdown
### 2. Builder adoption

Is the test using `createTestContainer()`? Flag any usage of `positronWorkbenchInstantiationService()` or `createRuntimeServices()` as a failure -- use the builder's presets instead. The only exception is plain tests (no services) that use `ensureNoLeakedDisposables()` directly for disposable tracking.
```

with:

```markdown
### 2. Builder adoption

Is the test using `createTestContainer()`? Flag any of these patterns as a failure -- use the builder's presets instead:

- `positronWorkbenchInstantiationService()`
- `createRuntimeServices()`
- `TestInstantiationService` (from `src/vs/platform/instantiation/test/common/instantiationServiceMock.ts`)
- `workbenchInstantiationService()` (the upstream VS Code helper from `src/vs/workbench/test/browser/workbenchTestServices.ts`)
- Hand-rolled `as unknown as PositronReactServices` accessor casts
- Direct mutation of `PositronReactServices.services = ...` (use `.stub()` and let `setupRTLRenderer` deliver via context)

The only exception is plain tests (no services) that use `ensureNoLeakedDisposables()` directly for disposable tracking.
```

- [ ] **Step 3: Replace check #11 with strengthened wording**

Replace the existing check #11 block:

```markdown
### 11. RTL query usage (React tests only)

For `.vitest.tsx` files using `setupRTLRenderer`: are there `container.querySelector` calls that could use `getByRole` or `getByText` instead? Flag cases where the component renders visible text or accessible roles that RTL can query directly. Note: many Positron components use internal CSS classes without accessible roles -- `container.querySelector` is acceptable when RTL queries aren't feasible.
```

with:

```markdown
### 11. RTL query usage (React tests only)

For `.vitest.tsx` files using `setupRTLRenderer`: flag any `container.querySelector(...)` used as an assertion target. Use the Testing Library query priority instead: `getByRole` > `getByLabelText` > `getByPlaceholderText` > `getByText` > `getByDisplayValue` > `getByAltText` > `getByTitle` > `getByTestId`. The escape hatch `getByText('text', { selector: '.css' })` is acceptable when role/label aren't available -- the file should include a brief inline comment if the choice isn't obvious. See `.claude/rules/vitest-tests.md` "RTL idioms".
```

- [ ] **Step 4: Add new check #12 for assertion idioms**

Insert after check #11 and before the existing "## Output format" heading:

```markdown
### 12. Assertion idioms (React tests only)

For `.vitest.tsx` files: flag these assertion anti-patterns.

- `expect(el).toBeTruthy()` / `expect(el).toBeFalsy()` for DOM presence/absence -- use `toBeInTheDocument()` / `not.toBeInTheDocument()`.
- `assert.strictEqual(el.textContent, 'x')` -- use `expect(el).toHaveTextContent('x')`.
- `assert.ok(el)` / `assert.strictEqual(el, null)` -- use `expect()` with a jest-dom matcher.
- Manual class checks like `el.classList.contains('x')` -- use `expect(el).toHaveClass('x')`.

See `.claude/rules/vitest-tests.md` "RTL idioms" for the full matcher list.
```

- [ ] **Step 5: Verify the skill file still parses**

```bash
head -5 .claude/skills/review-vitest-tests/SKILL.md
wc -l .claude/skills/review-vitest-tests/SKILL.md
```

Expected: frontmatter intact (`---\nname: review-vitest-tests\ndescription: ...`); line count grew by ~30-40.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/review-vitest-tests/SKILL.md
git commit -m "$(cat <<'EOF'
chore(skills): strengthen review-vitest-tests checks for RTL idioms

Tightens check #2 (builder adoption) to flag TestInstantiationService,
upstream workbenchInstantiationService, accessor casts, and singleton
mutation. Tightens check #11 to flag any container.querySelector as a
failure (was: "acceptable when RTL queries aren't feasible"). Adds new
check #12 for assertion idioms (toBeInTheDocument over toBeTruthy, etc.).

EOF
)"
```

---

## Task 4: Rewrite `columnSummaryCell.vitest.tsx` (canonical RTL example)

**Files:**
- Modify: `src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx`

This is the file Dhruvi commented on with an exact rewrite. It's the canonical example referenced in the rules' "Working examples" entry from Task 2.

- [ ] **Step 1: Capture baseline test count**

```bash
npx vitest run src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx 2>&1 | tail -10
```

Expected: green. Record the test count (passing assertions). The post-rewrite count must equal this.

- [ ] **Step 2: Read the file in full**

```bash
cat src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx
```

Identify all 4 `container.querySelector('.text-percent')` call sites (lines 121, 134, 147, 160 per current grep) and their associated `assert.*` / `expect().toBeTruthy()` calls.

- [ ] **Step 3: Apply the RTL rewrites per file**

Replace the per-test pattern:

```tsx
const container = renderRoot(mockTableSummaryDataGridInstance);
const nullPercentElement = container.querySelector('.text-percent');
expect(nullPercentElement).not.toBeNull();
assert.strictEqual(nullPercentElement!.textContent, '0%');
```

With Dhruvi's exact suggested form:

```tsx
const { getByText } = renderRoot(mockTableSummaryDataGridInstance);
getByText('0%', { selector: '.text-percent' });
```

(Adjust the literal text per call site -- '0%', '50%', etc.)

If a test is asserting *absence* of `.text-percent`, use:

```tsx
const { queryByText } = renderRoot(mockTableSummaryDataGridInstance);
expect(queryByText(/./, { selector: '.text-percent' })).not.toBeInTheDocument();
```

- [ ] **Step 4: Remove the now-unused `eslint-disable no-restricted-syntax` comment**

The file currently has `/* eslint-disable no-restricted-syntax */` at line 8 to allow `container.querySelector`. Remove this line if no `querySelector` calls remain.

- [ ] **Step 5: Run the test**

```bash
npx vitest run src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx
```

Expected: same test count as Step 1, all green.

- [ ] **Step 6: Verify grep gate for this file**

```bash
grep -c 'querySelector' src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx
```

Expected: 0.

- [ ] **Step 7: Commit**

```bash
git add src/vs/workbench/services/positronDataExplorer/test/browser/columnSummaryCell.vitest.tsx
git commit -m "$(cat <<'EOF'
test(dataExplorer): rewrite columnSummaryCell with RTL queries

Replaces container.querySelector + assert.strictEqual pattern with
getByText({ selector }) + jest-dom matchers per Dhruvi's #13033 review
suggestion. Establishes the canonical RTL idiom example referenced in
.claude/rules/vitest-tests.md.

EOF
)"
```

---

## Task 5: Rewrite `startupStatus.vitest.tsx`

**Files:**
- Modify: `src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx`

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx 2>&1 | tail -10
```

Record the test count.

- [ ] **Step 2: Read the file and identify anti-patterns**

```bash
grep -n 'querySelector\|toBeTruthy\|toBeFalsy\|assert\.' src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx
```

For each match, decide the RTL-idiom replacement per the conventions added in Task 2.

- [ ] **Step 3: Apply RTL rewrites per the "Shared conversion recipe -- RTL sweep recipe" section above.**

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx
```

Expected: same test count as Step 1, green.

- [ ] **Step 5: Verify grep gate**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx
```

Expected: 0.

- [ ] **Step 6: Commit**

```bash
git add src/vs/workbench/contrib/positronConsole/test/browser/startupStatus.vitest.tsx
git commit -m "test(console): rewrite startupStatus with RTL idioms"
```

---

## Task 6: Rewrite `webviewPlotThumbnail.vitest.tsx`

**Files:**
- Modify: `src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx`

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx 2>&1 | tail -10
```

Record the test count.

- [ ] **Step 2: Apply RTL rewrites**

Use the "Shared conversion recipe -- RTL sweep recipe" section above. This file is referenced from `.claude/rules/vitest-tests.md` as a showcase for event-driven tests with `act()` -- preserve the `act()` wrapping when rewriting.

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx
```

Expected: same test count, green.

- [ ] **Step 4: Verify grep gate**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx
```

Expected: 0.

- [ ] **Step 5: Commit**

```bash
git add src/vs/workbench/contrib/positronPlots/test/browser/webviewPlotThumbnail.vitest.tsx
git commit -m "test(plots): rewrite webviewPlotThumbnail with RTL idioms"
```

---

## Task 7: Rewrite `topActionBarSessionManager.vitest.tsx`

**Files:**
- Modify: `src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx`

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Apply RTL rewrites** per the "Shared conversion recipe -- RTL sweep recipe" section above.

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx
```

Expected: same count, green.

- [ ] **Step 4: Verify grep gate**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx
```

Expected: 0.

- [ ] **Step 5: Commit**

```bash
git add src/vs/workbench/browser/parts/positronTopActionBar/test/browser/topActionBarSessionManager.vitest.tsx
git commit -m "test(topActionBar): rewrite topActionBarSessionManager with RTL idioms"
```

---

## Task 8: Rewrite `notebookErrorBoundary.vitest.tsx`

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/notebookErrorBoundary.vitest.tsx`

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookErrorBoundary.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Apply RTL rewrites** per the "Shared conversion recipe -- RTL sweep recipe" section above. This file is 314 LOC -- larger than average; budget extra time.

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookErrorBoundary.vitest.tsx
```

Expected: same count, green.

- [ ] **Step 4: Verify grep gate**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/contrib/positronNotebook/test/browser/notebookErrorBoundary.vitest.tsx
```

Expected: 0.

- [ ] **Step 5: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/notebookErrorBoundary.vitest.tsx
git commit -m "test(notebook): rewrite notebookErrorBoundary with RTL idioms"
```

---

## Task 9: Rewrite `CellOutputCollapseButton.vitest.tsx`

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputCollapseButton.vitest.tsx`

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputCollapseButton.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Apply RTL rewrites** per the "Shared conversion recipe -- RTL sweep recipe" section above. This is a button component -- prefer `getByRole('button', { name: ... })`.

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputCollapseButton.vitest.tsx
```

Expected: same count, green.

- [ ] **Step 4: Verify grep gate**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputCollapseButton.vitest.tsx
```

Expected: 0.

- [ ] **Step 5: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputCollapseButton.vitest.tsx
git commit -m "test(notebook): rewrite CellOutputCollapseButton with RTL idioms"
```

---

## Task 10: Rewrite `CellActionButton.vitest.tsx`

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellActionButton.vitest.tsx`

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellActionButton.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Apply RTL rewrites** per the "Shared conversion recipe -- RTL sweep recipe" section above. This is a button component -- prefer `getByRole('button', { name: ... })`.

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellActionButton.vitest.tsx
```

Expected: same count, green.

- [ ] **Step 4: Verify grep gate**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellActionButton.vitest.tsx
```

Expected: 0.

- [ ] **Step 5: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellActionButton.vitest.tsx
git commit -m "test(notebook): rewrite CellActionButton with RTL idioms"
```

---

## Task 11: Rewrite `positronFindWidget.vitest.tsx` (notebook find widget)

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx`

This is the notebook's find widget. Do NOT confuse with `positronConsoleFindWidget.vitest.ts` (the `.ts` console one in Task 14).

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Apply RTL rewrites** per the "Shared conversion recipe -- RTL sweep recipe" section above.

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx
```

Expected: same count, green.

- [ ] **Step 4: Verify grep gate**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx
```

Expected: 0.

- [ ] **Step 5: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/contrib/find/positronFindWidget.vitest.tsx
git commit -m "test(notebook): rewrite positronFindWidget with RTL idioms"
```

---

## Task 12: Migrate `useMenuActions.vitest.tsx` to builder

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/useMenuActions.vitest.tsx`

This file currently hand-rolls a `PositronReactServices` accessor returning a single `IMenuService`.

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/useMenuActions.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Read the file and locate the hand-rolled accessor**

```bash
grep -n 'as unknown as PositronReactServices\|services\.\|MenuService' src/vs/workbench/contrib/positronNotebook/test/browser/useMenuActions.vitest.tsx
```

The current shape is roughly:

```tsx
return {
    get: (id: any) => {
        if (id === IMenuService) { return menuService; }
        throw new Error(`Unexpected service: ${id}`);
    },
} as unknown as PositronReactServices;
```

- [ ] **Step 3: Replace with builder**

Substitute the hand-rolled accessor with:

```tsx
const ctx = createTestContainer()
    .withReactServices()
    .stub(IMenuService, menuService)
    .build();
const rtl = setupRTLRenderer(() => ctx.reactServices);
```

Add the necessary imports at the top of the file (mirror the import patterns from `src/vs/workbench/contrib/positronConsole/test/browser/emptyConsole.vitest.tsx`).

If the file has a render helper that wraps in `PositronReactServicesContext.Provider` manually, drop the wrap -- `setupRTLRenderer` handles it.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/useMenuActions.vitest.tsx
```

Expected: same test count, green. If you see "missing service" errors, add the corresponding `.stub()` calls and re-run.

- [ ] **Step 5: Verify grep gate**

```bash
grep -cE 'TestInstantiationService|workbenchInstantiationService|as unknown as PositronReactServices' src/vs/workbench/contrib/positronNotebook/test/browser/useMenuActions.vitest.tsx
```

Expected: 0.

- [ ] **Step 6: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/useMenuActions.vitest.tsx
git commit -m "test(notebook): migrate useMenuActions to createTestContainer()"
```

---

## Task 13: Migrate `tableSummaryDataGridInstance.vitest.ts` to builder

**Files:**
- Modify: `src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.vitest.ts`

This file already uses `createTestContainer().build()` but ALSO mutates `PositronReactServices.services = mockServices` directly with a save/restore dance in `beforeEach`/`afterEach`. Consolidate the mutation into builder stubs.

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.vitest.ts 2>&1 | tail -10
```

- [ ] **Step 2: Read the file**

```bash
grep -n 'PositronReactServices\.services\|originalServices\|beforeEach\|afterEach\|TestConfigurationService\|NullHoverService' src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.vitest.ts
```

- [ ] **Step 3: Replace the singleton mutation with stubs**

Move the services currently being assigned via `PositronReactServices.services = mockServices` into the builder:

```tsx
const ctx = createTestContainer()
    .withReactServices()
    .stub(IConfigurationService, new TestConfigurationService())
    .stub(IHoverService, NullHoverService)
    // ...add any other services from the mockServices object...
    .build();
```

Drop the `originalServices` save variable and the `beforeEach`/`afterEach` pair that swap in/out the singleton.

- [ ] **Step 4: Verify nothing else depends on the singleton**

```bash
grep -n 'PositronReactServices\.services' src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.vitest.ts
```

Expected: 0 matches after the change. If components rendered outside `rtl.render()` reach for the singleton, leave a comment and stub via the builder; if they break, escalate to the user.

- [ ] **Step 5: Run the test**

```bash
npx vitest run src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.vitest.ts
```

Expected: same count, green.

- [ ] **Step 6: Commit**

```bash
git add src/vs/workbench/services/positronDataExplorer/test/browser/tableSummaryDataGridInstance.vitest.ts
git commit -m "$(cat <<'EOF'
test(dataExplorer): migrate tableSummaryDataGridInstance to builder stubs

Replaces direct PositronReactServices.services singleton mutation +
beforeEach/afterEach save-restore dance with .stub() calls in the
createTestContainer() builder.

EOF
)"
```

---

## Task 14: Migrate `positronConsoleFindWidget.vitest.ts` to builder (workbench preset)

**Files:**
- Modify: `src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts`

Largest builder migration in this PR (356 LOC, 23 tests). Uses upstream's `workbenchInstantiationService()` -- replace with `.withWorkbenchServices()` preset.

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts 2>&1 | tail -10
```

- [ ] **Step 2: Inspect the import and call site**

```bash
grep -n 'workbenchInstantiationService\|workbenchTestServices' src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts
```

- [ ] **Step 3: Replace with the builder**

Substitute:

```ts
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
// ... later ...
const services = workbenchInstantiationService();
```

with:

```ts
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
// ... later ...
const ctx = createTestContainer()
    .withWorkbenchServices()
    .build();
```

- [ ] **Step 4: Run the test and iterate stubs**

```bash
npx vitest run src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts
```

Expect missing-service errors. For each one, add a `.stub(IService, ...)` to the builder and re-run. Loop until green. Budget: 60-90 minutes; expect 5-10 added stubs.

- [ ] **Step 5: Verify grep gate**

```bash
grep -cE 'TestInstantiationService|workbenchInstantiationService|as unknown as PositronReactServices' src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts
```

Expected: 0.

- [ ] **Step 6: Commit**

```bash
git add src/vs/workbench/contrib/positronConsole/test/browser/positronConsoleFindWidget.vitest.ts
git commit -m "$(cat <<'EOF'
test(console): migrate positronConsoleFindWidget to builder workbench preset

Replaces upstream workbenchInstantiationService() helper with
createTestContainer().withWorkbenchServices() + explicit stubs.

EOF
)"
```

---

## Task 15: Rewrite `CellTextOutput.vitest.tsx` (RTL + builder)

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.vitest.tsx`

Both RTL sweep AND builder migration in one pass. Currently hand-rolls a `services` cast with two services.

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Replace the hand-rolled accessor with the builder**

Replace:

```tsx
const services = {
    configurationService,
    contextKeyService,
} as unknown as PositronReactServices;
```

with:

```tsx
const ctx = createTestContainer()
    .withReactServices()
    .stub(IConfigurationService, configurationService)
    .stub(IContextKeyService, contextKeyService)
    .build();
const rtl = setupRTLRenderer(() => ctx.reactServices);
```

Drop any manual `PositronReactServicesContext.Provider` wrap from the render helper.

- [ ] **Step 3: Apply the RTL sweep** per the "Shared conversion recipe -- RTL sweep recipe" section above. Both rewrites in the same diff.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.vitest.tsx
```

Expected: same count, green. Iterate stubs if missing-service errors surface.

- [ ] **Step 5: Verify both grep gates**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.vitest.tsx
grep -cE 'TestInstantiationService|workbenchInstantiationService|as unknown as PositronReactServices' src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.vitest.tsx
```

Expected: both 0.

- [ ] **Step 6: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellTextOutput.vitest.tsx
git commit -m "test(notebook): modernize CellTextOutput with RTL idioms and builder"
```

---

## Task 16: Rewrite `CellOutputActionBar.vitest.tsx` (RTL + builder)

**Files:**
- Modify: `src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.vitest.tsx`

215 LOC, 6 tests. Currently uses `TestInstantiationService` + hand-rolled services cast inside the render helper, with a fresh `MockContextKeyService` per test.

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Replace `TestInstantiationService` with the builder**

Promote the `menu` object and `MockContextKeyService` instance to describe scope (a closure -- mutate `menuActions` from inside `it()` blocks if the existing pattern requires it). Then:

```tsx
describe('CellOutputActionBar', () => {
    const ctx = createTestContainer()
        .withReactServices()
        .stub(IMenuService, { createMenu: () => menu })
        .stub(IContextKeyService, new MockContextKeyService())
        .build();
    const rtl = setupRTLRenderer(() => ctx.reactServices);
    // ... render helper simplified ...
});
```

Drop manual `PositronReactServicesContext.Provider` wraps from the render helper.

- [ ] **Step 3: Apply the RTL sweep** per the "Shared conversion recipe -- RTL sweep recipe" section above.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.vitest.tsx
```

Expected: same count, green.

- [ ] **Step 5: Verify both grep gates**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.vitest.tsx
grep -cE 'TestInstantiationService|workbenchInstantiationService|as unknown as PositronReactServices' src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.vitest.tsx
```

Expected: both 0.

- [ ] **Step 6: Commit**

```bash
git add src/vs/workbench/contrib/positronNotebook/test/browser/notebookCells/CellOutputActionBar.vitest.tsx
git commit -m "test(notebook): modernize CellOutputActionBar with RTL idioms and builder"
```

---

## Task 17: Rewrite `actionBarWidget.vitest.tsx` (RTL + builder)

**Files:**
- Modify: `src/vs/platform/positronActionBar/test/browser/actionBarWidget.vitest.tsx`

280 LOC, 10 tests. Currently uses `TestInstantiationService` + `TestCommandService` + hand-rolled accessor satisfying `Partial<PositronReactServices>`. Largest combined RTL+builder file.

- [ ] **Step 1: Capture baseline**

```bash
npx vitest run src/vs/platform/positronActionBar/test/browser/actionBarWidget.vitest.tsx 2>&1 | tail -10
```

- [ ] **Step 2: Replace `TestInstantiationService` with builder**

```tsx
describe('ActionBarWidget', () => {
    const commandService = new TestCommandService();
    const ctx = createTestContainer()
        .withReactServices()
        .stub(ICommandService, commandService)
        .build();
    const rtl = setupRTLRenderer(() => ctx.reactServices);
    // ... render helper no longer wraps in PositronReactServicesContext.Provider ...
});
```

- [ ] **Step 3: Apply the RTL sweep** per the "Shared conversion recipe -- RTL sweep recipe" section above.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/vs/platform/positronActionBar/test/browser/actionBarWidget.vitest.tsx
```

Expected: same count, green.

- [ ] **Step 5: Verify both grep gates**

```bash
grep -cE 'querySelector|toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs/platform/positronActionBar/test/browser/actionBarWidget.vitest.tsx
grep -cE 'TestInstantiationService|workbenchInstantiationService|as unknown as PositronReactServices' src/vs/platform/positronActionBar/test/browser/actionBarWidget.vitest.tsx
```

Expected: both 0.

- [ ] **Step 6: Commit**

```bash
git add src/vs/platform/positronActionBar/test/browser/actionBarWidget.vitest.tsx
git commit -m "test(actionBar): modernize actionBarWidget with RTL idioms and builder"
```

---

## Task 18: Final verification + PR prep

**Files:** none (verification only).

- [ ] **Step 1: Run the grep gates across the whole repo**

```bash
echo "querySelector in .vitest.tsx (should be 0):"
grep -rln 'querySelector' src/vs --include='*.vitest.tsx' | wc -l

echo "Hand-rolled DI (should be 0):"
grep -rln 'TestInstantiationService\|workbenchInstantiationService\|as unknown as PositronReactServices' src/vs --include='*.vitest.*' | wc -l

echo "DOM assertion anti-patterns in .vitest.tsx (should be 0 or near it):"
grep -rcE 'toBeTruthy|toBeFalsy|assert\.(strictEqual|ok|equal)' src/vs --include='*.vitest.tsx' | grep -v ':0$'
```

If any of these return non-zero, identify the offending file(s) and either fix in-place or document why they're an exception (e.g., a `toBeTruthy` on a non-DOM value is fine).

- [ ] **Step 2: Run the full Vitest suite**

```bash
npm run test:positron
```

Expected: green, test count >= the baseline captured in Task 1.

- [ ] **Step 3: Run precommit on the changed files**

```bash
npm run precommit
```

Expected: pass (formatting, copyright, eslint clean).

- [ ] **Step 4: Push the branch**

```bash
git push -u origin $(git branch --show-current)
```

- [ ] **Step 5: Open the PR with `gh`**

```bash
gh pr create --title "test: modernize Vitest tests with RTL idioms and builder adoption" --body "$(cat <<'EOF'
## Summary

Modernizes 14 already-migrated Positron Vitest test files and codifies the conventions that drove the changes.

- **RTL sweep (11 files):** raw `container.querySelector(...)` → `getByRole` / `getByText` / `getByTestId`; `toBeTruthy` / `assert.strictEqual` → `toBeInTheDocument` / `toHaveTextContent` / etc.
- **Builder cleanup (6 files, 3 overlap with RTL):** `TestInstantiationService`, upstream `workbenchInstantiationService()`, hand-rolled `as unknown as PositronReactServices` accessors, and direct `PositronReactServices.services = ...` singleton mutation → `createTestContainer().withReactServices().stub(...).build()`.
- **Conventions:** new "RTL idioms" section in `.claude/rules/vitest-tests.md`; `review-vitest-tests` skill checks #2 (builder adoption), #11 (RTL queries), and new #12 (assertion idioms) tightened to enforce the patterns going forward.

Net change: behavior preserved (test count and assertion count unchanged per file). No source code touched.

This is the first of two PRs finishing the Positron Vitest migration. PR2 (the remaining Mocha → Vitest migration of 18 source files) rebases on this PR's merged conventions.

## Test plan

- [ ] CI Vitest job green
- [ ] `grep -rln 'querySelector' src/vs --include='*.vitest.tsx'` returns 0
- [ ] `grep -rln 'TestInstantiationService\|workbenchInstantiationService\|as unknown as PositronReactServices' src/vs --include='*.vitest.*'` returns 0
- [ ] Spot-check `columnSummaryCell.vitest.tsx` matches Dhruvi's #13033 review suggestion

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

- [ ] **Step 6: Confirm with the user**

Before considering the PR ready for review, summarize: number of files changed, test count delta, grep-gate results. Wait for user confirmation that the diff looks right before requesting review from teammates.

---

## Risks and recovery

- **A test fails after the rewrite with a different match count.** Most likely cause: `getByText` is exact-match, but the original `querySelector` matched any descendant. Switch to `getAllByText` and assert length, or scope the query to a sub-container with `within(parent)`.
- **Builder surfaces "Service X is not registered" after a hand-rolled-DI swap.** The old accessor implicitly satisfied that service. Add `.stub(IX, {})` and re-run; refine the stub once the test surfaces what method is called.
- **`positronConsoleFindWidget.vitest.ts` (Task 14) takes longer than 90 minutes.** If iteration on stubs isn't converging, pause and consider whether the test is reaching for services that genuinely require the upstream `workbenchInstantiationService()` (e.g., editor model wiring). If so, document the exception in the file with a comment and revisit in a follow-up.
- **A grep gate in Task 18 reports a non-zero count.** Either the rewrite missed a call site (find and fix) or the call site is intentionally an exception (e.g., a non-DOM `toBeTruthy` assertion). Document exceptions inline with a one-line comment.

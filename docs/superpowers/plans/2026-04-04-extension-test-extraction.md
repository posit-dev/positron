# Extension Test Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract 5 pure-logic extension tests from the Electron extension host to Vitest, and create extension test documentation.

**Architecture:** Move test files from `extensions/<ext>/src/test/` to `.vitest.ts` equivalents in the same directory. These files don't import `vscode` or `positron`, so they run identically in Vitest. The original `.test.ts` files are deleted since the extensions' test runners discover tests by glob pattern -- removing the file removes it from extension host runs.

**Tech Stack:** Vitest (already installed), existing extension source code

---

## File Structure

### Files to Migrate

| Original (extension host) | New (Vitest) |
|---|---|
| `extensions/positron-assistant/src/test/snowflake.test.ts` | `extensions/positron-assistant/src/test/snowflake.vitest.ts` |
| `extensions/positron-assistant/src/test/autoconfiguredProviders.test.ts` | `extensions/positron-assistant/src/test/autoconfiguredProviders.vitest.ts` |
| `extensions/positron-assistant/src/test/openai-fetch-utils.test.ts` | `extensions/positron-assistant/src/test/openai-fetch-utils.vitest.ts` |
| `extensions/positron-r/src/test/hyperlink.test.ts` | `extensions/positron-r/src/test/hyperlink.vitest.ts` |
| `extensions/positron-r/src/test/rversions.test.ts` | `extensions/positron-r/src/test/rversions.vitest.ts` |

### Config File to Update

| File | Change |
|---|---|
| `vitest.config.ts` | Add `extensions/positron-*/src/test/*.vitest.ts` to include pattern |

### NOT migrated (import `positron` -- need audit first)

- `extensions/positron-assistant/src/test/anthropicVercel.test.ts` -- uses `positron.PositronLanguageModelType`
- `extensions/positron-assistant/src/test/awsBedrock.test.ts` -- uses `positron` types
- `extensions/positron-assistant/src/test/notebookContextFilter.test.ts` -- uses `positron.notebooks.NotebookCellType`

---

## Task 1: Update Vitest Config to Discover Extension Tests

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Update the include pattern**

In `vitest.config.ts`, change the `include` array to also discover `.vitest.ts` files in extensions:

```typescript
include: [
    'src/vs/**/*.vitest.ts',
    'src/vs/**/*.vitest.tsx',
    'extensions/positron-*/src/test/**/*.vitest.ts',
],
```

- [ ] **Step 2: Verify config still works**

```bash
npx vitest run --passWithNoTests 2>&1 | tail -5
```

Expected: Existing 937 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: extend vitest config to discover extension tests"
```

---

## Task 2: Migrate positron-assistant Pure Logic Tests (3 files)

**Files:**
- Create: `extensions/positron-assistant/src/test/snowflake.vitest.ts`
- Create: `extensions/positron-assistant/src/test/autoconfiguredProviders.vitest.ts`
- Create: `extensions/positron-assistant/src/test/openai-fetch-utils.vitest.ts`
- Delete: the 3 corresponding `.test.ts` files

### Migration rules (same as core migration):

- `suite(...)` -> `describe(...)`
- `test(...)` -> `it(...)`
- `setup(...)` -> `beforeEach(...)`
- `teardown(...)` -> `afterEach(...)`
- `assert.strictEqual(a, b)` -> `expect(a).toBe(b)`
- `assert.deepStrictEqual(a, b)` -> `expect(a).toEqual(b)`
- `assert.equal(a, b)` -> `expect(a).toBe(b)`
- `assert.ok(x)` -> `expect(x).toBeTruthy()`
- `assert.throws(fn)` -> `expect(fn).toThrow()`
- `assert(x)` -> `expect(x).toBeTruthy()`
- `assert.notStrictEqual(a, b)` -> `expect(a).not.toBe(b)`
- Remove `import * as assert from 'assert'`
- Do NOT add explicit vitest imports (globals mode)
- Keep sinon imports as-is (used in snowflake.test.ts)
- Use tabs for indentation

- [ ] **Step 1: Read and migrate snowflake.test.ts (76 lines)**

Read `extensions/positron-assistant/src/test/snowflake.test.ts`, apply migration rules, write to `extensions/positron-assistant/src/test/snowflake.vitest.ts`.

Imports to keep: `sinon`, `createOpenAICompatibleFetch` (from `../openai-fetch-utils.js`).
Imports to remove: `assert`.

- [ ] **Step 2: Read and migrate autoconfiguredProviders.test.ts (91 lines)**

Read `extensions/positron-assistant/src/test/autoconfiguredProviders.test.ts`, apply migration rules, write to `extensions/positron-assistant/src/test/autoconfiguredProviders.vitest.ts`.

Imports to keep: `createAutomaticModelConfigs`, `SnowflakeModelProvider`, `CopilotModelProvider`.
Imports to remove: `assert`.

- [ ] **Step 3: Read and migrate openai-fetch-utils.test.ts (104 lines)**

Read `extensions/positron-assistant/src/test/openai-fetch-utils.test.ts`, apply migration rules, write to `extensions/positron-assistant/src/test/openai-fetch-utils.vitest.ts`.

Imports to keep: `fixPossiblyBrokenChatCompletionChunk`, `PossiblyBrokenChatCompletionChunk`.
Imports to remove: `assert`.

- [ ] **Step 4: Run the migrated tests**

```bash
npx vitest run extensions/positron-assistant/src/test/
```

Expected: All 3 new files pass.

- [ ] **Step 5: Run the full Vitest suite**

```bash
npx vitest run
```

Expected: 937 + new tests all pass. No regressions.

- [ ] **Step 6: Delete originals and commit**

```bash
git rm extensions/positron-assistant/src/test/snowflake.test.ts
git rm extensions/positron-assistant/src/test/autoconfiguredProviders.test.ts
git rm extensions/positron-assistant/src/test/openai-fetch-utils.test.ts
git add extensions/positron-assistant/src/test/*.vitest.ts
git commit -m "test: extract positron-assistant pure logic tests to Vitest (3 files)"
```

---

## Task 3: Migrate positron-r Pure Logic Tests (2 files)

**Files:**
- Create: `extensions/positron-r/src/test/hyperlink.vitest.ts`
- Create: `extensions/positron-r/src/test/rversions.vitest.ts`
- Delete: the 2 corresponding `.test.ts` files

Same migration rules as Task 2, plus:

- **Remove `import './mocha-setup'`** -- this imports vscode and sets up Mocha globals. The Vitest versions don't need it (the setup configures extension host logging and test name tracking, neither relevant outside the extension host).

- [ ] **Step 1: Read and migrate hyperlink.test.ts (30 lines)**

Read `extensions/positron-r/src/test/hyperlink.test.ts`, apply migration rules, write to `extensions/positron-r/src/test/hyperlink.vitest.ts`.

Remove: `import './mocha-setup'`, `import * as assert from 'assert'`.
Keep: `import { matchRunnable } from '../hyperlink'` (note: may need `.js` extension added).

- [ ] **Step 2: Read and migrate rversions.test.ts (242 lines)**

Read `extensions/positron-r/src/test/rversions.test.ts`, apply migration rules, write to `extensions/positron-r/src/test/rversions.vitest.ts`.

Remove: `import './mocha-setup'`, `import * as assert from 'assert'`.
Keep: `import { parseRVersionsFile } from '../provider-rversions'` (note: may need `.js` extension).

- [ ] **Step 3: Run the migrated tests**

```bash
npx vitest run extensions/positron-r/src/test/
```

Expected: Both files pass.

**If import resolution fails**: Extension source files may not use `.js` extensions in imports (extensions often use bare specifiers). If so, you may need to add a `resolve.alias` in vitest.config.ts for the extension paths, or add `.js` extensions to the imports.

- [ ] **Step 4: Run the full Vitest suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Delete originals and commit**

```bash
git rm extensions/positron-r/src/test/hyperlink.test.ts
git rm extensions/positron-r/src/test/rversions.test.ts
git add extensions/positron-r/src/test/*.vitest.ts
git commit -m "test: extract positron-r pure logic tests to Vitest (2 files)"
```

---

## Task 4: Update Design Spec

**Files:**
- Modify: `docs/superpowers/specs/2026-04-03-vitest-migration-design.md`

- [ ] **Step 1: Update Next Step #1 to reflect completion**

In the "Next Steps" section, update item #1 to mark the 5 pure logic extractions as done and note the 3 remaining files that need the `positron` import audit.

- [ ] **Step 2: Update test counts**

Update any references to "67 files, 937 tests" to include the new extension tests.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-03-vitest-migration-design.md
git commit -m "docs: update spec with extension test extraction results"
```

# Analyze branch changes and write unit tests for Positron code

You are a testing assistant for the Positron IDE (a VS Code fork). Your job is to analyze the dev's branch, recommend which tests to write, write them, and then have them independently reviewed before presenting results.

## Arguments

$ARGUMENTS may contain:
- `--branch <branch-name>` to analyze a specific branch instead of the current one
- A PR number (e.g., `#12242` or `12242`) to analyze a pull request
- A PR URL (e.g., `https://github.com/posit-dev/positron/pull/12242`)

## Phase 1: Analysis

### Step 1: Get the diff

If a PR number or URL was provided:
```bash
gh pr diff <number> --name-only
```
Use `gh pr diff <number>` (not `--patch`) for the full diff content when analyzing changes.

If `--branch` was provided:
```bash
git fetch origin <branch-name> 2>/dev/null
git diff main...origin/<branch-name> --name-only --diff-filter=ACMR
```
If fetch fails (branch not found), try without the `origin/` prefix for local branches.

Otherwise (current branch):
```bash
git diff main...HEAD --name-only --diff-filter=ACMR
```

### Step 2: Verify code exists on the current branch

**Critical:** When analyzing a PR or remote branch, the diff may reference code that was reverted, rebased out, or not yet merged. Before recommending tests for any new method, class, or event:
- Grep the current branch for each new symbol (method name, class name, interface member)
- Check `git log --oneline --grep="revert" -- <file>` for any post-merge reverts
- Only recommend tests for code that actually exists in the working tree

Skip any file where the changes no longer exist on the current branch.

### Step 3: Read the testing guide

Read the Testing section of `CLAUDE.md` for the decision tree, mocking guide, and preset-vs-stub guidance. Read `src/vs/workbench/test/browser/positronTestContainer.ts` for available presets. These are your references for all recommendations.

### Step 4: Classify each changed file

For each file in the diff, determine:

**Skip these entirely (don't mention them):**
- Test files (`*.test.ts`, `*.test.tsx`)
- Type definitions (`*.d.ts`, `interfaces/*.ts` that only contain interfaces)
- Generated files, configs, docs, build scripts
- Files with no testable logic (pure re-exports, registration wiring like `*.contribution.ts` that only calls `registerAction`)

**For Positron source files** (Posit Software copyright in `src/vs/` or `extensions/positron-*/`):

1. Check if a `.test.ts` test already exists for this file
2. Read the file's imports and constructor to determine the preset:
   - Read `src/vs/workbench/test/browser/positronTestContainer.ts` to see the available presets (e.g., `withRuntimeServices()`, `withNotebookServices()`, `withWorkbenchServices()`). Match the source file's dependencies to the lowest preset that covers them.
   - If no preset is needed (pure functions, no `@IServiceId` decorators), use a bare `createTestContainer().build()`.
   - If dependencies don't fit a preset cleanly, use the closest preset + `.stub()` for the extras.
3. If the class under test is not exported, note that `export` must be added for testability.
4. For `.tsx` files: check if it's a presentational component (bare), a component with service context (use a preset), or tightly coupled to VS Code editor lifecycle (recommend E2E instead).
5. For extension files that import `vscode` or `positron`: check if the import is for types/enums only (can still be unit tested with stubs) or genuinely needs extension host APIs (recommend `npm run test-extension` instead).

**For upstream VS Code files** (Microsoft copyright):
- Flag with a warning and provide the command to run existing Mocha tests:
  ```
  ./scripts/test.sh --run <path-to-existing-test>
  ```

### Step 5: Present the test plan

Show the dev a clear summary grouped by action:

**Tests to write** -- files with no existing test or where changes need new test cases. Include:
- The file path
- The recommended preset and WHY (which dependencies led to this choice)
- Whether extra `.stub()` calls are needed beyond the preset (and which services)
- What to test (public methods, events, state changes visible from the diff)

**Tests to extend** -- files that already have a `.test.ts` but the diff introduces new behavior not covered. Include:
- The existing test file path
- What new test cases are needed based on the diff

**Already covered** -- files with existing tests that cover the changes. Just list them briefly.

**Upstream warnings** -- any modified upstream files with the Mocha test command.

Then ask: **"Want me to write/extend these tests?"**

Wait for the dev's response. They may approve all, approve some, or ask questions. Do not proceed to Phase 2 until they confirm.

## Phase 2: Writing

For each approved item:

1. **Read the source file** to understand the public API, events, and behavior.

2. **Read existing tests in the same directory** for pattern consistency.

3. **Write the test** following the builder pattern from `positronTestContainer.ts`:
   - If bare (no services): just import and assert. No builder needed.
   - Otherwise: read `src/vs/workbench/test/browser/positronTestContainer.ts` for available presets, use the lowest one that fits.
   - **Always use `createTestContainer()`.** Do not fall back to manual `positronWorkbenchInstantiationService()`.
   - Use incremental mocking: start with the preset, add `.stub()` only if the test fails.
   - Use Mocha conventions: `suite()`, `test()`, `setup()`, `teardown()`.
   - Use tabs for indentation.
   - Add the Posit Software copyright header.
   - File name: `<source-name>.test.ts` (or `.test.tsx` if it contains JSX).

   **How the builder works with `createInstance()`:**
   The builder's `.stub()` runs inside its `setup()` hook, which means all stubs are applied BEFORE your test body runs. When testing a class that subscribes to events in its constructor, call `ctx.instantiationService.createInstance(MyClass)` in the test body -- the stubs are already in place. Create emitters at suite level and pass them via `.stub()`:

   ```typescript
   suite('Positron - MyContribution', () => {
       // Emitters created at suite level, reused each test
       const onDidSomething = new Emitter<void>();

       const ctx = createTestContainer()
           .withWorkbenchServices()
           .stub(IMyService, {
               onDidSomething: onDidSomething.event,
               listItems: () => [],
           } as IMyService)
           .build();

       test('responds to event', () => {
           // Stubs are applied. createInstance runs the constructor safely.
           const contribution = ctx.instantiationService.createInstance(MyContribution);
           ctx.disposables.add(contribution);

           onDidSomething.fire();
           // assert behavior
       });
   });
   ```

   **Do NOT assume the builder can't handle your case.** The builder's `setup()` hook creates a fresh instantiation service and applies all stubs before each test. The only case where manual setup is needed is when you need a completely custom instantiation service creation (not just extra stubs).

   **Quality checklist while writing:**
   - Every variable declared in `setup()` must be used in at least one test
   - Each suite should test: happy path, no-op/boundary, and at least one negative case
   - Prefer reusing a shared runtime/session variable over creating new ones per test (matches existing patterns and catches language-ID-sensitive bugs)
   - If setup exceeds ~20 lines of stubs, extract a helper function

4. **Run the test:**
   ```bash
   ./scripts/test.sh --run <path-to-test-file>
   ```

5. If tests pass, **move to the next file**. Do NOT ask the dev after each file -- batch the results for Phase 3.

6. **After all tests are written**, run the full suite for the affected area:
   ```bash
   ./scripts/test.sh --runGlob '<glob>.test.js'
   ```
   Confirm no regressions.

## Phase 3: Independent Review

After all tests pass, spawn **one** review subagent that reviews all new/modified test files together. A single agent can cross-check consistency between files and avoids redundant setup. Use the Agent tool:

```
Agent({
  description: "Review all new tests",
  prompt: "<the review prompt below, filled in with all file paths>"
})
```

### Review subagent prompt template

Fill in the file list and use this prompt:

---

You are reviewing unit test files for quality, maintainability, and adherence to the project's testing patterns. You have no context about why these tests were written this way -- evaluate them on their own merits.

**Test files to review:**
<list each test file path and its corresponding source file path>

**Builder reference:** `src/vs/workbench/test/browser/positronTestContainer.ts`
**Testing guide:** Read the Testing section of `CLAUDE.md`

Read all files, then evaluate each test file against this checklist. Report ONLY items that fail -- don't list passing items. Also flag any cross-file inconsistencies (e.g., same service stubbed differently, different assertion styles for the same pattern).

**Checklist (per test file):**

1. **Unused declarations** -- Any variables, emitters, or imports declared but never referenced in a test? Suite-level `let` variables that only exist for setup wiring should be inlined into the stub objects instead.

2. **Builder adoption** -- Is the test using `createTestContainer()` or manually calling `positronWorkbenchInstantiationService()`? The builder's `.stub()` runs inside `setup()`, so stubs are always applied before the test body. Calling `ctx.instantiationService.createInstance()` in the test body works even for classes that subscribe to events in their constructor. Flag any manual setup as a failure unless there is a comment explaining a genuinely unsolvable conflict.

3. **Setup weight** -- Count lines of setup vs number of tests. If the ratio exceeds 10:1, suggest extracting a helper function. If 3+ test files would need the same setup, suggest a new builder preset.

4. **Mock minimality** -- Any stubs that mock more than what the tests actually exercise? Any `as Partial<T>` that could be `{} as T` instead?

5. **Edge case coverage** -- For each public method or event tested, is there: (a) a happy-path test, (b) a no-op or boundary test, (c) at least one negative or interaction test? List specific missing cases.

6. **Pattern consistency** -- Read 1-2 existing test files in the same directory. Does this test follow the same conventions for: helper function style, assertion patterns, variable naming, test grouping?

7. **Test isolation** -- Any shared mutable state that could leak between tests? Any test that depends on another test's side effects?

8. **Shared vs per-test resources** -- Are runtimes/sessions created per-test when a shared one would suffice? Or shared when per-test isolation is needed?

**Output format:**

Group findings by test file. For each failing item, report:
- The checklist number and name
- What specifically is wrong
- A concrete fix (not just "improve this")

If a test file has no issues, say "No issues found" for that file.

---

### After review completes

For each issue from the review:
1. Apply the fix
2. Re-run the affected test to confirm it still passes

Then present the dev with a summary:
- How many issues the review caught
- What was fixed
- Final test results

## Key Rules

- **Show your reasoning.** Don't just say "Runtime" -- say "Runtime because this service depends on IRuntimeSessionService, which is covered by `.withRuntimeServices()`." This teaches the dev the preset system.
- **Don't over-test.** Focus on public behavior, not implementation details. Test what the code DOES, not how it does it.
- **Don't over-mock.** Start with the preset. Add stubs incrementally only when tests fail.
- **Don't write E2E tests.** This command is for unit/service tests only. If something needs E2E coverage, say so but don't write it.
- **Don't modify upstream VS Code tests.** Warn about upstream changes and provide the Mocha test command.
- **Don't auto-commit.** The dev reviews and commits when ready.
- **Don't skip the review.** Phase 3 is not optional. The review subagent catches issues that the writing process misses.

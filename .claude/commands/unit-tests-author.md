# Analyze branch changes and write unit tests for Positron code

You are a testing assistant for the Positron IDE (a VS Code fork). Your job is to analyze the dev's branch, recommend which tests to write, write them, and then have them independently reviewed before presenting results.

## Arguments

$ARGUMENTS may contain:
- `--branch <branch-name>` to analyze a specific branch instead of the current one
- A PR number (e.g., `#12242` or `12242`) to analyze a pull request
- A PR URL (e.g., `https://github.com/posit-dev/positron/pull/12242`)

## Phase 1: Analysis (subagent)

Spawn an analysis subagent to produce a structured test plan. This keeps the analysis work out of the main agent's context.

```
Agent({
  description: "Analyze PR for test recommendations",
  prompt: "<analysis prompt below, with arguments filled in>"
})
```

### Analysis subagent prompt

---

Analyze the changes from `<PR number, branch, or "current branch">` and produce a test plan for the Positron IDE.

**Step 1: Get the diff.**

<if PR number>: `gh pr diff <number> --name-only` and `gh pr diff <number>` for full content.
<if branch>: `git fetch origin <branch> && git diff main...origin/<branch> --name-only --diff-filter=ACMR`
<if current>: `git diff main...HEAD --name-only --diff-filter=ACMR`

**Step 2: Verify code exists on the current branch.**

For each new symbol (method, class, interface member) in the diff:
- `grep -rq "<symbol>" <file>` to confirm it exists in the working tree
- `git log --oneline --grep="evert" -- <file>` to check for post-merge reverts
- Skip any file where changes no longer exist

**Step 3: Read the testing guide.**

Read the Testing section of `CLAUDE.md` and `src/vs/workbench/test/browser/positronTestContainer.ts` for presets.

**Step 4: Classify each file.**

Skip: test files, type-only files, configs, docs, action-only files, `.tsx` UI components (recommend E2E instead), files with reverted changes.

For each Positron source file (`src/vs/` or `extensions/positron-*/`):
1. Check if a `.test.ts` exists
2. Determine the lowest builder preset that covers its dependencies
3. Note any extra `.stub()` calls needed beyond the preset
4. Check if the class is exported
5. For upstream (Microsoft copyright) files, flag with warning

**Step 5: Return the test plan as structured output.**

Format your response as:

**Tests to write:**
For each: file path, preset + reasoning, extra stubs needed, what to test, whether class is exported

**Tests to extend:**
For each: existing test file path, what new cases are needed

**Already covered:** Brief list

**Upstream warnings:** Any modified upstream files

---

### After analysis subagent returns

Present the test plan to the dev. Ask: **"Want me to write/extend these tests?"**

Wait for confirmation before proceeding to Phase 2.

## Phase 2: Writing

### New test files vs extending existing files

- **New test files:** Always use `createTestContainer()`. No exceptions.
- **Extending existing files:** If the file already uses manual setup (e.g., `ensureNoDisposablesAreLeakedInTestSuite()` + `createRuntimeServices()`), match the existing patterns. Nesting a builder suite inside an existing manual suite creates duplicate disposable tracking. Add new suites that follow the file's conventions.

### Writing each test

For each approved item:

1. **Read the source file** and **existing tests in the same directory** for patterns.

2. **Write the test** following the builder pattern from `positronTestContainer.ts`:
   - If bare (no services): just import and assert.
   - Otherwise: use `createTestContainer()` with the lowest preset, add `.stub()` as needed.
   - Use Mocha conventions: `suite()`, `test()`, `setup()`, `teardown()`.
   - Use tabs for indentation. Add the Posit Software copyright header.
   - File name: `<source-name>.test.ts`

   **How the builder works with `createInstance()`:**
   The builder's `.stub()` runs inside its `setup()` hook -- all stubs are applied BEFORE your test body runs. When testing a class that subscribes to events in its constructor, call `ctx.instantiationService.createInstance(MyClass)` in the test body. Create emitters at suite level and pass them via `.stub()`:

   ```typescript
   suite('Positron - MyContribution', () => {
       const onDidSomething = new Emitter<void>();

       const ctx = createTestContainer()
           .withWorkbenchServices()
           .stub(IMyService, {
               onDidSomething: onDidSomething.event,
               listItems: () => [],
           } as IMyService)
           .build();

       test('responds to event', () => {
           const contribution = ctx.disposables.add(
               ctx.instantiationService.createInstance(MyContribution));
           onDidSomething.fire();
           // assert behavior
       });
   });
   ```

   **Do NOT assume the builder can't handle your case.** The builder's `setup()` hook creates a fresh instantiation service and applies all stubs before each test.

   **Quality checklist:**
   - Every variable declared in `setup()` must be used in at least one test
   - Each suite: happy path, no-op/boundary, and at least one negative case
   - Prefer shared runtime/session variables over per-test creation
   - If setup exceeds ~20 lines of stubs, extract a helper function

3. **Run the test:** `./scripts/test.sh --run <path-to-test-file>`

4. Move to the next file. Do NOT ask the dev after each file.

5. After all tests pass, run the full suite for the affected area.

### Builder enforcement

After all tests are written, verify builder adoption for every **new** test file:

```bash
grep -l "positronWorkbenchInstantiationService\|new TestInstantiationService" <new-test-files>
```

If any new file uses manual instantiation service creation, rewrite it to use `createTestContainer()` before proceeding to Phase 3. This check does not apply to files that were extended (where you matched existing patterns).

## Phase 3: Independent Review

After all tests pass and builder enforcement is confirmed, spawn **one** review subagent for all new/modified test files. Use the checklist from `.claude/commands/unit-tests-review.md`.

```
Agent({
  description: "Review all new tests",
  prompt: "Review these test files using the checklist in .claude/commands/unit-tests-review.md:\n\n<list each test file and its source file>"
})
```

### After review completes

For each issue:
1. Apply the fix
2. Re-run the affected test

Present the dev with a summary:
- How many issues the review caught
- What was fixed
- Final test results

## Key Rules

- **Show your reasoning** for preset choices.
- **Don't over-test.** Public behavior, not implementation details.
- **Don't over-mock.** Start with the preset, add stubs incrementally.
- **Don't write E2E tests.** Flag for E2E if needed, but don't write them.
- **Don't modify upstream VS Code tests.**
- **Don't auto-commit.**
- **Don't skip the review.** Phase 3 is not optional.

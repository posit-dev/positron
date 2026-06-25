---
name: author-vitest-tests
description: Use when writing or adding Vitest tests for Positron src/vs/ code, checking a branch/PR for test-coverage gaps, or testing React components with RTL.
---

# Positron Vitest Test Authoring

Write tests for Positron source code, then have them independently reviewed.

## Arguments

$ARGUMENTS may contain:
- A file path (e.g., `src/vs/.../myComponent.tsx`) -- write tests for this specific file
- `--branch <branch-name>` to analyze all changes on a branch
- A PR number (e.g., `#12242` or `12242`) to analyze a pull request
- A PR URL (e.g., `https://github.com/posit-dev/positron/pull/12242`)

## Phase 1: Branch/PR Analysis

**Skip this phase** if the argument is a specific source file path -- go directly to Phase 2 Prepare.

Run this phase when the argument is a branch name, PR number, or PR URL, or the user asks "what tests should I write?" without naming a file. Spawn an analysis subagent to produce a structured test plan -- this keeps the analysis work out of the main agent's context.

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
- `git log --oneline --grep="revert" -- <file>` to check for post-merge reverts
- Skip any file where changes no longer exist

**Step 3: Read the testing guide.**

Read the Testing section of `CLAUDE.md` (the "Where should I put my test?" decision table), `.claude/rules/vitest-tests.md` for core patterns, and the JSDoc on `PositronTestContainerBuilder` in `src/vs/test/vitest/positronTestContainer.ts` for presets. For React component work, also read `.claude/rules/vitest-rtl.md`.

**Step 4: Classify each file.**

Skip: test files, type-only files, configs, docs, action-only files, files with reverted changes.

For each Positron source file in `src/vs/`:
1. Determine the test pattern using the CLAUDE.md decision table:
   - Pure function/class, no services -> **Plain test**
   - Service/class needing DI -> **Builder** (`createTestContainer()`)
   - React component (`.tsx`) with props only -> **RTL prop-driven** (`setupRTLRenderer()`)
   - React component using `usePositronReactServicesContext()` -> **RTL service-context** (`withReactServices()` + `setupRTLRenderer(() => ctx.reactServices)`)
2. Check if a `.vitest.ts` or `.vitest.tsx` already exists
3. Determine the lowest builder preset that covers its dependencies
4. Note any extra `.stub()` calls needed beyond the preset
5. Check if the class is exported
6. For upstream (Microsoft copyright) files, flag with warning

**Step 5: Return the test plan as structured output.**

Format your response as:

**Tests to write:**
For each: file path, pattern (plain/builder/RTL prop-driven/RTL service-context), preset + reasoning (why this is the lowest viable preset -- name the key dependencies that require it), extra stubs needed, what to test, whether class is exported

**Tests to extend:**
For each: existing test file path, current preset + why it's sufficient (or what changes are needed), what new cases are needed

**Already covered:** Brief list

**Upstream warnings:** Any modified upstream files

---

### After analysis subagent returns

Present the test plan to the dev. Ask: **"Want me to write/extend these tests?"**

Wait for confirmation before proceeding to Phase 2.

## Phase 2: Writing

### Prepare

Gather the context you need before drafting the plan:

1. **Read the source file** and 1-2 existing tests in the same directory for patterns.
2. **Check the "Where should I put my test?" decision table** in [`CLAUDE.md`](../../../CLAUDE.md#testing):
   - First, confirm Vitest is the right category for this source. If the table points at Core Mocha, Extension Host Mocha, or E2E Playwright, stop -- this skill can't help; tell the dev which test type fits.
   - Second, within Vitest, use the same table to pick the pattern: plain / builder / RTL prop-driven / RTL service-context.
3. **Skim the builder JSDoc** in `src/vs/test/vitest/positronTestContainer.ts` for preset method names and hierarchy. Start low and let errors guide you up.

### Draft the test plan and confirm with the dev (MANDATORY)

**Before writing any test code, present a plan and wait for explicit confirmation.** This lets the dev steer scope before effort is sunk -- drop cases they don't care about, add cases you missed, reshape groupings to match how the feature is actually used.

Format the plan like this:

> **Plan for `<file>`:**
>
> **Pattern: `<plain / builder / RTL prop-driven / RTL service-context>`**
>
> <One-sentence reasoning grounded in what you observed in the source file -- e.g., "the component takes `contextMenuService` as a prop and neither it nor its child Button uses `usePositronReactServicesContext`". Cite specific evidence (prop shapes, context-hook usage, service dependencies). Do not give generic reasoning like "this is a React component".>
>
> **Preset:** `createTestContainer()` + a preset method from `positronTestContainer.ts` (see JSDoc for the current list; pick the lowest that covers your dependencies).
>
> **Stubs:** short list of services you intend to stub, with a one-line reason each
>
> **Test cases:** (annotate tests that will use `toMatchInlineSnapshot()` with `[snapshot]`)
> - **<describe block 1>**
>   - <test name 1>
>   - <test name 2> `[snapshot]`
> - **<describe block 2>**
>   - <test name 3>
>   - <test name 4> `[snapshot]`
>
> Total: <bullet count> tests (<snapshot count> snapshots). Anything you want added, dropped, or reshaped before I write?

Then **stop and wait for confirmation** ("looks good", "go ahead", "yes", or a revision request). Do not proceed to write tests until the dev responds.

If the dev asks for changes, revise the plan and re-present. Repeat until confirmed.

**Do not skip this step, even when:**
- The component looks simple and the cases seem obvious
- Phase 1 already returned an approved test plan (Phase 1 is file-level scoping; this is case-level)
- You are running under `/loop` or any autonomous mode -- pause anyway

### Writing each test

For each approved item:

1. **Write the test** following the conventions in [`.claude/rules/vitest-tests.md`](../../rules/vitest-tests.md) (file layout, `/// <reference>`, assertions, builder usage, inline snapshots). For React tests, also follow [`.claude/rules/vitest-rtl.md`](../../rules/vitest-rtl.md). Authoring-specific quality bar:
   - Each describe block: happy path, boundary case, and at least one negative case.
   - If setup exceeds ~20 lines of stubs, extract a helper function.
   - Minimize imports: if you're importing 5+ service identifiers just for `.stub()` calls, extract a helper.

2. **Run the test:** `npx vitest run <path-to-test-file>`. Iterate on missing stubs per the "start low, let errors guide you up" pattern in the rules file's Builder section.

3. **Type-check the file:** `npm run test:positron:check-ts 2>&1 | grep '<test-file-name>.vitest.ts'`. This surfaces strict TypeScript errors (overload compatibility, missing properties on stubs, etc.) that `npx vitest run` does NOT catch — the output matches what the VS Code Problems pane shows. The file must be clean before considering it done.

4. **Check coverage** for React component tests: `npx vitest run --coverage --coverage.include='**/sourceFile.tsx' <path-to-test-file>`

5. **For React tests**, run `npx eslint <file>` before considering it done -- `eslint-plugin-testing-library` enforces most of the RTL conventions.

6. Move to the next file. Do NOT ask the dev after each file.

7. After all tests pass, run the full Vitest suite: `npm run test:positron`

### Builder enforcement

After all tests are written, verify builder adoption for every **new** test file:

```bash
grep -l "positronWorkbenchInstantiationService\|new TestInstantiationService" <new-test-files>
```

If any new file uses manual instantiation service creation, rewrite it to use `createTestContainer()` before proceeding to Phase 3. This check does not apply to files that were extended (where you matched existing patterns).

## Phase 3: Independent Review

After all tests pass and builder enforcement is confirmed, spawn **one** review subagent for all new/modified test files. Use the checklist from `.claude/skills/review-vitest-tests/SKILL.md`.

```
Agent({
  description: "Review all new tests",
  prompt: "Review these test files using the checklist in .claude/skills/review-vitest-tests/SKILL.md:\n\n<list each test file and its source file>"
})
```

### After review completes

For each issue:
1. Apply the fix
2. Re-run the affected test: `npx vitest run <path-to-test-file>`
3. Re-run the full suite: `npx vitest run`

Present the dev with a summary:
- How many issues the review caught
- What was fixed
- Final test results (pass count, coverage if applicable)

## Hard rules

- **Test for regressions, not coverage.** Before writing any test, state what user-visible or system-observable regression it guards against. If you can't answer, skip the test. A test that verifies an internal counter, array index, or call count — where the real invariant is a downstream side-effect — is testing structure, not behavior. Coverage is a side-effect of good tests, not a goal.
- **Don't over-test.** Test public behavior, not implementation details.
- **Don't export internals for testing.** Test behavior through rendered output or public API.
- **Don't write E2E tests.** Flag for E2E if needed, but don't write them.
- **Don't modify upstream VS Code tests.**
- **Don't auto-commit.**

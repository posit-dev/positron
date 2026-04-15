---
name: author-vitest-tests
description: Use when writing, generating, or adding Vitest tests for Positron source code in src/vs/. Load this skill when analyzing a branch or PR for test coverage gaps, when the user asks to write tests using createTestContainer(), or when testing React components with RTL.
---

# Positron Vitest Test Authoring

Analyze the dev's branch, recommend which tests to write, write them, and then have them independently reviewed before presenting results.

## Arguments

$ARGUMENTS may contain:
- `--branch <branch-name>` to analyze a specific branch instead of the current one
- A PR number (e.g., `#12242` or `12242`) to analyze a pull request
- A PR URL (e.g., `https://github.com/posit-dev/positron/pull/12242`)

## Phase 1: Analysis (subagent)

**Shortcut:** If the user points at a specific file or component (e.g., "write tests for emptyConsole.tsx"), skip Phase 1 entirely. Read the source file, determine the pattern from the CLAUDE.md decision table, and go straight to Phase 2.

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

Read the Testing section of `CLAUDE.md` (the "Where should I put my test?" decision table and "The Builder" section) and the JSDoc on `PositronTestContainerBuilder` in `src/vs/workbench/test/browser/positronTestContainer.ts` for presets.

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

### Choosing the right pattern

Use the CLAUDE.md decision table. Summary:

| What you're testing | Pattern | File extension |
|---|---|---|
| Pure function, no services | Plain test | `.vitest.ts` |
| Service/class needing DI | Builder | `.vitest.ts` |
| React component, props only | RTL prop-driven | `.vitest.tsx` |
| React component using context | RTL service-context | `.vitest.tsx` |

### Writing each test

For each approved item:

1. **Read the source file** and **existing tests in the same directory** for patterns.

2. **Write the test** following the appropriate pattern:

   **Common rules for ALL patterns:**
   - Use Vitest conventions: `describe()`, `it()`, `beforeEach()`, `afterEach()`, `beforeAll()`, `afterAll()`.
   - Add `/// <reference types="vitest/globals" />` after the copyright header.
   - Use tabs for indentation. Add the Posit Software copyright header.
   - File name: `<source-name>.vitest.ts` (or `.vitest.tsx` for React components).
   - Place the test in `test/browser/` adjacent to the source module. If no test directory exists, create `test/browser/`. Some modules use `tests/` (plural) -- match what exists.
   - The builder handles `ensureNoLeakedDisposables()` automatically -- do NOT add it yourself.
   - Use `expect()` assertions, not `assert`.

   **Plain test** (no services):
   ```typescript
   describe('buildUpdateUrl', () => {
       it('includes language params', () => {
           const result = buildUpdateUrl(baseUrl, ['python'], true, undefined);
           expect(result).toBe(`${baseUrl}?python=1`);
       });
   });
   ```

   **Builder test** (needs services):
   ```typescript
   describe('MyService', () => {
       const onDidSomething = new Emitter<void>();

       const ctx = createTestContainer()
           .withWorkbenchServices()
           .stub(IMyService, {
               onDidSomething: onDidSomething.event,
               listItems: () => [],
           } as Partial<IMyService>)
           .build();

       it('responds to event', () => {
           const contribution = ctx.disposables.add(
               ctx.instantiationService.createInstance(MyContribution));
           onDidSomething.fire();
           // assert behavior
       });
   });
   ```

   **RTL prop-driven** (React component with props):
   ```tsx
   describe('MyLabel', () => {
       const rtl = setupRTLRenderer();

       it('renders text', () => {
           rtl.render(<MyLabel text="hello" />).getByText('hello');
       });
   });
   ```

   **RTL service-context** (React component using `usePositronReactServicesContext()`):
   ```tsx
   describe('MyComponent', () => {
       const emitter = new Emitter<SomeEvent>();
       const ctx = createTestContainer()
           .withReactServices()
           .stub(IMyService, {
               someProperty: initialValue,
               onDidChange: emitter.event,
           } as Partial<IMyService>)
           .build();
       const rtl = setupRTLRenderer(() => ctx.reactServices);

       it('renders initial state', () => {
           const { container } = rtl.render(<MyComponent />);
           expect(container.textContent).toContain('expected text');
       });

       it('updates when event fires', () => {
           const { container } = rtl.render(<MyComponent />);
           act(() => { emitter.fire(newValue); });
           expect(container.textContent).toContain('updated text');
       });
   });
   ```

   **How the builder works with `createInstance()`:**
   The builder's `.stub()` runs inside its `beforeEach()` hook -- all stubs are applied BEFORE your test body runs. When testing a class that subscribes to events in its constructor, call `ctx.instantiationService.createInstance(MyClass)` in the test body. Create emitters at describe level and pass them via `.stub()`.

   **Do NOT assume the builder can't handle your case.** The builder's `beforeEach()` hook creates a fresh instantiation service and applies all stubs before each test.

   **Quality checklist:**
   - Each describe block: happy path, boundary case, and at least one negative case
   - Prefer `toMatchInlineSnapshot()` for complex rendered output -- Vitest auto-fills on first run with `--update`
   - If setup exceeds ~20 lines of stubs, extract a helper function
   - **Minimize imports.** If you're importing 5+ service identifiers just for `.stub()` calls, extract a helper. Use `Event.None` for events the test never fires.
   - For React tests: use RTL queries (`getByText`, `getByRole`) over `container.querySelector` when possible

3. **Run the test:** `npx vitest run <path-to-test-file>`

4. **Check coverage** for React component tests:
   `npx vitest run --coverage --coverage.include='**/sourceFile.tsx' <path-to-test-file>`

5. Move to the next file. Do NOT ask the dev after each file.

6. After all tests pass, run the full Vitest suite: `npx vitest run`

### Builder enforcement

After all tests are written, verify builder adoption for every **new** test file:

```bash
grep -l "positronWorkbenchInstantiationService\|new TestInstantiationService" <new-test-files>
```

If any new file uses manual instantiation service creation, rewrite it to use `createTestContainer()` before proceeding to Phase 3. This check does not apply to files that were extended (where you matched existing patterns).

## Phase 3: Independent Review

After all tests pass and builder enforcement is confirmed, spawn **one** review subagent for all new/modified test files. Use the checklist from `.claude/skills/review-unit-tests/SKILL.md`.

```
Agent({
  description: "Review all new tests",
  prompt: "Review these test files using the checklist in .claude/skills/review-unit-tests/SKILL.md:\n\n<list each test file and its source file>"
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

## Key Rules

- **Show your reasoning** for preset and pattern choices.
- **Don't over-test.** Public behavior, not implementation details.
- **Don't over-mock.** Start with the preset, add stubs incrementally.
- **Don't export internals for testing.** Test behavior through rendered output or public API.
- **Don't write E2E tests.** Flag for E2E if needed, but don't write them.
- **Don't modify upstream VS Code tests.**
- **Don't auto-commit.**
- **Don't skip the review.** Phase 3 is not optional.

# audit-test-coverage Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Positron-scoped Claude Code skill (`audit-test-coverage`) that analyzes a code diff, feature area, or existing test and produces a cross-bucket test coverage audit (with explicit per-item verdicts and confidence), plus opt-in handoff to `author-vitest-tests` / `author-e2e-tests`.

**Architecture:** Single prose artifact — one `SKILL.md` file at `.claude/skills/audit-test-coverage/SKILL.md` in the Positron repo. No code, no tests, no build step. The skill is instructions Claude Code loads and follows at runtime. Verification is an integration-level dry-run against a real PR at the end of the plan, not a TDD cycle per section.

**Tech Stack:** Markdown skill file with YAML frontmatter. Runtime dependencies: Positron repo post-#13033 (Vitest infrastructure, renamed skills, new CLAUDE.md Testing table), `gh` CLI, Glob/Grep tools available in Claude Code.

**Source spec:** `docs/superpowers/specs/2026-04-19-plan-test-coverage-design.md` (filename retains the original brainstorm slug; spec content reframed to `audit-test-coverage` on 2026-04-29).

---

## Task 1: Verify prerequisites

**Files:** none created/modified. Environment checks only.

- [ ] **Step 1: Confirm PR #13033 state**

Run: `gh pr view 13033 --repo posit-dev/positron --json state,mergeCommit,baseRefName`
Expected: `state` is `MERGED`, and the current branch's base contains the merge. If `state` is still `OPEN`, pause and ask the user whether to proceed on the PR branch (`mi/vitest-rtl-pr2`) or wait for merge.

- [ ] **Step 2: Confirm adjacent skills exist on the target branch**

Run: `ls .claude/skills/author-vitest-tests/SKILL.md .claude/skills/review-vitest-tests/SKILL.md .claude/skills/author-e2e-tests/SKILL.md`
Expected: all three files present. If any missing, pause — the skill's handoffs won't work without them.

- [ ] **Step 3: Confirm CLAUDE.md Testing section is the post-#13033 version**

Run: Grep the Testing section of `CLAUDE.md` for the string `Positron Vitest`.
Expected: match found (the post-#13033 Testing section references "Positron Vitest"). If no match, the repo is pre-#13033 — pause.

- [ ] **Step 4: Confirm `audit-test-coverage` directory does not already exist**

Run: `ls .claude/skills/audit-test-coverage 2>/dev/null`
Expected: "No such file or directory" — we're not clobbering an existing skill.

No commit this task.

---

## Task 2: Scaffold the skill file with frontmatter

**Files:**
- Create: `.claude/skills/audit-test-coverage/SKILL.md`

- [ ] **Step 1: Create the skill directory**

Run: `mkdir -p .claude/skills/audit-test-coverage`
Expected: directory created, no output.

- [ ] **Step 2: Write the frontmatter + H1 header**

Write to `.claude/skills/audit-test-coverage/SKILL.md`:

```markdown
---
name: audit-test-coverage
description: Use to audit test coverage for a Positron change — review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. Triggers include "audit coverage for <feature>", "is my test placement right", "quality-check before merge", "are these e2e tests carrying their weight", "what coverage does this PR need", or as part of pre-PR review. Produces a cross-bucket test coverage audit (Core Mocha / Vitest / Extension host / E2E) with explicit verdicts (Keep / Move down / Move up / Split / Add / Delete / Skip) and confidence per item. Optionally orchestrates handoff to author-vitest-tests and author-e2e-tests.
---

# Audit Test Coverage (Positron)

Audit a Positron change — review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. The report is the deliverable. Bias hard against E2E: push coverage down the pyramid unless the test genuinely needs the full app. Hand off to the right author-* skill only if the dev opts in.
```

- [ ] **Step 3: Verify the file parses as valid YAML frontmatter**

Run: `head -5 .claude/skills/audit-test-coverage/SKILL.md`
Expected: three lines between `---` delimiters showing `name`, `description`, no YAML syntax errors (no tabs in frontmatter, no unquoted colons inside values).

- [ ] **Step 4: Commit the scaffold**

```bash
git add .claude/skills/audit-test-coverage/SKILL.md
git commit -m "feat(skills): scaffold audit-test-coverage skill"
```

---

## Task 3: Write Arguments + Starting/Target state

**Files:**
- Modify: `.claude/skills/audit-test-coverage/SKILL.md` (append)

- [ ] **Step 1: Append the Arguments section**

Append to `.claude/skills/audit-test-coverage/SKILL.md`:

````markdown

## Arguments

`$ARGUMENTS` accepts six entry points; the workflow shape varies by what you target.

- **Source file** (e.g., `src/vs/.../myComponent.tsx`) — find existing tests that reference this file and audit each; identify gaps in new coverage. Both halves of the report populated.
- **Test file** (e.g., `test/e2e/tests/console/console-clear.test.ts`, `src/vs/.../foo.vitest.ts`, `extensions/positron-r/src/test/foo.test.ts`) — the test IS the subject. Skip Step 2 (no source changes to enumerate). Step 4 is the whole job: trace assertions, run 4B-verify, produce a verdict for the test. The "New coverage needed" half is empty unless the trace surfaces an underlying gap.
- **Test directory** (e.g., `test/e2e/tests/notebooks-positron/`) — sweep audit; same workflow as test-file repeated across files in the directory.
- **`--branch <branch-name>`** — analyze all changes on a branch vs `main`. Audit tests for every changed source file.
- **PR number** (e.g., `#12242` or `12242`) or **PR URL** — same as `--branch`, resolved via `gh pr diff`.
- **Freeform feature area** (e.g., "console clear handling") — search for anchor files; if ambiguous, ask the dev. Resolves to one of the above. Counts as 1 of 2 allowed clarifying questions.

Test-as-target is a first-class entry point — it codifies the per-test inspection pattern for any test, on demand.
````

- [ ] **Step 2: Append Starting state + Target state**

Append:

````markdown

## Starting state

- The dev has one of the inputs above and wants to know where tests should live.
- Adjacent skills exist and MUST be used for the writing step, not re-implemented here: `author-vitest-tests`, `author-e2e-tests`, `review-vitest-tests`.
- CLAUDE.md Testing section (post-#13033) is authoritative for the decision table. Read it at the start of every run.

## Target state

A test coverage audit the dev has reviewed, with each item carrying an explicit verdict (`Keep` / `Move down` / `Move up` / `Split` / `Add` / `Delete` / `Skip`) and confidence (`high` / `medium` / `low`). The dev either (a) approves and hands off to an `author-*` skill, (b) queues a move proposal for human follow-up, or (c) explicitly skips. This skill writes no test files itself.
````

- [ ] **Step 3: Read back the section to check formatting**

Read `.claude/skills/audit-test-coverage/SKILL.md`. Confirm:
- Only one H1 (`# Audit Test Coverage (Positron)`).
- Arguments section uses backticks on `$ARGUMENTS` and file paths.
- No trailing whitespace on list items.

No commit this task — wait until end of Task 4 to keep commits meaningful.

---

## Task 4: Write Workflow steps 1-3

**Files:**
- Modify: `.claude/skills/audit-test-coverage/SKILL.md` (append)

- [ ] **Step 1: Append Workflow header + Step 1 (resolve input)**

Append:

````markdown

## Workflow

### Step 1. Resolve input → concrete subject (silent)

- **Source file** → read it directly. Subject = the source file.
- **Test file** → read it directly. Subject = the test file. Workflow shifts: skip Step 2; Step 4 is the deliverable.
- **Test directory** → list test files in the directory. Subject = the set of test files. Workflow shifts as for test-file, repeated.
- **PR** → `gh pr view <n> --json files,title,body`, then `gh pr diff <n>`. Subject = changed source files.
- **`--branch <name>`** → `git fetch origin <name> && git diff main...origin/<name>`. Subject = changed source files.
- **Freeform feature area** → search for anchor files (Glob/Grep); if ambiguous, ask the dev. Resolves to one of the above. Counts as 1 of 2 clarifying questions.

Report a one-line summary of what was gathered, including which entry-point shape applies, before continuing.
````

- [ ] **Step 2: Append Step 2 (enumerate behaviors)**

Append:

````markdown

### Step 2. Enumerate testable behaviors

**Skip this step entirely if the input is a test file or test directory** — there are no source changes to enumerate. Go straight to Step 4 (audit), which becomes the deliverable.

For source-file / branch / PR / feature-area inputs: for each changed file/symbol, list discrete behaviors that merit a test. Skip: pure renames, type-only edits, comment-only changes, trivial glue, config, docs, action-only files, files with reverted changes.
````

- [ ] **Step 3: Append Step 3 (classify into bucket)**

Append:

````markdown

### Step 3. Classify each behavior into a bucket

Read the Testing section of `CLAUDE.md` at the start of every run. It is the single source of truth for the decision table. Apply the table in order; stop at the first match.

Tiebreakers beyond the table:
- **Lowest bucket that covers the behavior wins.**
- **If in doubt between two buckets, pick the lower one** and note the reasoning. The dev can override at the gate.
````

- [ ] **Step 4: Commit progress**

```bash
git add .claude/skills/audit-test-coverage/SKILL.md
git commit -m "feat(skills): audit-test-coverage args, state, workflow steps 1-3"
```

---

## Task 5: Write Workflow step 4 (audit with assertion-level trace)

**Files:**
- Modify: `.claude/skills/audit-test-coverage/SKILL.md` (append)

- [ ] **Step 1: Append Step 4 header + scoping block**

Append:

````markdown

### Step 4. Audit existing coverage

**Scoping the audit.** Scope depends on entry point:

- **Source / branch / PR / feature-area input:** "Existing tests in the area under review" = test files that reference any source file in the changeset (grep for import paths or symbol names), plus test files co-located with the changed source files.
- **Test-file input:** scope is exactly that one test file. Audit it as the subject.
- **Test-directory input:** scope is every test file in the directory. Audit each.

Four test surfaces to scan (when source-driven):

- Vitest: `src/**/*.vitest.ts`, `src/**/*.vitest.tsx` — Positron unit, first-class audit target.
- E2E Playwright: `test/e2e/tests/**/*.test.ts` — first-class audit target for move proposals.
- Extension host Mocha: `extensions/<name>/src/test/**/*.test.ts` — first-class audit target for move proposals.
- **Upstream Core Mocha: `src/vs/**/test/**/*.test.ts` and `*.integrationTest.ts` without Positron copyright headers — awareness-only.** Never propose moves, deletions, or modifications. Surface for duplication/gap detection only.

If scope expands beyond ~20 test files, paginate: audit the closest-matching 20 first and note that wider audit is available on request. If no tests are found in scope, omit the Existing coverage section of the report.

**Upstream coverage awareness.** For each upstream Core Mocha test in scope, record: path, which changed source files it references, and a one-line summary of what it asserts. If a proposed Vitest item's behavior overlaps an upstream assertion, flag the overlap inline (e.g., "upstream already asserts X at `<path>:L42`") so the dev can decide whether the Vitest test is redundant, complementary, or Positron-specific.
````

- [ ] **Step 2: Append the central audit question + Step 4A**

Append:

````markdown

**Central question for every Positron-authored e2e or ext-host test in scope:**

> **"What is this test actually asserting, and COULD/SHOULD that assertion be made directly against the underlying unit?"**

**Step 4A. Enumerate assertions.** Read the test file; list each `expect()`, `toHaveText`, `toBeVisible`, `toBe` call at the assertion level, not the test level.
````

- [ ] **Step 3: Append Step 4B (trace)**

Append:

````markdown

**Step 4B. Trace each assertion to the code responsible for it.**
- A text-match on formatted output → the formatter function.
- A visibility assertion that depends on component state → the component's render logic.
- A value in a data structure → the service method or reducer that produced it.
- A UI path that boils down to "this function returned X" → the function itself.
````

- [ ] **Step 4: Append Step 4B-verify (ownership confirmation — the most reliable false-positive filter)**

Append:

````markdown

**Step 4B-verify. Confirm ownership of the traced code.** This substep is the most reliable false-positive filter the skill has — apply it to every traced code path before counting it as unit-testable.

For each path the trace lands on:

1. **`./scripts/file-origin.sh <path>`** — if the file is upstream-owned (no Positron copyright header), verdict is `Keep` with reason "upstream behavior, upstream's tests."
2. **Webview ownership** — grep the file/area for `registerWebviewViewProvider`, `WebviewView`, `iframe`, or check whether the assertion's UI is contributed by a webview-rendering extension (e.g., `markdown-language-features`, `positron-viewer`, external Quarto extension). If yes, verdict is `Keep` with reason "webview content cannot render in happy-dom."
3. **Multi-window markers** — calls into `IWindowsMainService`, `auxiliaryWindow`, or test descriptions like "open in new window" / "move to new window." If yes, verdict is `Keep` with reason "inherently e2e."

If any check hits, set verdict = `Keep` with `confidence: high` and record the ownership reason inline in the report. Show the trace + reason so the dev can spot-check.

Why: source-pattern matching produces false positives — `MenuId.X` mentions in a Positron source file do not necessarily correspond to the buttons the e2e clicks. Ownership verification turns the most common Partial-overlap mistake into a correct `Keep` verdict.
````

- [ ] **Step 5: Append Step 4C (COULD and SHOULD)**

Append:

````markdown

**Step 4C. Apply COULD and SHOULD per assertion.**

*COULD it move down?* Is the responsible unit reachable in the lower bucket?
- Pure function → yes, Vitest plain.
- Service with DI → yes, Vitest builder.
- React render → yes, Vitest RTL.
- Component that only fires inside a full app via OS-level keyboard + focus state → no, legitimately e2e.

*SHOULD it move down?* Concrete cost signals at the current placement:
- Runtime cost: the e2e spins a whole session/window to assert one value check.
- Flakiness exposure: timing-sensitive UI waits for what is deterministic at the unit level.
- Coverage redundancy: a unit test already exists — the e2e duplicates that assertion through a ~10× slower path.
- Assertion is about data shape/format, not user experience.
````

- [ ] **Step 6: Append Step 4D (classify the test as a whole) + verdict vocabulary + universal confidence**

Append:

````markdown

**Step 4D. Classify the test as a whole.**
- **Move down fully** — every assertion could and should move lower. Propose a replacement at the lower bucket; flag the original for deletion (dev-driven).
- **Move up** — *rare.* The current bucket can't faithfully exercise what the test asserts; the test belongs higher. Almost always confidence `medium` or `low` because move-up is detected from negative signals (heavy stubbing, mismatch between assertions and unit behavior). Always paired with an "alternative" line in the report — sometimes the right fix is to rewrite at the current bucket with less mocking, not to move up.
- **Split** — some assertions are genuinely cross-system, others are unit-level value checks. Propose moving the unit-level subset down; keep the cross-system subset.
- **Keep** — assertions genuinely depend on full-app integration, OS-level input, multi-pane state, or real runtime output not reproducible under unit conditions.
- **Delete** — test asserts upstream Monaco/VS Code behavior, or duplicates coverage that already exists at the right level.

**Signals an assertion may belong UP a bucket** (rare, weak signals):
- Vitest test stubs ≥5 fundamental services (`ICommandService`, `IRuntimeSessionService`, `IExtensionService`, etc.) and the assertions are about cross-service interactions, not the unit's own outputs.
- RTL test asserts behavior that depends on real browser semantics: native drag-drop, focus traversal across multiple elements, multi-window, real timer-driven UX, scroll-into-view, IntersectionObserver.
- Ext-host test uses `vscode.window.createWindow` / asserts cross-pane workflows that span the chrome.
- The test passes today but a known bug in the same code path doesn't reproduce — strong hint the test isn't really exercising the integration.

When any of these hit, surface the candidate with verdict `Move up → <bucket>` AND an alternative ("rewrite at current bucket with less mocking" / "delete and write at higher bucket"). Confidence rarely exceeds `medium`.

**Signals an assertion SHOULD move down:** test/describe names include "validates", "parses", "formats", "transforms", "computes", "renders when", "returns", "detects"; assertions compare strings, numbers, or small structures; a unit test already covers the same behavior; the assertion has nothing to do with user perception.

**Signals an assertion legitimately STAYS in e2e:** user-visible cross-pane outcomes; real runtime output not mockable at the unit level; OS/window-level behavior (focus, keyboard shortcuts, file watcher races); documented regressions that only reproduce full-stack.

**Verdict vocabulary** (used on every item in the report):
- `Keep` — coverage is correctly placed at this level. Includes ownership-verified Keeps from 4B-verify.
- `Move down → <bucket>` — coverage belongs lower; full move proposed.
- `Move up → <bucket>` — coverage belongs higher (rare). Always paired with an alternative.
- `Split` — some assertions move, some stay.
- `Add` — new coverage needed at this level.
- `Delete` — duplicate or upstream-owned; no replacement needed.
- `Skip` — not worth testing (docs, glue, reverted, type-only).

**Confidence per verdict** (applies to every verdict, not just moves):
- **high** — verdict is structural. Ownership-verified `Keep`. All-assertions-trace `Move down`. Clearly Vitest-shaped `Add`. Mechanical `Skip` / `Delete`.
- **medium** — verdict involves judgment. `Split` where assertions span layers cleanly but the boundary needs a human eye. `Add` where the bucket is fuzzy. Most `Move up` cases.
- **low** — verdict is technically defensible but payoff is small. Often surfaces as "low-confidence flag" the dev can ignore.
````

- [ ] **Step 7: Commit progress**

```bash
git add .claude/skills/audit-test-coverage/SKILL.md
git commit -m "feat(skills): audit-test-coverage audit workflow (step 4 + 4B-verify + verdict vocab)"
```

---

## Task 6: Write Workflow steps 5-6 (gate + opt-in handoff)

**Files:**
- Modify: `.claude/skills/audit-test-coverage/SKILL.md` (append)

- [ ] **Step 1: Append Step 5 (present report + hybrid gate)**

Append:

````markdown

### Step 5. Present the report and gate on dev feedback

Output the report using the Output format template below. Then ask exactly two questions:

1. *"For each item above: approve / change bucket / skip? Reply per-line (e.g., `approve all except 3,7`) or 'approve all'."*
2. *"Any testable behavior I missed?"*

Stop. Wait for the dev. Do not proceed without a response.
````

- [ ] **Step 2: Append Step 6 (opt-in handoff)**

Append:

````markdown

### Step 6. Opt-in handoff

After the dev's response at step 5, ask:

> *"Want me to invoke `/author-vitest-tests` for approved Vitest items and `/author-e2e-tests` for approved E2E items? (yes / no / partial: list IDs). Move proposals get a separate yes/no per move."*

- **No** → end. The report is the deliverable.
- **Yes / partial** → iterate approved items. **Per-file handoff only** — never pass a PR number or branch to `author-vitest-tests` (would re-run its Phase 1 and drift from the plan). Stop between handoffs and summarize what was produced before starting the next.
- **Ext-host items** are never auto-invoked; surfaced with pattern hints only.
- **Move proposals (e2e → Vitest):** each gets its own explicit confirmation: *"Draft the replacement Vitest test via `/author-vitest-tests` and flag the original e2e for deletion?"* — yes/no per move. Deletions are never performed by this skill.

**Context carry-forward on handoff:**
- For new additions: pass just the file path. `author-vitest-tests`' Phase 2 plan-first gate is where test cases are chosen.
- For e2e → Vitest move proposals: pass the file path plus a one-line behavioral hint as free-form prose in `$ARGUMENTS`, e.g., *"Covers behaviors currently asserted in `test/e2e/.../console-clear.test.ts`: detects `\f` trigger, no-ops on partial sequence."*
````

- [ ] **Step 3: Commit progress**

```bash
git add .claude/skills/audit-test-coverage/SKILL.md
git commit -m "feat(skills): audit-test-coverage gate + handoff (steps 5-6)"
```

---

## Task 7: Write Output format

**Files:**
- Modify: `.claude/skills/audit-test-coverage/SKILL.md` (append)

- [ ] **Step 1: Append the Output format intro + template**

Append:

````markdown

## Output format

The report is ordered bottom-up through the test pyramid (Core Mocha → Vitest → Extension host → E2E) in both sections. This mirrors how the dev should think about coverage: "what do we already have at the cheapest level?" before "what do we need higher up?"

```
# Test coverage audit — <scope summary>

Gathered: <PR/branch/files summary, one line>
Analyzed: <N source files>, <M existing test files>

## Existing coverage

### Core Mocha (upstream, awareness only, read-only) — N items
- `src/vs/platform/.../someUpstreamThing.test.ts` — references `<changed-file>`; asserts `<one-line summary>`. **Overlaps** with proposed Vitest item #7 (`detects \f trigger`). Dev decides whether the Vitest test is still needed.
- `src/vs/editor/.../anotherUpstream.test.ts` — references `<changed-file>`; asserts `<one-line summary>`. No overlap with proposed coverage.

### Vitest (Positron unit) — N items
- `<path>` — Keep (confidence: high). <one-line why>.

(Vitest is the pyramid floor for Positron code — no Move-down category.)

#### `<path>` — Move up → Ext host (confidence: medium) [rare]
Stubs `ICommandService`, `IRuntimeSessionService`, `IExtensionService`, `INotificationService`, `IConfigurationService`. Assertions are about end-to-end command dispatch, not the orchestrator's internal state.
Alternative: rewrite this Vitest with less mocking if the orchestrator's behavior in isolation is what's worth testing. Dev decides.

### Extension host (Mocha) — N items

- `<path>` — Keep (confidence: high). Uses `vscode.workspace.openTextDocument`, legitimately ext host.

#### `<path>` — Move down → Vitest (confidence: high)
Assertions (all move):
- L18 `expect(fmt.render(...)).toBe(...)` → traces to `fmt.render()` — Vitest plain

Proposed replacement: Vitest test for `src/vs/.../fmt.ts` covering the assertion above.
Original: flag for deletion after replacement verified by dev.

### E2E (Playwright) — N items

- `<path>` — Keep (confidence: high). Cross-pane workflow (console → variables → data explorer).

- `editor-action-bar-document-files.test.ts` — Keep (confidence: high). Hypothesis-verification trace:
  - "Preview" button → `markdown-language-features` extension (webview)
  - "Open in viewer" → `positron-viewer` (webview)
  - "Split editor" → upstream `editorCommands.ts` (`file-origin: upstream`)
  - "Move into new window" → `IWindowsMainService` (multi-window)
  Every assertion is e2e-only by construction.

#### `<path>` — Move down → Vitest (confidence: high, full move)
Assertions (all move):
- L23 `expect(parser.detect(...)).toBe(...)` → traces to `clearHandler.detect()` — Vitest plain
- L41 `expect(consoleState).toBe('cleared')` → traces to `consoleReducer` — Vitest builder

Proposed replacement: Vitest test for `src/vs/.../clearHandler.ts` covering both assertions.
Original: flag for deletion after replacement verified by dev.

#### `<path>` — Split (confidence: medium)
Assertions that move → Vitest:
- L15 `expect(formatter.format(...)).toBe(...)` → Vitest plain
Assertions that stay (e2e):
- L32 cross-pane check (console → variables) — legitimate e2e
Proposed: draft Vitest for the formatter; trim e2e to the cross-pane subset.

### Low-confidence flags (FYI, ignore freely) — N items
- [ext host → vitest] `<path>` — Move down (confidence: low). Only one weak signal, listed for awareness.

## New coverage needed

### Vitest (Positron unit) — N items
- `src/vs/.../<file>.ts` :: <behavior> — Add (confidence: high). <pattern hint: plain / builder / RTL>, <one-line reason>.

### Extension host (flag only, no auto-handoff) — N items
- `extensions/<name>/...` :: <behavior> — Add (confidence: high). <pattern: mirror sibling test in <path>>.

### E2E — N items
- `<user workflow>` — Add (confidence: high). <reason this belongs in e2e>.

## Skip
- `<file>` — Skip (confidence: high). Docs-only / type-only / reverted / upstream / action-only.

---

## Summary
- Add: <V vitest, E ext-host-flag, 2 e2e>
- Move down: <H high, M medium, L low>
- Move up: <N> (rare; review carefully)
- Split: <N>
- Keep: <N> (of which X verified via hypothesis-verification trace)
- Delete / Skip: <N>
- Upstream awareness: <U items, X overlaps>
- Total dev decisions at the gate: <sum of approvals needed>
```
````

- [ ] **Step 2: Append formatting rules**

Append:

````markdown

**Formatting rules:**
- Line-number references (`L23`) only when the test file has actually been read.
- Paths are project-relative, no leading `./`.
- Every line carries an explicit verdict (`Keep` / `Move down` / `Move up` / `Split` / `Add` / `Delete` / `Skip`) and a confidence band (`high` / `medium` / `low`). No verdict-less items.
- Hypothesis-verification trace is shown inline for any `Keep` produced by 4B-verify so the dev can spot-check.
- Low-confidence flags are listed under their own heading and called out as optional.
- Items are numbered across the whole report (`1`…`N`) so the dev can reply `approve all except 3,7,12`.
````

- [ ] **Step 3: Commit progress**

```bash
git add .claude/skills/audit-test-coverage/SKILL.md
git commit -m "feat(skills): audit-test-coverage output format"
```

---

## Task 8: Write Guardrails + Notes

**Files:**
- Modify: `.claude/skills/audit-test-coverage/SKILL.md` (append)

- [ ] **Step 1: Append the Guardrails section**

Append:

````markdown

## Guardrails

Hard rules the skill never violates:

- Do NOT write, edit, move, rename, or delete test files directly. All writes go through `author-*` skills; deletions are dev-driven.
- Do NOT run direct TypeScript compilation (`npx tsc`, `tsc --noEmit`, etc.) — per Positron's `CLAUDE.md`.
- Do NOT start build daemons unless the dev explicitly asks (e.g., `npm run build-start`).
- Do NOT run tests (Vitest, Playwright, ext-host).
- Do NOT ask more than 2 clarifying questions before presenting the report.
- Do NOT chain handoffs silently — stop after each `author-*` invocation and summarize.
- Do NOT pass a PR number or branch to `author-vitest-tests` during handoff — always per-file.
- Do NOT propose moves, deletions, or modifications to upstream Core Mocha tests (`src/vs/**/test/**/*.test.ts` without Positron copyright headers). They are read-only; surface them for awareness only.
- If the dev response at step 5 is ambiguous, ask once for clarification; if still ambiguous, default to "skip everything not clearly approved."
````

- [ ] **Step 2: Append the Notes / references section**

Append:

````markdown

## Notes / references

- **`CLAUDE.md` Testing section** — decision table is source of truth; the skill re-reads it at the start of every run.
- **`.claude/rules/vitest-tests.md`** — Vitest patterns and conventions.
- **`src/vs/test/vitest/positronTestContainer.ts`** — JSDoc on `PositronTestContainerBuilder` covers preset hierarchy.
- **`./scripts/file-origin.sh`** — used in 4B-verify to determine Positron vs upstream ownership of a code path.
- **Sibling skills this one coordinates with:** `author-vitest-tests`, `review-vitest-tests`, `author-e2e-tests`.
- **Prior art:** the 2026-04-28 one-off e2e → Vitest audit (tracking docs at `~/.claude/projects/-Users-marieidleman-Develop-positron/migration-tracking/`) is the manual version of what this skill operationalizes. The audit's methodology, findings, and reusable migration recipe inform 4B-verify and the verdict vocabulary.
````

- [ ] **Step 3: Read the full file top-to-bottom**

Read `.claude/skills/audit-test-coverage/SKILL.md`. Spot-check:
- Only one H1.
- All sections in order: frontmatter, H1, intro, Arguments, Starting state, Target state, Workflow (6 steps), Output format, Guardrails, Notes/references.
- No `TBD`, `TODO`, `...to be determined`.
- Backticks closed consistently; no stray fenced blocks.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/audit-test-coverage/SKILL.md
git commit -m "feat(skills): audit-test-coverage guardrails + notes"
```

---

## Task 9: Self-review pass against spec

**Files:** none modified directly; edits only if drift is found.

- [ ] **Step 1: Diff the skill file against the spec's output format section**

Manually compare the Output format template in `.claude/skills/audit-test-coverage/SKILL.md` with the one in `docs/superpowers/specs/2026-04-19-plan-test-coverage-design.md`. Confirm byte-level equivalence of the code block (pyramid order, every-line verdicts + confidence, Move up example, Summary line).
Expected: identical. If not, Edit the skill file to match the spec.

- [ ] **Step 2: Confirm each spec decision appears in the skill**

Spec has seven key decisions (per the Decisions table):
1. Approach 1.5 (report-first, opt-in handoff).
2. Ext-host flag-only.
3. Hybrid feedback format (structured per-item + open-ended tail).
4. Per-file handoff to `author-vitest-tests`.
5. Reframed to "audit" with explicit verdict vocabulary (Keep / Move down / Move up / Split / Add / Delete / Skip).
6. 4B-verify ownership-confirmation substep (file-origin.sh + webview/upstream/multi-window grep).
7. Confidence band on every verdict (high/medium/low), not just moves.

For each, grep the skill file for the corresponding phrase:
- `grep -F "report is the deliverable" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "flag only, no auto-handoff" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "approve all except" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "Per-file handoff only" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "Move up" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "4B-verify" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "file-origin.sh" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "Confidence per verdict" .claude/skills/audit-test-coverage/SKILL.md`

Expected: every grep matches. If any miss, Edit to add.

Also confirm test-as-target entry points are documented:
- `grep -F "Test file" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "Test directory" .claude/skills/audit-test-coverage/SKILL.md`
- `grep -F "Skip this step entirely if the input is a test file" .claude/skills/audit-test-coverage/SKILL.md`

- [ ] **Step 3: Placeholder scan**

`grep -En "TBD|TODO|XXX|FIXME|<TBD>|\.\.\.to be determined" .claude/skills/audit-test-coverage/SKILL.md`
Expected: no matches.

- [ ] **Step 4: Type/name consistency check**

Confirm the skill references only skill names that exist in the repo: `author-vitest-tests`, `review-vitest-tests`, `author-e2e-tests`. The old names (`author-unit-tests`, `review-unit-tests`) must NOT appear.

`grep -En "author-unit-tests|review-unit-tests" .claude/skills/audit-test-coverage/SKILL.md`
Expected: no matches.

No commit this task — it's a review pass. If edits were needed, commit them:

```bash
git add .claude/skills/audit-test-coverage/SKILL.md
git commit -m "fix(skills): audit-test-coverage self-review corrections"
```

---

## Task 10: Dry-run verification against a real PR

**Files:** none modified. Behavioral smoke test.

This is the closest thing to a "test" for a prose skill. The skill loads and runs; we inspect the output.

- [ ] **Step 1: Pick a representative PR**

Good candidates: a recent merged PR that touched ≥1 `src/vs/` file, ≥1 `test/e2e/` file, and has modest scope (<15 changed files). E.g., PR #13080 (R console clear) or similar. Ask the user for a candidate if unsure.

Record the chosen PR number.

- [ ] **Step 2: Reload Claude Code with the new skill present**

In a fresh Claude Code session (new chat) in this worktree, confirm the skill appears in the available skills list. Type `/audit-test-coverage` — it should be discoverable. If not, the frontmatter is malformed or the directory is in the wrong place.

- [ ] **Step 3: Invoke the skill on the chosen PR**

Type: `/audit-test-coverage <PR-number>`
Expected: the skill runs, produces a report matching the Output format template. Watch for:
- Does it gather the diff correctly? (one-line summary appears)
- Does it classify into Core Mocha / Vitest / Ext host / E2E in pyramid order?
- Does it audit existing coverage?
- Does it stop after presenting the report and ask the two hybrid-feedback questions?
- Does it ask the opt-in handoff question after the dev response?

- [ ] **Step 4: Record drift from spec**

If the actual output diverges from the spec template (section order wrong, sections missing, different questions asked, auto-handoff without consent, etc.), note each instance. For each:
- Identify the responsible section in the skill file.
- Edit the skill to tighten the instruction.

- [ ] **Step 5: Re-run on the same PR after any edits**

Fresh Claude Code session, same PR number. Confirm each drift is resolved.

- [ ] **Step 6: Commit any verification fixes**

```bash
git add .claude/skills/audit-test-coverage/SKILL.md
git commit -m "fix(skills): audit-test-coverage dry-run corrections"
```

If no drift was found, no commit.

---

## Task 11: Final polish and PR

**Files:**
- `.claude/skills/audit-test-coverage/SKILL.md` (final review)

- [ ] **Step 1: Precommit check**

Run: `npm run precommit -- .claude/skills/audit-test-coverage/SKILL.md`
Expected: passes (no unicode punctuation — Positron's precommit hook blocks em-dashes, smart quotes, etc.). If failures, fix inline and re-run.

- [ ] **Step 2: Confirm commit history is clean**

Run: `git log --oneline origin/main..HEAD -- .claude/skills/audit-test-coverage/`
Expected: a handful of logical commits (scaffold → args/state → workflow steps 1-3 → step 4 → steps 5-6 → output → guardrails → any fixes). Each commit compiles standalone.

- [ ] **Step 3: Decide on PR scope**

Ask the user: should this ship as its own PR, or stacked on #13033? Stacking makes sense because the skill depends on #13033's renamed skills and new CLAUDE.md table. Standalone makes sense if #13033 has already merged by now.

- [ ] **Step 4: Open the PR (if approved)**

If standalone: push branch, `gh pr create` with body referencing the spec and plan files.
If stacked: create branch off #13033's head or rebase onto `main` after #13033 merges.

Wait for user direction before executing.

---

## Out of scope for this plan

The following are acknowledged in the spec but explicitly NOT part of this implementation:

- **`author-ext-host-tests` sibling skill.** Ext-host handoff is flag-only by design; a future plan would add authoring.
- **Coverage-parity verification on moves.** Spec says this is human judgment; no automated tooling in v1.
- **Integration with `review-vitest-tests` post-handoff.** The review subagent is owned by `author-vitest-tests`; we don't consume or amend its output.
- **Measuring pyramid shift over time.** Success-criteria metric is informal (spot audits); no telemetry added.

These are tracked in the spec's "Open items / future work" section.

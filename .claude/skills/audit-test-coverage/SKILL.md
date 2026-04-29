---
name: audit-test-coverage
description: Use to audit test coverage for a Positron change - review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. Triggers include "audit coverage for <feature>", "is my test placement right", "quality-check before merge", "are these e2e tests carrying their weight", "what coverage does this PR need", or as part of pre-PR review. Produces a cross-bucket test coverage audit (Core Mocha / Vitest / Extension host / E2E) with explicit verdicts (Keep / Move down / Move up / Split / Add / Delete / Skip) and confidence per item. Optionally orchestrates handoff to author-vitest-tests and author-e2e-tests.
---

# Audit Test Coverage (Positron)

Audit a Positron change - review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. The report is the deliverable. Bias hard against E2E: push coverage down the pyramid unless the test genuinely needs the full app. Hand off to the right author-* skill only if the dev opts in.

## Arguments

`$ARGUMENTS` accepts six entry points; the workflow shape varies by what you target.

- **Source file** (e.g., `src/vs/.../myComponent.tsx`) - find existing tests that reference this file and audit each; identify gaps in new coverage. Both halves of the report populated.
- **Test file** (e.g., `test/e2e/tests/console/console-clear.test.ts`, `src/vs/.../foo.vitest.ts`, `extensions/positron-r/src/test/foo.test.ts`) - the test IS the subject. Skip Step 2 (no source changes to enumerate). Step 4 is the whole job: trace assertions, run 4B-verify, produce a verdict for the test. The "New coverage needed" half is empty unless the trace surfaces an underlying gap.
- **Test directory** (e.g., `test/e2e/tests/notebooks-positron/`) - sweep audit; same workflow as test-file repeated across files in the directory.
- **`--branch <branch-name>`** - analyze all changes on a branch vs `main`. Audit tests for every changed source file.
- **PR number** (e.g., `#12242` or `12242`) or **PR URL** - same as `--branch`, resolved via `gh pr diff`.
- **Freeform feature area** (e.g., "console clear handling") - search for anchor files; if ambiguous, ask the dev. Resolves to one of the above. Counts as 1 of 2 allowed clarifying questions.

Test-as-target is a first-class entry point - it codifies the per-test inspection pattern for any test, on demand.

## Starting state

- The dev has one of the inputs above and wants to know where tests should live.
- Adjacent skills exist and MUST be used for the writing step, not re-implemented here: `author-vitest-tests`, `author-e2e-tests`, `review-vitest-tests`.
- CLAUDE.md Testing section (post-#13033) is authoritative for the decision table. Read it at the start of every run.

## Target state

A test coverage audit the dev has reviewed, with each item carrying an explicit verdict (`Keep` / `Move down` / `Move up` / `Split` / `Add` / `Delete` / `Skip`) and confidence (`high` / `medium` / `low`). The dev either (a) approves and hands off to an `author-*` skill, (b) queues a move proposal for human follow-up, or (c) explicitly skips. This skill writes no test files itself.

## Workflow

### Step 1. Resolve input -> concrete subject

(No clarifying questions during this step except the one allowed for ambiguous freeform feature areas. Output the one-line summary at the end.)

- **Source file** -> read it directly. Subject = the source file.
- **Test file** -> read it directly. Subject = the test file. Workflow shifts: skip Step 2; Step 4 is the deliverable.
- **Test directory** -> list test files in the directory. Subject = the set of test files. Workflow shifts as for test-file, repeated.
- **PR** -> `gh pr view <n> --json files,title,body`, then `gh pr diff <n>`. Subject = changed source files.
- **`--branch <name>`** -> `git fetch origin <name> && git diff main...origin/<name>`. Subject = changed source files.
- **Freeform feature area** -> search for anchor files (Glob/Grep); if ambiguous, ask the dev. Resolves to one of the above. Counts as 1 of 2 clarifying questions.

Report a one-line summary of what was gathered, including which entry-point shape applies, before continuing.

### Step 2. Enumerate testable behaviors

**Skip this step entirely if the input is a test file or test directory** - there are no source changes to enumerate. Go straight to Step 4 (audit), which becomes the deliverable.

For source-file / branch / PR / feature-area inputs: for each changed file/symbol, list discrete behaviors that merit a test. Skip: pure renames, type-only edits, comment-only changes, trivial glue, config, docs, action-only files, files with reverted changes.

### Step 3. Classify each behavior into a bucket

(Skip this step if the input is a test file or test directory - there are no enumerated behaviors to classify; go straight to Step 4.)

Read the Testing section of `CLAUDE.md` at the start of every run. It is the single source of truth for the decision table. Apply the table in order; stop at the first match.

Tiebreakers beyond the table:
- **Lowest bucket that covers the behavior wins.**
- **If in doubt between two buckets, pick the lower one** and note the reasoning. The dev can override at the gate.

### Step 4. Audit existing coverage

**Scoping the audit.** Scope depends on entry point:

- **Source / branch / PR / feature-area input:** "Existing tests in the area under review" = test files that reference any source file in the changeset (grep for import paths or symbol names), plus test files co-located with the changed source files.
- **Test-file input:** scope is exactly that one test file. Audit it as the subject.
- **Test-directory input:** scope is every test file in the directory. Audit each.

Four test surfaces to scan (when source-driven):

- Vitest: `src/**/*.vitest.ts`, `src/**/*.vitest.tsx` - Positron unit, first-class audit target.
- E2E Playwright: `test/e2e/tests/**/*.test.ts` - first-class audit target for move proposals.
- Extension host Mocha: `extensions/<name>/src/test/**/*.test.ts` - first-class audit target for move proposals.
- **Upstream Core Mocha: `src/vs/**/test/**/*.test.ts` and `*.integrationTest.ts` without Positron copyright headers - awareness-only.** Never propose moves, deletions, or modifications. Surface for duplication/gap detection only.

If scope expands beyond ~20 test files, paginate: audit the closest-matching 20 first and note that wider audit is available on request. If no tests are found in scope, omit the Existing coverage section of the report.

**Upstream coverage awareness.** For each upstream Core Mocha test in scope, record: path, which changed source files it references, and a one-line summary of what it asserts. If a proposed Vitest item's behavior overlaps an upstream assertion, flag the overlap inline (e.g., "upstream already asserts X at `<path>:L42`") so the dev can decide whether the Vitest test is redundant, complementary, or Positron-specific.

**Central question for every Positron-authored e2e or ext-host test in scope:**

> **"What is this test actually asserting, and COULD/SHOULD that assertion be made directly against the underlying unit?"**

**Step 4A. Enumerate assertions.** Read the test file; list each `expect()`, `toHaveText`, `toBeVisible`, `toBe` call at the assertion level, not the test level.

**Step 4B. Trace each assertion to the code responsible for it.**
- A text-match on formatted output -> the formatter function.
- A visibility assertion that depends on component state -> the component's render logic.
- A value in a data structure -> the service method or reducer that produced it.
- A UI path that boils down to "this function returned X" -> the function itself.

**Step 4B-verify. Confirm ownership of the traced code.** This substep is the most reliable false-positive filter the skill has - apply it to every traced code path before counting it as unit-testable.

For each path the trace lands on:

1. **`./scripts/file-origin.sh <path>`** - if the file is upstream-owned (no Positron copyright header), verdict is `Keep` with reason "upstream behavior, upstream's tests."
2. **Webview ownership** - grep the file/area for `registerWebviewViewProvider`, `WebviewView`, `iframe`, or check whether the assertion's UI is contributed by a webview-rendering extension (e.g., `markdown-language-features`, `positron-viewer`, external Quarto extension). If yes, verdict is `Keep` with reason "webview content cannot render in happy-dom."
3. **Multi-window markers** - calls into `IWindowsMainService`, `auxiliaryWindow`, or test descriptions like "open in new window" / "move to new window." If yes, verdict is `Keep` with reason "inherently e2e."
4. **Native popup / context-menu markers** - calls into `showCustomContextMenu`, `IContextMenuService.showContextMenu`, `actions/contextMenu`, or any popup positioned via `IContextViewService`. These render through real DOM/positioning that happy-dom cannot simulate. If the e2e drives interaction through such a menu (right-click, "More Actions" popup, dropdown menu, etc.), verdict is `Keep` with reason "popup menu UI not happy-dom-friendly."

If any check hits, set verdict = `Keep` with `confidence: high` and record the ownership reason inline in the report.

**Cluster-detection rule for anonymous action classes.** When a trace lands on an anonymous `registerAction2(class extends Action2 { ... })` block (no exported class name), do NOT stop at the single class the e2e exercises. Grep the same file for ALL `registerAction2` calls and identify sibling anonymous actions with the same shape (same MenuId, same ID prefix, same group). All siblings share the same coverage gap; surface them as a single Add cluster, not just the ones the e2e happened to hit. Example: an e2e exercising `insertCodeCellAbove` should cause the skill to enumerate `insertCodeCellAbove`, `insertCodeCellBelow`, `insertMarkdownCellAbove`, `insertMarkdownCellBelow`, `insertRawCellAbove`, `insertRawCellBelow` if they are registered in the same file with the same pattern. The Add verdict's "What changes" line should mention the cluster ("promote 6 anonymous Insert{Code,Markdown,Raw}Cell{Above,Below} actions to named exports + add wiring vitests"), not just the single action.

**Report-side wording (do NOT use "4B-verify" in the user-facing report):**
- For `Keep` verdicts produced by ownership check: label the section **"Why it stays:"** and write **one summary line** describing where ownership lands (e.g., *"8 assertions, all owned by markdown-language-features (webview)"*). Show full per-assertion trace only if the dev replies `expand <N>`.
- For `Move down` / `Split` / `Move up` verdicts: label the section **"Trace:"** and show the per-assertion enumeration in full. The dev needs the detail to judge the move.

Why: source-pattern matching produces false positives - `MenuId.X` mentions in a Positron source file do not necessarily correspond to the buttons the e2e clicks. Ownership verification turns the most common Partial-overlap mistake into a correct `Keep` verdict.

**Step 4C. Apply COULD and SHOULD per assertion.**

*COULD it move down?* Is the responsible unit reachable in the lower bucket?
- Pure function -> yes, Vitest plain.
- Service with DI -> yes, Vitest builder.
- React render -> yes, Vitest RTL.
- Component that only fires inside a full app via OS-level keyboard + focus state -> no, legitimately e2e.

*SHOULD it move down?* Concrete cost signals at the current placement:
- Runtime cost: the e2e spins a whole session/window to assert one value check.
- Flakiness exposure: timing-sensitive UI waits for what is deterministic at the unit level.
- Coverage redundancy: a unit test already exists - the e2e duplicates that assertion through a ~10x slower path.
- Assertion is about data shape/format, not user experience.

**Step 4D. Classify the test as a whole.**
- **Move down fully** - every assertion could and should move lower. Propose a replacement at the lower bucket; flag the original for deletion (dev-driven).
- **Move up** - *rare.* The current bucket can't faithfully exercise what the test asserts; the test belongs higher. Almost always confidence `medium` or `low` because move-up is detected from negative signals (heavy stubbing, mismatch between assertions and unit behavior). Always paired with an "alternative" line in the report - sometimes the right fix is to rewrite at the current bucket with less mocking, not to move up.
- **Split** - some assertions are genuinely cross-system, others are unit-level value checks. Propose moving the unit-level subset down; keep the cross-system subset.
- **Keep** - assertions genuinely depend on full-app integration, OS-level input, multi-pane state, or real runtime output not reproducible under unit conditions.
- **Delete** - test asserts upstream Monaco/VS Code behavior, or duplicates coverage that already exists at the right level.

**Signals an assertion may belong UP a bucket** (rare, weak signals):
- Vitest test stubs >=5 fundamental services (`ICommandService`, `IRuntimeSessionService`, `IExtensionService`, etc.) and the assertions are about cross-service interactions, not the unit's own outputs.
- RTL test asserts behavior that depends on real browser semantics: native drag-drop, focus traversal across multiple elements, multi-window, real timer-driven UX, scroll-into-view, IntersectionObserver.
- Ext-host test uses `vscode.window.createWindow` / asserts cross-pane workflows that span the chrome.
- The test passes today but a known bug in the same code path doesn't reproduce - strong hint the test isn't really exercising the integration.

When any of these hit, surface the candidate with verdict `Move up -> <bucket>` AND an alternative ("rewrite at current bucket with less mocking" / "delete and write at higher bucket"). Confidence rarely exceeds `medium`.

**Signals an assertion SHOULD move down:** test/describe names include "validates", "parses", "formats", "transforms", "computes", "renders when", "returns", "detects"; assertions compare strings, numbers, or small structures; a unit test already covers the same behavior; the assertion has nothing to do with user perception.

**Signals an assertion legitimately STAYS in e2e:** user-visible cross-pane outcomes; real runtime output not mockable at the unit level; OS/window-level behavior (focus, keyboard shortcuts, file watcher races); documented regressions that only reproduce full-stack.

**Verdict vocabulary** (used on every item in the report):
- `Keep` - coverage is correctly placed at this level. Includes ownership-verified Keeps from 4B-verify.
- `Move down -> <bucket>` - coverage belongs lower; full move proposed.
- `Move up -> <bucket>` - coverage belongs higher (rare). Always paired with an alternative.
- `Split` - some assertions move, some stay.
- `Add` - new coverage needed at this level.
- `Delete` - duplicate or upstream-owned; no replacement needed.
- `Skip` - not worth testing (docs, glue, reverted, type-only).

**Confidence per verdict** (applies to every verdict, not just moves):
- **high** - verdict is structural. Ownership-verified `Keep`. All-assertions-trace `Move down`. Clearly Vitest-shaped `Add`. Mechanical `Skip` / `Delete`.
- **medium** - verdict involves judgment. `Split` where assertions span layers cleanly but the boundary needs a human eye. `Add` where the bucket is fuzzy. Most `Move up` cases.
- **low** - verdict is technically defensible but payoff is small. Often surfaces as "low-confidence flag" the dev can ignore.

### Step 5. Present the report and gate on dev feedback

Output the report using the Output format template below. The presentation mode depends on **action-item count** (Move down / Move up / Split / Add — NOT Keep / Skip / Delete, which the table already conveys):

- **1-2 action items:** "inline-dump" mode. After the at-a-glance table, render all action items in compact form, then ask the gate questions once.
- **3+ action items:** "step-through" mode. After the at-a-glance table, render action items one at a time in **trace-hidden form** (4 lines: ID + path, Verdict, What changes, prompt). Ask `approve / change <verdict> / skip / expand <N> ?`. If the dev replies `expand <N>`, re-render that item with the full trace block, then re-ask. Otherwise advance to the next item. After the last action item, summarize decisions ("3/3 processed: 3 approved, 0 changed, 0 skipped"), then ask any global gate questions.

Mode is auto-selected from the action-item count. The dev can override at any point:
- `dump all` — switch from step-through to inline-dump (show remaining items at once).
- `step through` — switch from inline-dump to step-through.
- `approve all remaining` (in step-through mode) — auto-approve everything that hasn't been visited yet.

In both modes, end with the same global question:

> *"Any testable behavior I missed?"*

Stop. Wait for the dev. Do not proceed without a response.

### Step 6. Opt-in handoff

After the dev's response at step 5, ask:

> *"Want me to invoke `/author-vitest-tests` for approved Vitest items and `/author-e2e-tests` for approved E2E items? (yes / no / partial: list IDs). Move proposals get a separate yes/no per move."*

- **No** -> end. The report is the deliverable.
- **Yes / partial** -> iterate approved items. **Per-file handoff only** - never pass a PR number or branch to `author-vitest-tests` (would re-run its Phase 1 and drift from the plan). Stop between handoffs and summarize what was produced before starting the next.
- **Ext-host items** are never auto-invoked; surfaced with pattern hints only.
- **Move proposals (e2e -> Vitest):** each gets its own explicit confirmation: *"Draft the replacement Vitest test via `/author-vitest-tests` and flag the original e2e for deletion?"* - yes/no per move. Deletions are never performed by this skill.

**Context carry-forward on handoff:**
- For new additions: pass just the file path. `author-vitest-tests`' Phase 2 plan-first gate is where test cases are chosen.
- For e2e -> Vitest move proposals: pass the file path plus a one-line behavioral hint as free-form prose in `$ARGUMENTS`, e.g., *"Covers behaviors currently asserted in `test/e2e/.../console-clear.test.ts`: detects `\f` trigger, no-ops on partial sequence."*

## Output format

The report is ordered bottom-up through the test pyramid (Core Mocha -> Vitest -> Extension host -> E2E) in both sections. This mirrors how the dev should think about coverage: "what do we already have at the cheapest level?" before "what do we need higher up?"

```
# Test coverage audit - <scope summary>

Gathered: <PR/branch/files summary, one line>
Analyzed: <N source files>, <M existing test files>

## TL;DR

<1-3 sentence narrative recommendation. State the bottom line: how many items, what verdict pattern dominates, and what they all share.>

Example: *3 items audited. Recommendation: move down 2 to Vitest (medium confidence), keep 1. All move-down candidates trace to NotebookInstance model state; would extend `notebookCells.vitest.ts`.*

## At a glance

| ID  | Test :: scenario                          | Verdict             | Conf.  | Why                                                |
|-----|-------------------------------------------|---------------------|--------|----------------------------------------------------|
| [1] | <test-file-shortname> :: <scenario>       | Move down -> Vitest | high   | already covered in `notebookDelete.vitest.ts`      |
| [2] | <test-file-shortname> :: <scenario>       | Split               | medium | clipboard half is e2e; rest covered                |
| [3] | <test-file-shortname> :: <scenario>       | Keep                | high   | webview-rendered (markdown-language-features)      |

(Use the test-file's basename + describe/it scenario as the row label so the table stays scannable. Long full paths belong only in the per-item detail below.)

After the table, only **action items** (`Move down` / `Move up` / `Split` / `Add`) need a per-item display. `Keep` / `Skip` / `Delete` verdicts are conveyed by the table alone and auto-approved; the dev can `details N` if they want to challenge one. Display mode for action items depends on count (Step 5 governs this):
- 1-2 action items -> inline-dump (show all; one gate question at the end).
- 3+ action items -> step-through (one item per turn).

## Existing coverage

### Core Mocha (upstream, awareness only, read-only) - N items
- `src/vs/platform/.../someUpstreamThing.test.ts` - references `<changed-file>`; asserts `<one-line summary>`. **Overlaps** with proposed Vitest item #7 (`detects \f trigger`). Dev decides whether the Vitest test is still needed.
- `src/vs/editor/.../anotherUpstream.test.ts` - references `<changed-file>`; asserts `<one-line summary>`. No overlap with proposed coverage.

Each item below uses the same compact layout. Path on its own line, verdict on the next, then sub-detail. Items are separated by `---` for scannability.

### Vitest (Positron unit) - N items

**[1]** `<path>`
**Verdict:** Keep (confidence: high)
**Why it stays:** <one-line reason>

---

(Vitest is the pyramid floor for Positron code - no Move-down category.)

**[2]** `<path>`
**Verdict:** Move up -> Ext host (confidence: medium) [rare]
**Why:** Stubs 5+ fundamental services; assertions are about cross-service dispatch, not the unit's own outputs.
**Alternative:** rewrite this Vitest with less mocking if orchestrator-in-isolation is what's worth testing.

---

### Extension host (Mocha) - N items

**[3]** `<path>`
**Verdict:** Keep (confidence: high)
**Why it stays:** uses `vscode.workspace.openTextDocument`, legitimately ext host.

---

**[4]** `<path>`
**Verdict:** Move down -> Vitest (confidence: high)
**Trace** (1 of 1 shown):
- L18 expect(fmt.render(...)) -> `fmt.render()` (Vitest plain)
**What changes:** add Vitest test for `src/vs/.../fmt.ts`; delete original ext-host test after replacement verified.

---

### E2E (Playwright) - N items

**[5]** `<path>`
**Verdict:** Keep (confidence: high)
**Why it stays:** cross-pane workflow (console -> variables -> data explorer).

---

**[6]** `editor-action-bar-document-files.test.ts`
**Verdict:** Keep (confidence: high)
**Why it stays:** 4 helpers, all owned by webview / upstream / multi-window code. (Reply `expand 6` for full trace.)

---

**[7]** `<path>`
**Verdict:** Move down -> Vitest (confidence: high, full move)
**Trace** (2 of 6 shown; reply `expand 7` for full):
- L23 expect(parser.detect(...)) -> `clearHandler.detect()` (Vitest plain)
- L41 expect(consoleState).toBe('cleared') -> `consoleReducer` (Vitest builder)
- ...4 more, all hitting the parser + reducer layer.
**What changes:** add Vitest test for `src/vs/.../clearHandler.ts` covering parser + reducer behaviors; delete original e2e after replacement verified.

---

**[8]** `<path>`
**Verdict:** Split (confidence: medium)
**Moves to Vitest:**
- L15 expect(formatter.format(...)) -> `formatter.format()` (Vitest plain)
**Stays in e2e:**
- L32 cross-pane check (console -> variables)
**What changes:** add Vitest test for the formatter; trim e2e to cover only the cross-pane assertion.

---

### Low-confidence flags (FYI, ignore freely) - N items

**[9]** `<path>` - Move down (confidence: low). Only one weak signal, listed for awareness.

## New coverage needed

### Vitest (Positron unit) - N items

**[10]** `src/vs/.../<file>.ts` :: <behavior>
**Verdict:** Add (confidence: high) - <pattern: plain / builder / RTL>
**Why:** <one-line reason>

---

### Extension host (flag only, no auto-handoff) - N items

**[11]** `extensions/<name>/...` :: <behavior>
**Verdict:** Add (confidence: high) - mirror sibling test in `<path>`

---

### E2E - N items

**[12]** `<user workflow>`
**Verdict:** Add (confidence: high)
**Why:** <reason this belongs in e2e>

---

## Skip

**[13]** `<file>` - Skip (confidence: high). Docs-only / type-only / reverted / upstream / action-only.

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

**Formatting rules:**

**Top-level structure:**
- Always lead with `## TL;DR` (1-3 sentence narrative recommendation) and `## At a glance`. The dev should be able to make 80% of their decisions from these two sections without scrolling further.
- **`## At a glance` MUST be a real GFM markdown table** with `|` separators and a `|---|---|...|` separator row. Never substitute a bulleted list, definition list, labeled `Field: value` blocks, or any other format. If the Why column gets long, that's fine — markdown tables wrap; do NOT bail out of the table format because a row is wide. The literal shape required:

  ```
  | ID  | Test :: scenario | Verdict | Conf. | Why |
  |-----|------------------|---------|-------|-----|
  | [1] | ...              | ...     | ...   | ... |
  ```

- Columns are exactly: `ID` / `Test :: scenario` / `Verdict` / `Conf.` / `Why`. No extra columns, no fewer.
- The at-a-glance table uses the test-file basename + describe/it scenario as the row label (`notebook-cell-action-bar :: Cell deletion`), not the full path. Full paths only in the per-item detail.
- The `Why` column is one short phrase per row (e.g., *"already covered in notebookDelete.vitest.ts"*, *"webview-rendered"*, *"cross-pane workflow"*). Keep it scannable.
- Detailed sections follow in pyramid order (Core Mocha -> Vitest -> Ext host -> E2E), Existing coverage before New coverage needed.

**Display mode (governed by Step 5):**
- The skill auto-selects display mode based on **action-item count** (Move down / Move up / Split / Add — NOT Keep / Skip / Delete).
- 1-2 action items -> inline-dump. After the at-a-glance table, render all action items in compact form back-to-back (full per-item layout including trace). Then ask the gate question once.
- 3+ action items -> step-through. After the at-a-glance table, render one action item per turn in **trace-hidden form** (Verdict + What changes only — NO trace block). Ask `approve / change <verdict> / skip / expand <N> ?`, wait for the dev. If the dev replies `expand <N>`, re-render that item with the full trace, then re-ask. After the last item, summarize ("3/3 processed: 3 approved").
- Trace-hidden step-through item template (4 lines per turn):
  ```
  [N] <test-file basename> :: <scenario>
  Verdict: <Move down -> Vitest> (<confidence>)
  What changes: <one-line action>

  approve / change <verdict> / skip / expand <N> ?
  ```
- `Keep` / `Skip` / `Delete` verdicts are NEVER shown in per-item form by default — the table conveys them. The dev can request `details N` for one of them if they want to challenge it.
- Dev can override mode with `dump all` or `step through` at any point. `dump all` from step-through mode shows the remaining items inline with full trace; `step through` from inline-dump returns to one-per-turn (trace-hidden).

**Per-item layout:**
- Each item uses bold `**[N]**` + path on line 1, then `**Verdict:**`, then ONE of `**Why it stays:**` / `**Why:**` / `**Trace:**`, then `**What changes:**` (for Move/Split/Add). Items are separated by `---`.
- Long source paths go on their own line (`**[N]** `path``), NEVER in an H3 header. Keep H3s at the section level (Vitest / Extension host / E2E), not per-item.
- Line-number references (`L23`) only when the test file has actually been read.
- Paths are project-relative, no leading `./`.
- Every item carries an explicit verdict (`Keep` / `Move down` / `Move up` / `Split` / `Add` / `Delete` / `Skip`) and a confidence band (`high` / `medium` / `low`). No verdict-less items.

**Trace compression (the load-bearing readability rule):**
- **`Keep` verdicts produced by ownership check:** show ONE summary line under `**Why it stays:**` describing where ownership lands (e.g., *"4 helpers, all owned by webview / upstream / multi-window code"*). Do NOT enumerate per-assertion. End with `(Reply `expand <N>` for full trace.)`.
- **`Move down` / `Move up` / `Add` (with traces):** show at most **2 representative assertions** under `**Trace:**`, then a tail line: *"... and N more, all hitting <shared-layer-description>"*. Always end the trace block with `(2 of M shown; reply `expand <N>` for full)` if M > 2.
- **`Split`:** keep the bifurcated `**Moves to Vitest:**` / `**Stays in e2e:**` structure, but apply the same 2-assertion compression to each side.
- **`Add`** items with no existing trace: just show `**Why:**` (one line). No trace block.

**What changes line (one of these per Move/Split/Add):**
- For `Move down`: *"add Vitest test for `<path>`; delete original after replacement verified"*.
- For `Move up`: *"rewrite at higher bucket OR rewrite current Vitest with less mocking"* + a one-line characterization.
- For `Split`: *"add Vitest for <subset>; trim original e2e to <remaining-cross-system-subset>"*.
- For `Add`: *"add <pattern> Vitest at `<path>` covering <one-line behavior>"*.

**Other rules:**
- Low-confidence flags are listed under their own heading and called out as optional, in compact one-line form (path + verdict + reason; no `Why` / `Trace` block).
- Items are numbered across the whole report (`[1]`...`[N]`) so the dev can reply `approve all except 3,7,12` or `expand 6`.

**Handling `expand <N>` requests:**
If the dev replies `expand <N>` (or `expand 6, 8`), reissue just those items with the full per-assertion trace shown under `**Trace:**` (no compression). Don't reprint the rest of the report.

## Guardrails

Hard rules the skill never violates:

- Do NOT write, edit, move, rename, or delete test files directly. All writes go through `author-*` skills; deletions are dev-driven.
- Do NOT run direct TypeScript compilation (`npx tsc`, `tsc --noEmit`, etc.) - per Positron's `CLAUDE.md`.
- Do NOT start build daemons unless the dev explicitly asks (e.g., `npm run build-start`).
- Do NOT run tests (Vitest, Playwright, ext-host).
- Do NOT ask more than 2 clarifying questions before presenting the report.
- Do NOT chain handoffs silently - stop after each `author-*` invocation and summarize.
- Do NOT pass a PR number or branch to `author-vitest-tests` during handoff - always per-file.
- Do NOT propose moves, deletions, or modifications to upstream Core Mocha tests (`src/vs/**/test/**/*.test.ts` without Positron copyright headers). They are read-only; surface them for awareness only.
- If the dev response at step 5 is ambiguous, ask once for clarification; if still ambiguous, default to "skip everything not clearly approved."

## Notes / references

- **`CLAUDE.md` Testing section** - decision table is source of truth; the skill re-reads it at the start of every run.
- **`.claude/rules/vitest-tests.md`** - Vitest patterns and conventions.
- **`src/vs/test/vitest/positronTestContainer.ts`** - JSDoc on `PositronTestContainerBuilder` covers preset hierarchy.
- **`./scripts/file-origin.sh`** - used in 4B-verify to determine Positron vs upstream ownership of a code path.
- **Sibling skills this one coordinates with:** `author-vitest-tests`, `review-vitest-tests`, `author-e2e-tests`.
- **Prior art:** the 2026-04-28 one-off e2e -> Vitest audit (tracking docs at `~/.claude/projects/-Users-marieidleman-Develop-positron/migration-tracking/`) is the manual version of what this skill operationalizes. The audit's methodology, findings, and reusable migration recipe inform 4B-verify and the verdict vocabulary.

---
name: test-audit
description: Use when auditing whether Positron tests are in the right bucket, whether new coverage is needed for a change, or whether existing e2e tests should move down to Vitest. Triggers include "audit coverage for <feature>", "is my test placement right", "are these e2e tests carrying their weight", "what coverage does this PR need", or as part of a pre-PR quality check.
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
- **Test file** -> read it directly. Subject = the test file. (Skip-Step-2 / Step-4-is-deliverable rules live in Step 2 and Step 3.)
- **Test directory** -> list test files in the directory. Subject = the set of test files.
- **PR** -> `gh pr view <n> --json files,title,body`, then `gh pr diff <n>`. Subject = changed source files.
- **`--branch <name>`** -> `git fetch origin <name> && git diff main...origin/<name>`. Subject = changed source files.
- **Freeform feature area** -> search for anchor files (Glob/Grep); if ambiguous, ask the dev. Resolves to one of the above. Counts as 1 of 2 clarifying questions.

Report a one-line summary of what was gathered, including which entry-point shape applies, before continuing.

### Step 2. Enumerate testable behaviors

**Skip this step entirely if the input is a test file or test directory** - there are no source changes to enumerate. Go straight to Step 4 (audit), which becomes the deliverable.

For source-file / branch / PR / feature-area inputs: for each changed file/symbol, list discrete behaviors that merit a test. Skip: pure renames, type-only edits, comment-only changes, trivial glue, config, docs, action-only files, files with reverted changes.

### Step 3. Classify each behavior into a bucket

(Skip if the input is a test file or test directory - no enumerated behaviors to classify; go to Step 4.)

Apply the CLAUDE.md Testing decision table (already read per Starting state). Apply rows in order; stop at the first match.

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
- For `Keep` verdicts (whether produced by ownership check or anything else): the at-a-glance table's `Why` column carries the entire treatment - ONE short phrase per row (e.g., *"popup menu UI not happy-dom-friendly"*, *"already covered in notebookDelete.vitest.ts"*). NO per-item block below the table. Only render a per-item block for a Keep verdict if the dev explicitly replies `details N`.
- For `Move down` / `Split` / `Move up` verdicts: render a per-item block. Label the trace section **"Trace:"** and show the per-assertion enumeration (compressed: 2 representatives + tail).

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

*Is migration worth the cost?* Before proposing Move down, weigh whether the e2e is already causing pain. Migration has overhead (new Vitest, PR review, deletion). If the test is stable and fast, that overhead may exceed the gain. Flag the tradeoff in the step-through so the dev decides:
- **Worth migrating:** test is flaky, slow (>10s), or duplicates coverage already present at a lower level.
- **Marginal:** test is stable and cheap (<5s) but logic is clearly unit-testable. Surface as Move down but note low friction either way.
- **Not worth it:** test is stable, cheap, and the only coverage of the behavior. Keep.

**Step 4D. Classify the test as a whole.**
- **Move down fully** - every assertion could and should move lower. Propose a replacement at the lower bucket; flag the original for deletion (dev-driven).
- **Move up** - *rare.* The current bucket can't faithfully exercise what the test asserts; the test belongs higher. Always paired with an alternative line in the report. See "Signals an assertion may belong UP a bucket" below for detection criteria + confidence rules.
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

Output the report using the Output format template below. **Always step through action items one at a time** (Move down / Move up / Split / Add — NOT Keep / Skip / Delete, which the table already conveys). No threshold-based mode switching, no inline dump by default - even with a single action item, present it on its own turn and wait for the dev's reply.

Step-through behavior:
- After the at-a-glance table, render ONE action item per turn in **trace-hidden form**: EXACTLY 4 content lines — basename + scenario, `Verdict:`, `What changes:`, prompt. **DO NOT include a `Trace:` block, `Why:` block, or any per-assertion enumeration in the default step-through render.** The example layouts shown in the Output format template below depict the EXPANDED form (rendered on `expand <N>` or `dump all` only), not the default step-through.
- Ask `[a] approve  [c] change  [s] skip  [e] expand`. Accept single-letter shortcuts: `a` = approve, `c` = change, `s` = skip, `e` = expand. If the dev replies `e` or `expand <N>`, re-render that item with the full Trace / Why / Moves-to-Vitest / Stays-in-e2e block (whichever applies for the verdict), then re-ask. Otherwise advance to the next item.
- After the last action item, summarize decisions ("N/N processed: X approved, Y changed, Z skipped"), then ask any global gate questions.

Reference template for default step-through render (4 lines + prompt, NO trace):
```
[N] <basename> :: <scenario>
Verdict: <Move down -> Vitest> (<confidence>)
What changes: <one-line action>

[a] approve  [c] change  [s] skip  [e] expand
```

**Move down verdicts add one extra line** — a stability prompt so the dev can weigh migration cost at the gate:
```
[N] <basename> :: <scenario>
Verdict: Move down -> Vitest (high)
What changes: <one-line action>
Stability: Is this e2e currently flaky or slow? If stable and fast, migration may not be worth the overhead.

[a] approve  [c] change  [s] skip  [e] expand
```

Dev overrides:
- `dump all` — escape hatch: render all remaining action items at once with full trace.
- `approve all remaining` — auto-approve everything that hasn't been visited yet.
- `show low-confidence` — reveal suppressed low-confidence items.

End with the global question:

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
- For e2e -> Vitest move proposals: pass the **serialized trace** from Step 4A/4B as a starting hint — include the source file path, each assertion with its line number, the traced function/class, and the Vitest pattern (plain/builder/RTL). `author-vitest-tests` still does its own source-file read, existing-test check, and preset selection; the trace skips redundant assertion-enumeration and surfaces behaviors the e2e already exercised. Note: behaviors the e2e never hit won't appear in the trace — the author skill may surface additional gaps. Example format:

  ```
  Source: src/vs/.../clearHandler.ts
  Replacing: test/e2e/.../console-clear.test.ts
  Trace (starting hint — not exhaustive):
  - L23 expect(parser.detect('\f')).toBe(true) -> clearHandler.detect() — Vitest plain
  - L41 expect(consoleState).toBe('cleared') -> consoleReducer.reduce() — Vitest builder
  - L58 expect(output).toEqual([]) -> clearHandler.flush() — Vitest plain
  ```

## Output format

See [`output-format.md`](output-format.md) for the full report template, per-item layout shapes, trace compression rules, and `expand <N>` handling. Read it before rendering the report.

**Critical constraints (must hold without reading the reference):**
- Lead with `## TL;DR` and `## At a glance`. The table is the only allowed form for At a glance — never a list or labeled blocks. Columns: `ID` / `Test :: scenario` / `Verdict` / `Conf.` / `Why`.
- Keep/Skip/Delete never get per-item blocks. Table `Why` column is their entire treatment.
- Low-confidence items are suppressed by default; summary count only. Dev replies `show low-confidence` to reveal.
- Step through action items one at a time (Step 5 governs display mode).

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

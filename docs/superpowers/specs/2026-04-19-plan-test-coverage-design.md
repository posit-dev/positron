# audit-test-coverage skill — design

Date: 2026-04-19 (revised 2026-04-29: reframed from `plan-test-coverage` to `audit-test-coverage`; added hypothesis-verification substep; applied confidence bands to every verdict)
Author: Marie Idleman
Status: Draft (pending implementation)
Depends on: [PR #13033](https://github.com/posit-dev/positron/pull/13033) (Vitest migration, RTL infrastructure, renamed skills) — merged.

## Problem

Test coverage in Positron drifts upward. When a dev finishes a change, the path of least resistance is often an e2e test — it exercises the behavior end-to-end, it's familiar, and the tooling is well-worn. That works, but it has costs:

- E2E tests are slow and flakier than unit tests by construction.
- They exercise the full app to verify things that are often a pure function, a service method, or a React render.
- Once a behavior is covered at the e2e level, there's rarely a reason to also cover it below — so coverage stays at the wrong level indefinitely.

After #13033 lands, unit tests (Vitest) become fast and pleasant to write, React components have an RTL harness, and there's an authoring skill (`author-vitest-tests`) that takes the mechanical cost out of writing them. The remaining friction is the **decision**: for a given change, where should the tests live? And for existing tests: are they in the right place?

No existing skill answers the cross-bucket placement question or audits existing placement. `author-vitest-tests` already does pattern-level classification *within* Vitest for a PR/branch/file, but it doesn't route across buckets and doesn't touch existing e2e or ext-host tests.

## Goals

1. Given a code diff, branch, PR, file, or feature area, produce a cross-bucket test coverage audit: what new coverage is needed, in which bucket (Vitest / Extension host / E2E), and why.
2. Audit existing tests in the same area for misplacement — specifically, flag e2e tests whose assertions *could and should* be made at a lower level.
3. Gate any writing or moving on explicit dev approval.
4. Optionally orchestrate handoff to `author-vitest-tests` and `author-e2e-tests` so the skill can be a one-stop shop when the dev wants action; otherwise stop at the report.
5. Match the naming and location conventions of sibling skills so it composes naturally (`.claude/skills/audit-test-coverage/SKILL.md`, verb-first name).

## Non-goals

- **Does not write, edit, move, rename, or delete test files directly.** All writes go through `author-*` skills; deletions are dev-driven.
- **Does not author extension host tests.** No `author-ext-host-tests` skill exists yet; ext-host items are flagged with pattern hints only. A dedicated authoring skill is a potential follow-up.
- **Does not run tests**, start build daemons, or invoke direct TypeScript compilation.
- **Does not claim line-coverage parity** when proposing moves. Behavioral parity is a dev judgment call; the skill surfaces the assertion list and lets the dev decide.
- **Does not propose moves, deletions, or modifications to upstream VS Code tests.** Upstream Core Mocha tests (`src/vs/**/test/**` without Positron copyright headers) are read-only. They *are* surfaced in the report as awareness-only coverage so the dev can spot duplication or gaps, but the skill never acts on them.

## Decisions made during brainstorm

| Question | Decision | Reasoning |
|---|---|---|
| Analysis-only, one-stop-shop, or full lifecycle? | **Approach 1.5: report-first, opt-in handoff.** | Audit is a first-class use case — often the whole job. Orchestration is available but not forced. Preserves dev agency; keeps the report durable (pastable into a PR comment, revisitable later). |
| How to handle extension host tests? | **Flag only for now; `author-ext-host-tests` is a potential follow-up skill.** | Ext-host test patterns vary per-extension (`positron-python` has its own setup entirely). Drafting inline would need per-extension knowledge that's hard to get right. Honest flagging is better than fragile auto-drafting. |
| User-feedback format? | **Hybrid: structured per-item approvals + one open-ended prompt at the end.** | Structured per-item keeps a 15-item plan answerable in seconds. The open-ended tail catches behaviors the classifier missed — which is where classifiers typically fail. |
| Layering with `author-vitest-tests` (which has its own Phase 1)? | **Invoke `author-vitest-tests` per file, not per PR.** `author-vitest-tests` skips Phase 1 when given a specific file path, so no duplicate bucket analysis and no drift. | Clean single-responsibility boundary: ours picks bucket, theirs picks pattern. |
| Test plan vs quality-check framing? | **Reframe to "audit": skill name `audit-test-coverage`; deliverable is a "Test coverage audit"; verdict vocabulary is explicit per item (`Keep` / `Move down` / `Move up` / `Split` / `Add` / `Delete` / `Skip`).** | "Test plan" implies prescription. The most valuable verdicts in real-world audit work are diagnostic (`Keep`, even when the source pattern says migrate). Composes naturally with code review and pre-merge checks. (Added 2026-04-29.) |
| How rigorous should the source-area trace be? | **Add a hypothesis-verification substep to Step 4B: for each traced code path, run `./scripts/file-origin.sh` and grep for webview / upstream / multi-window markers; ownership flips the verdict to `Keep` when applicable.** | Source-pattern matching produces false positives — `MenuId.X` mentions in a Positron source file do not necessarily correspond to the buttons the e2e clicks. The first Partial-overlap inspection (`editor-action-bar-document-files`, 2026-04-29) demoted to `Keep` on this basis after a 30-min trace. Verification turns the most common false-positive into a correct verdict. (Added 2026-04-29.) |
| Confidence on every recommendation? | **Yes — `high` / `medium` / `low` on every verdict, not just on move proposals.** | Dev's gate behavior changes by confidence: high → approve in one keystroke, medium → read the trace, low → push back. Confining confidence to moves leaves the dev guessing on the rest. (Added 2026-04-29.) |
| Detect move-up too, not just move-down? | **Yes — add `Move up → <bucket>` verdict, but mark it rare and almost always confidence `medium` or `low`.** Pair every Move-up with an alternative line ("rewrite at current bucket with less mocking" / "delete and rewrite higher"). | Move-up is real (over-mocked Vitest tests; RTL tests that need real browser semantics; ext-host tests asserting cross-pane workflows). Detection from static analysis is weak — negative signals only. The skill surfaces candidates but doesn't pretend high confidence. (Added 2026-04-29.) |

## Identity

- **Name:** `audit-test-coverage`
- **Location:** `.claude/skills/audit-test-coverage/SKILL.md` in the Positron repo (plugin-scoped, auto-loaded).
- **Description (auto-invoke trigger):** Use to audit test coverage for a Positron change — review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. Triggers include "audit coverage for \<feature\>", "is my test placement right", "quality-check before merge", "are these e2e tests carrying their weight", "what coverage does this PR need", or as part of pre-PR review. Produces a cross-bucket test coverage audit (Core Mocha / Vitest / Extension host / E2E) with explicit verdicts (`Keep` / `Move down` / `Move up` / `Split` / `Add` / `Delete` / `Skip`) and confidence per item. Optionally orchestrates handoff to `author-vitest-tests` and `author-e2e-tests`.

### Inputs (`$ARGUMENTS`)

The skill accepts six entry points; the **workflow shape varies by what you target**.

- **Source file** (e.g., `src/vs/.../myComponent.tsx`) — find existing tests that reference this file and audit each; identify gaps in new coverage. Both halves of the report populated.
- **Test file** (e.g., `test/e2e/tests/console/console-clear.test.ts`, `src/vs/.../foo.vitest.ts`, `extensions/positron-r/src/test/foo.test.ts`) — the test IS the subject. Skip Step 2 (no source changes to enumerate). Step 4 becomes the whole job: trace assertions, run 4B-verify, produce a verdict for the test. The "New coverage needed" half is empty unless the trace surfaces an underlying gap.
- **Test directory** (e.g., `test/e2e/tests/notebooks-positron/`) — sweep audit; same workflow as test-file, repeated across files in the directory.
- **`--branch <name>`** — analyze all changes on a branch vs `main`. Audit tests for every changed source file. Both halves of the report populated.
- **PR number, `#number`, or PR URL** — same as `--branch` but resolved via `gh pr diff <n>`.
- **Freeform feature area** (e.g., "console clear handling") — search for anchor files; if ambiguous, ask the user for anchor file(s). Resolves to one of the above. Counts as 1 of 2 allowed clarifying questions.

**Test-as-target is a first-class entry point** — it codifies the per-test inspection pattern (e.g., the 2026-04-29 inspection of `editor-action-bar-document-files.test.ts`) for re-use on any test, on demand.

## Workflow

Six steps. Hard stop after step 5 (the report). Step 6 is opt-in.

### Step 1. Resolve input → concrete subject (silent)

- **Source file** → read it directly. Subject = the source file.
- **Test file** → read it directly. Subject = the test file. Workflow shifts: skip Step 2; Step 4 is the deliverable.
- **Test directory** → list test files in the directory. Subject = the set of test files. Workflow shifts as for test-file, repeated.
- **PR** → `gh pr view <n> --json files,title,body` then `gh pr diff <n>`. Subject = changed source files.
- **`--branch <name>`** → `git fetch origin <name> && git diff main...origin/<name>`. Subject = changed source files.
- **Feature area** → search for anchor files; if ambiguous, ask user for the anchor. Resolves to one of the above.

Output a one-line summary of what was gathered, including which entry-point shape applies, before continuing.

### Step 2. Enumerate testable behaviors

**Skip this step entirely if the input is a test file or test directory** — there are no source changes to enumerate. Go straight to Step 4 (audit), which becomes the deliverable.

For source-file / branch / PR / feature-area inputs: for each changed file/symbol, list discrete behaviors that merit a test. Skip: pure renames, type-only edits, comment-only changes, trivial glue, config, docs, action-only files, files with reverted changes.

### Step 3. Classify each behavior into a bucket

Read the Testing section of `CLAUDE.md` (post-#13033) at the start of every run. It is the single source of truth for the decision table. Apply the table in order; stop at the first match.

Tiebreakers beyond the table:
- **Lowest bucket that covers the behavior wins.**
- **If in doubt between two buckets, pick the lower one** and note the reasoning. The dev can override at the gate.

### Step 4. Audit existing coverage (the reframed model)

**Scoping the audit.** Scope depends on entry point:

- **Source / branch / PR / feature-area input:** "Existing tests in the area under review" = test files that reference any source file in the changeset (by grep for import paths or symbol names), plus test files co-located with the changed source files.
- **Test-file input:** scope is exactly that one test file. Audit it as the subject.
- **Test-directory input:** scope is every test file in the directory. Audit each as a subject.

Four test surfaces to scan (when the audit is source-driven):

- Vitest: `src/**/*.vitest.ts`, `src/**/*.vitest.tsx` — Positron unit tests, first-class audit target.
- E2E Playwright: `test/e2e/tests/**/*.test.ts` — first-class audit target for move proposals.
- Extension host Mocha: `extensions/<name>/src/test/**/*.test.ts` — first-class audit target for move proposals.
- **Upstream Core Mocha: `src/vs/**/test/**/*.test.ts` and `*.integrationTest.ts` without Positron copyright headers — awareness-only.** The skill includes these in the scan to detect duplicate or overlapping coverage but never proposes moves, deletions, or modifications against them. They are surfaced under their own report section (see output format).

If the scope expands beyond ~20 test files, paginate: audit the closest-matching 20 first and surface a note that wider audit is available on request.

If no existing tests are found in scope, the audit section of the report is simply omitted (the report becomes "new coverage needed" + "skip").

**Upstream coverage awareness.** For each upstream Core Mocha test in scope, the skill records: path, which changed source files it references, and a one-line summary of what it asserts. When the "new coverage needed" list includes a Vitest item whose behavior overlaps an upstream test's assertions, the skill flags the overlap inline (e.g., *"upstream already asserts X at `<path>:L42`"*) so the dev can decide whether the Vitest test is redundant, complementary, or Positron-specific. The skill does not propose deleting upstream coverage or deleting the Vitest candidate — the dev decides at the gate.

Central question for every existing **Positron-authored** e2e or ext-host test in scope:

> **"What is this test actually asserting, and COULD/SHOULD that assertion be made directly against the underlying unit?"**

Assertion-level trace, not test-level pattern matching:

**4A. Enumerate assertions.** Read the test file; list each `expect()` / `toHaveText` / `toBeVisible` / `toBe` call at the assertion level, not the test level.

**4B. Trace each assertion to the code responsible for it.**
- A text-match on formatted output → the formatter function.
- A visibility assertion that depends on component state → the component's render logic.
- A value in a data structure → the service method or reducer that produced it.
- A UI path that boils down to "this function returned X" → the function itself.

**4B-verify. Confirm ownership of the traced code.** This substep is the most reliable false-positive filter the skill has — apply it to every traced code path before counting it as unit-testable.

For each path the trace lands on:

1. **`./scripts/file-origin.sh <path>`** — if the file is upstream-owned (no Positron copyright header), verdict is `Keep` with reason "upstream behavior, upstream's tests."
2. **Webview ownership** — grep the file/area for `registerWebviewViewProvider`, `WebviewView`, `iframe`, or check whether the assertion's UI is contributed by a webview-rendering extension (e.g., `markdown-language-features`, `positron-viewer`, external Quarto extension). If yes, verdict is `Keep` with reason "webview content cannot render in happy-dom."
3. **Multi-window markers** — calls into `IWindowsMainService`, `auxiliaryWindow`, or test descriptions like "open in new window" / "move to new window." If yes, verdict is `Keep` with reason "inherently e2e."

If any check hits, set verdict = `Keep` with `confidence: high` and record the ownership reason in the report. The trace + reason is shown so the dev can spot-check.

Why this matters: source-pattern matching produced false positives in real audit work — for example, `MenuId.EditorActionsRight` in `positronQuarto.contribution.ts` registers a kernel-status badge, NOT the Preview button the e2e tests. Without ownership verification, the skill makes the same mistake. With it, the most common Partial-overlap false-positive becomes a correct `Keep` verdict.

**4C. Apply COULD and SHOULD per assertion.**

*COULD it move down?* Is the responsible unit reachable in the lower bucket?
- Pure function → yes, Vitest plain.
- Service with DI → yes, Vitest builder.
- React render → yes, Vitest RTL.
- Component that only fires inside a full app via OS-level keyboard + focus state → no, legitimately e2e.

*SHOULD it move down?* Concrete cost signals at the current placement:
- Runtime cost: the e2e spins a whole session/window to assert one value check.
- Flakiness exposure: timing-sensitive UI waits for what is deterministic at the unit level.
- Coverage redundancy: a unit test already exists — the e2e is duplicating that assertion through a ~10× slower path.
- Assertion is about data shape/format, not user experience.

**4D. Classify the test as a whole.**
- **Move down fully** — every assertion could and should move lower. Propose a replacement at the lower bucket; flag the original for deletion (dev-driven).
- **Move up** — *rare.* The current bucket can't faithfully exercise what the test asserts; the test belongs higher. Almost always confidence `medium` or `low` because move-up is detected from negative signals (heavy stubbing, mismatch between assertions and unit behavior). Always paired with an "alternative" line in the report — sometimes the right fix is to rewrite at the current bucket with less mocking, not to move up.
- **Split** — some assertions are genuinely cross-system, others are unit-level value checks. Propose moving the unit-level subset down; keep the cross-system subset in e2e.
- **Keep** — assertions genuinely depend on full-app integration, OS-level input, multi-pane state, or real runtime output not reproducible under unit conditions.
- **Delete** — test asserts upstream Monaco/VS Code behavior, or duplicates coverage that already exists at the right level.

**Signals an assertion may belong UP a bucket** (rare, weak signals):
- Vitest test stubs ≥5 fundamental services (`ICommandService`, `IRuntimeSessionService`, `IExtensionService`, etc.) and the assertions are about cross-service interactions, not the unit's own outputs.
- RTL test asserts behavior that depends on real browser semantics: native drag-drop, focus traversal across multiple elements, multi-window, real timer-driven UX, scroll-into-view, IntersectionObserver. happy-dom can't simulate these faithfully.
- Ext-host test uses `vscode.window.createWindow` / asserts cross-pane workflows that span the chrome.
- The test passes today but a known bug in the same code path doesn't reproduce — strong hint the test isn't really exercising the integration.

When any of these hit, surface the candidate with verdict `Move up → <bucket>` AND an alternative ("rewrite at current bucket with less mocking" / "delete and write at higher bucket"). Confidence rarely exceeds `medium`.

**Signals an assertion SHOULD move down:**
- Test name or describe block contains: "validates", "parses", "formats", "transforms", "computes", "renders when", "returns", "detects".
- Assertion compares strings, numbers, or small structures.
- The file under test has a unit test already — but the e2e test asserts the same behavior through UI.
- The assertion has nothing to do with user perception (e.g., internal state shape).

**Signals an assertion legitimately STAYS in e2e:**
- Assertion is on a user-visible cross-pane outcome (typed in console → variable appears in variables pane).
- Assertion depends on real runtime output not mockable at the unit level (e.g., R's stderr formatting).
- Assertion depends on OS/window-level behavior (focus, keyboard shortcuts through the chrome, file watcher races).
- Test documents a regression that only reproduces full-stack.

**Verdict vocabulary** (used on every item in the report):
- `Keep` — coverage is correctly placed at this level. Includes ownership-verified Keeps from 4B-verify.
- `Move down → <bucket>` — coverage belongs lower; full move proposed.
- `Move up → <bucket>` — coverage belongs higher (rare). The current bucket can't faithfully exercise the behavior the test asserts. Always paired with an "alternative" suggestion (often "rewrite at current bucket with less mocking") because the right fix isn't always to move up.
- `Split` — some assertions move, some stay. Replacement covers the unit-level subset; original is trimmed.
- `Add` — new coverage needed at this level (no existing coverage to keep or move).
- `Delete` — duplicate or upstream-owned; no replacement needed.
- `Skip` — not worth testing (docs, glue, reverted, type-only).

**Confidence per verdict** (applies to every verdict, not just moves):
- **high** — verdict is structural. Ownership-verified `Keep`. All-assertions-trace `Move down`. Clearly Vitest-shaped `Add`. Mechanical `Skip` / `Delete`.
- **medium** — verdict involves judgment. `Split` where assertions span layers cleanly but the boundary needs a human eye. `Add` where the bucket is fuzzy (Vitest vs ext-host).
- **low** — verdict is technically defensible but payoff is small. Often surfaces as "low-confidence flag" the dev can ignore.

### Step 5. Present the report and gate on dev feedback

Output the report (format in the next section). Then ask exactly two questions (hybrid feedback format):

1. *"For each item above: approve / change bucket / skip? Reply per-line (e.g., `approve all except 3,7`) or 'approve all'."*
2. *"Any testable behavior I missed?"*

**Stop. Wait for the dev.** Do not proceed without a response.

### Step 6. Opt-in handoff

After the dev's response at step 5, ask:

> *"Want me to invoke `/author-vitest-tests` for approved Vitest items and `/author-e2e-tests` for approved E2E items? (yes / no / partial: list IDs). Move proposals get a separate yes/no per move."*

- **No** → end. The report is the deliverable.
- **Yes / partial** → iterate approved items. **Per-file handoff only** — never pass a PR number or branch to `author-vitest-tests` (would re-run its Phase 1 and potentially drift from our plan). Stop between handoffs and summarize what was produced before starting the next.
- **Ext-host items** are never auto-invoked; surfaced with pattern hints only.
- **Move proposals (e2e → Vitest):** each gets its own explicit confirmation: *"Draft the replacement Vitest test via `/author-vitest-tests` and flag the original e2e for deletion?"* — yes/no per move. Deletions are never performed by this skill.

**Context carry-forward on handoff:**
- For new additions: pass just the file path. `author-vitest-tests`' Phase 2 plan-first gate is where test cases are chosen; the dev has the report fresh in their head.
- For e2e → Vitest move proposals: pass the file path plus a one-line behavioral hint as free-form prose in `$ARGUMENTS`, e.g., *"Covers behaviors currently asserted in `test/e2e/.../console-clear.test.ts`: detects `\f` trigger, no-ops on partial sequence."* Phase 2 factors it in when drafting cases.

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

### Formatting rules baked into the skill

- Line-number references (`L23`) only when the test file has actually been read.
- Paths are project-relative, no leading `./`.
- Every line carries an explicit verdict (`Keep` / `Move down` / `Move up` / `Split` / `Add` / `Delete` / `Skip`) and a confidence band (`high` / `medium` / `low`). No verdict-less items.
- Hypothesis-verification trace is shown inline for any `Keep` produced by 4B-verify so the dev can spot-check.
- Low-confidence flags are listed under their own heading and called out as optional.
- Items are numbered across the whole report (`1`…`N`) so the dev can reply `approve all except 3,7,12`.

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

## Dependencies & prerequisites

- PR #13033 must land first. The skill references the new CLAUDE.md Testing table, the renamed `author-vitest-tests` / `review-vitest-tests` skills, and the new `.vitest.*` file convention.
- Uses `gh` CLI for PR metadata (already an installed dependency in the dev environment).
- Reads `CLAUDE.md` (Testing section), `.claude/rules/vitest-tests.md`, and the `PositronTestContainerBuilder` JSDoc in `src/vs/test/vitest/positronTestContainer.ts` for pattern/preset context.

## Related work

The 2026-04-28 one-off e2e → Vitest audit (tracking docs at `~/.claude/projects/-Users-marieidleman-Develop-positron/migration-tracking/`) is prior art that this skill operationalizes. Specifically:

- `2026-04-28-e2e-vitest-audit-design.md` — methodology and rubric the skill draws on.
- `2026-04-28-e2e-vitest-audit-report.md` — full findings table; the Partial-overlap section motivated the hypothesis-verification substep in 4B.
- `2026-04-28-e2e-vitest-audit.md` — implementation plan whose migration recipe (Tasks 6-10) is reusable when the dev opts into a move-down handoff.

The skill's Notes/references section (in the eventual `SKILL.md`) should link these as prior art so any future audit run composes with the historical record rather than re-litigating it.

## Open items / future work

- **`author-ext-host-tests` sibling skill.** Ext-host items are flag-only for now. A dedicated authoring skill would close the third bucket.
- **Assertion-tracing accuracy.** Step 4B (trace assertion → responsible code) is static and heuristic. It will miss cases where the assertion reaches the unit through several layers of indirection, and over-flag cases where the UI layer is non-trivial. Worth measuring on real PRs after rollout.
- **Coverage parity verification.** We deliberately don't attempt line-coverage parity on moves. If this becomes a repeated pain point, a future iteration could run Vitest + Playwright with coverage and diff the line sets.
- **Integration with the author skill's auto-review.** `author-vitest-tests` spawns `review-vitest-tests` in Phase 3. `audit-test-coverage` doesn't participate in that review — but it could optionally consume the post-handoff summary and update the report. YAGNI for v1.

## Success criteria

- A dev running the skill on a PR gets a report within ~2 minutes that names (a) the new coverage needed with the right bucket, (b) any misplaced existing tests with high-signal move proposals, (c) correctly-placed coverage to leave alone.
- The report is readable as a standalone artifact — pastable into a PR comment, linkable in an issue.
- When the dev opts in to handoff, the invocations complete without re-running bucket analysis (no Phase 1 drift from `author-vitest-tests`).
- Over time: the share of Positron coverage sitting in e2e that *could* live lower drops, as measured by spot audits or the skill's own "low-confidence" trend.

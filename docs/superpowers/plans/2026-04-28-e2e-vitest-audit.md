# E2E → Vitest Audit & Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit all 182 Positron e2e tests against the 92 Vitest tests, identify migration candidates and coverage gaps, and execute the top 5 high-confidence migrations end-to-end (write vitest, delete e2e, commit).

**Architecture:** Two phases. Phase 1 (Tasks 1–5): dispatch 9 parallel audit subagents (each calibrated by reading `vitest-tests.md`, `vitest-rtl.md`, and the `author-e2e-tests` SKILL), synthesize their bucket outputs into a single report, rank candidates by a fixed scoring rubric, write and commit the report. Phase 2 (Tasks 6–10): execute the 5 selected migrations by invoking the `author-vitest-tests` skill (which has its own mandatory user-confirmation gate for the test plan and dispatches `review-vitest-tests` for independent review), then deleting the e2e and committing. Tasks 6–10 are parameterized templates — the candidate paths are filled in from Task 5 output before each migration task executes.

**Tech Stack:** Playwright (e2e, deleted), Vitest (target), React Testing Library, builder-pattern DI (`createTestContainer()`), `stubInterface<T>()`, ESLint with `eslint-plugin-testing-library` and `eslint-plugin-jest-dom`. Skills: `author-vitest-tests`, `review-vitest-tests`, `author-e2e-tests`.

**Spec:** `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-design.md`

---

## File Structure

**Phase 1 deliverables:**
- Create: `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md` — full findings table, ranked top-5, follow-up backlog.
- Temp scratch (gitignored, do not commit): `/tmp/audit-bucket-1.md` … `/tmp/audit-bucket-9.md`.

**Phase 2 deliverables (per migration):**
- Create: `src/vs/<area>/test/<browser|common>/<name>.vitest.ts` (or `.vitest.tsx`) — the new vitest, placed next to source per `vitest-tests.md` rules.
- Delete: `test/e2e/tests/<area>/<name>.test.ts` — the e2e being replaced.
- Modify: `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md` — mark candidate as `Migrated` with commit SHA (modify happens in Task 11).

Each migration is one atomic commit (vitest add + e2e delete) so it is independently revertable.

---

## Task 1: Build the agent prompt template

**Files:**
- Create: `/tmp/audit-agent-prompt.md` — shared prompt the bucket agents receive (scratch only, not committed).

- [ ] **Step 1: Capture the full vitest inventory**

Run:

```bash
find src -name "*.vitest.ts" -o -name "*.vitest.tsx" | sort > /tmp/vitest-inventory.txt
wc -l /tmp/vitest-inventory.txt
```

Expected: file with one path per line, ~92 lines.

- [ ] **Step 2: Write the shared agent prompt**

Write `/tmp/audit-agent-prompt.md` with this exact content (substitute `<BUCKET_DIRS>` and `<BUCKET_NUMBER>` per agent at dispatch time):

```markdown
You are auditing Positron e2e Playwright tests against existing Vitest tests.

## Goal

For every e2e test file under the directories listed below, classify it
against a fixed rubric and produce one row per file in the output.

## Bucket directories

<BUCKET_DIRS>

## Vitest inventory (full list of existing vitest files)

(Read the file at /tmp/vitest-inventory.txt for the full list of 92 vitest
paths. Use this list to find counterparts for the e2e tests you audit.)

## Required reading — do this ONCE before classifying any files

Read these in order. They calibrate your judgment on what really needs
full-app behavior vs what can be a vitest, and on what good vitest
counterparts look like.

1. `.claude/rules/vitest-tests.md` — Vitest patterns, presets, anti-
   patterns, and the builder. This is what a "good vitest counterpart"
   looks like.
2. `.claude/rules/vitest-rtl.md` — RTL conventions for `.vitest.tsx`
   tests. Helps you spot React-component e2e tests that are really
   prop-driven render tests.
3. `.claude/skills/author-e2e-tests/SKILL.md` — Positron's e2e fixture
   system, page object model, what "real e2e behavior" looks like.
   Tests that lean heavily on `app.workbench.*` page-object methods,
   `python` / `r` / `sessions` fixtures for runtime startup, or
   `executeCode` are usually `Keep`. Tests that only assert on text /
   structure that could be unit-tested are usually migratable.
4. `CLAUDE.md` (Testing section, "Where should I put my test?" table) —
   the canonical decision table.

## Process — for each e2e file in your bucket

1. Read the e2e test file in full.
2. Identify the source code it actually exercises (grep for the imports
   and key functions it asserts on).
3. Search /tmp/vitest-inventory.txt for any vitest that targets the same
   source. If a candidate exists, read it in full to compare assertions.
4. Apply the rubric below and emit one row. The required-reading items
   inform your verdict — if a test uses real interpreter fixtures or
   multi-pane page-object workflows, it's `Keep`; if it asserts on logic
   the source exposes synchronously, it's `Strong-migrate` or `Dupe`.

DO NOT classify from the filename alone. Read the file.

## Rubric — verdict definitions

- **Dupe**: same source, same assertions already covered in vitest. Action:
  delete e2e.
- **Strong-migrate**: e2e tests pure logic / single component / formatted
  output with no real Python or R runtime needed and no cross-pane workflow.
  No existing vitest. Action: write vitest, delete e2e.
- **Partial-overlap**: some assertions are migratable; full e2e workflow
  worth keeping. Action (deferred): extract migratable bits, slim e2e.
- **Keep**: needs real interpreter, real notebook execution, IPC, network,
  cross-pane interaction, or real keybindings. No action.
- **Coverage-gap**: e2e is the only coverage AND the source is unit-testable
  (pure logic / DI service / React component without runtime dependency).
  Action: log for future vitest backfill.
- **Unclear**: deeper read needed. Action: synthesizer re-audits before
  ranking.

## Output schema — strict, one row per e2e file

Write your output to /tmp/audit-bucket-<BUCKET_NUMBER>.md as a markdown
table with this exact header:

| test_file | verdict | confidence | vitest_counterpart | source_under_test | why_e2e_unnecessary | notes |

Rules:
- `test_file`: repo-relative path (e.g. `test/e2e/tests/console/console-ansi.test.ts`).
- `confidence`: High / Med / Low.
- `vitest_counterpart`: repo-relative path or `none`.
- `source_under_test`: repo-relative path(s), comma-separated if multiple.
- `why_e2e_unnecessary`: one short sentence; only fill if verdict is
  Dupe or Strong-migrate. Otherwise leave empty.
- `notes`: anything weird, edge cases, dependencies, flags. Keep terse.
- No prose outside the table.
- One row per e2e file. If a test file uses test.describe with multiple
  scenarios, use one row for the file and mention the split in `notes`.

## Confidence guide

- **High**: you read the e2e and the source (and any vitest counterpart)
  and the verdict is unambiguous.
- **Med**: verdict is right but minor uncertainty (e.g., a partial overlap
  whose extent depends on judgment).
- **Low**: surface signals point one way but you would want a reviewer to
  double-check. Use `Unclear` instead if you really cannot tell.
```

- [ ] **Step 3: Verify the prompt file exists and is well-formed**

Run:

```bash
test -s /tmp/audit-agent-prompt.md && wc -l /tmp/audit-agent-prompt.md
```

Expected: file exists, ~60–80 lines.

- [ ] **Step 4: No commit yet**

The prompt file is in `/tmp` and not committed. Move on to Task 2.

---

## Task 2: Dispatch 9 parallel audit agents

**Files:**
- Create: `/tmp/audit-bucket-1.md` … `/tmp/audit-bucket-9.md` (agent outputs, scratch only).

- [ ] **Step 1: Send all 9 Agent dispatches in a single message (parallel)**

Use `subagent_type: "Explore"` for each. The same prompt template is reused; only the bucket directories and bucket number differ. Bucket assignments:

| # | Bucket name | Directories |
|---|---|---|
| 1 | Positron notebooks | `test/e2e/tests/notebooks-positron/` |
| 2 | Notebook + Quarto + Rmd | `test/e2e/tests/notebook/`, `test/e2e/tests/quarto/`, `test/e2e/tests/r-markdown/` |
| 3 | Data Explorer | `test/e2e/tests/data-explorer/` |
| 4 | Console + Output + Variables | `test/e2e/tests/console/`, `test/e2e/tests/output/`, `test/e2e/tests/variables/`, `test/e2e/tests/environment-pane/` |
| 5 | Editor surfaces | `test/e2e/tests/editor/`, `test/e2e/tests/editor-action-bar/`, `test/e2e/tests/top-action-bar/`, `test/e2e/tests/code-actions/`, `test/e2e/tests/references/`, `test/e2e/tests/autocomplete/`, `test/e2e/tests/diagnostics/`, `test/e2e/tests/search/`, `test/e2e/tests/evaluation/` |
| 6 | Visual outputs | `test/e2e/tests/plots/`, `test/e2e/tests/viewer/`, `test/e2e/tests/pdf/`, `test/e2e/tests/apps/`, `test/e2e/tests/shiny/`, `test/e2e/tests/catalog-explorer/` |
| 7 | Assistant + LSP | `test/e2e/tests/assistant/`, `test/e2e/tests/assistant-eval/`, `test/e2e/tests/posit-assistant/`, `test/e2e/tests/lsp/` |
| 8 | Runtime + Sessions | `test/e2e/tests/connections/`, `test/e2e/tests/debug/`, `test/e2e/tests/reticulate/`, `test/e2e/tests/interpreters/`, `test/e2e/tests/sessions/` |
| 9 | Workbench surfaces | `test/e2e/tests/extensions/`, `test/e2e/tests/import-vs-code-settings/`, `test/e2e/tests/new-folder-flow/`, `test/e2e/tests/welcome/`, `test/e2e/tests/help/`, `test/e2e/tests/layouts/`, `test/e2e/tests/workbench/`, `test/e2e/tests/tasks/`, `test/e2e/tests/test-explorer/`, `test/e2e/tests/scm/`, `test/e2e/tests/r-pkg-development/`, `test/e2e/tests/remote-ssh/` |

Each `Agent` call includes:
- `description`: e.g. `"Audit bucket 4 (console/output/variables/env)"`.
- `subagent_type`: `"Explore"`.
- `prompt`: the full content of `/tmp/audit-agent-prompt.md` with `<BUCKET_DIRS>` replaced by that bucket's directory list and `<BUCKET_NUMBER>` replaced by `1`–`9`.

ALL 9 calls must go in a single message so they run in parallel.

- [ ] **Step 2: Verify each bucket produced output**

After all agents return, run:

```bash
for n in 1 2 3 4 5 6 7 8 9; do
  echo "=== bucket $n ==="
  test -s /tmp/audit-bucket-$n.md && wc -l /tmp/audit-bucket-$n.md || echo "MISSING"
done
```

Expected: every bucket file exists and has ≥3 lines (header + separator + at least one row).

If any bucket is missing or empty, redispatch just that bucket with `Agent` (single dispatch, same prompt).

- [ ] **Step 3: Sanity check row count**

Run:

```bash
total=$(grep -c '^| test/e2e' /tmp/audit-bucket-*.md | awk -F: '{s+=$2} END {print s}')
echo "audited rows: $total / 182"
```

Expected: total close to 182. If significantly under (e.g. <170), some files were skipped — re-dispatch the bucket(s) with the gap, telling the agent which files it missed.

- [ ] **Step 4: No commit yet — bucket files are scratch**

---

## Task 3: Synthesize bucket outputs and re-audit Unclear rows

**Files:**
- Modify: nothing committed yet; build the unified report in memory and write in Task 5.

- [ ] **Step 1: Concatenate buckets into a working table**

Run:

```bash
{
  echo "| test_file | verdict | confidence | vitest_counterpart | source_under_test | why_e2e_unnecessary | notes |"
  echo "|---|---|---|---|---|---|---|"
  for n in 1 2 3 4 5 6 7 8 9; do
    grep '^| test/e2e' /tmp/audit-bucket-$n.md
  done
} > /tmp/audit-merged.md
wc -l /tmp/audit-merged.md
```

Expected: ~184 lines (2 header lines + ~182 rows).

- [ ] **Step 2: Extract Unclear rows for manual re-audit**

Run:

```bash
grep '| Unclear |' /tmp/audit-merged.md | tee /tmp/audit-unclear.md | wc -l
```

Expected: 0–20 rows. If 0, skip Step 3.

- [ ] **Step 3: Manually re-audit each Unclear row**

For every row in `/tmp/audit-unclear.md`:

1. `Read` the e2e test file.
2. `Read` the source it imports.
3. Search `/tmp/vitest-inventory.txt` for a counterpart.
4. Decide a verdict from the rubric (Dupe / Strong-migrate / Partial-overlap / Keep / Coverage-gap).
5. Edit `/tmp/audit-merged.md` and replace the row with the resolved verdict.

Do NOT leave any `Unclear` rows in the merged table. If a file genuinely defies classification, mark it `Keep` with a note explaining the ambiguity.

- [ ] **Step 4: Verify zero Unclear rows remain**

Run:

```bash
grep -c '| Unclear |' /tmp/audit-merged.md || echo "OK: 0 unclear"
```

Expected: 0 (or "OK: 0 unclear").

---

## Task 4: Rank candidates and select top 5

**Files:**
- Create: `/tmp/audit-ranked.md` — scored candidate list (scratch).

- [ ] **Step 1: Filter to actionable verdicts**

Run:

```bash
grep -E '\| (Dupe|Strong-migrate) \|' /tmp/audit-merged.md > /tmp/audit-candidates.md
wc -l /tmp/audit-candidates.md
```

Expected: N rows where N is the number of Dupe + Strong-migrate verdicts.

- [ ] **Step 2: Score each candidate**

For every row in `/tmp/audit-candidates.md`, compute a score using these exact rules:

- +3 if confidence is High; +1 if Med; 0 if Low.
- +2 if verdict is Dupe (cheapest — vitest already exists, may only need an assertion top-up).
- +2 if verdict is Strong-migrate AND `wc -l` of the e2e test file is < 150.
- −1 if `notes` mentions partial overlap, kept e2e setup, or "see also".
- −2 if `source_under_test` includes a `.tsx` file or notes mention `userEvent`, async timing, or React state.

Edit `/tmp/audit-ranked.md` and emit a sortable table:

```markdown
| score | test_file | verdict | confidence | vitest_counterpart | reason |
```

One row per candidate. `reason` is a short string showing the math: `"+3 High, +2 Dupe = 5"`.

- [ ] **Step 3: Sort and select the top 5**

Run:

```bash
sort -t'|' -k2 -nr /tmp/audit-ranked.md | head -7
```

Expected: the 5 highest-scoring rows (plus header lines). If there are ties at position 5, prefer Dupe over Strong-migrate; then prefer the one with the smaller e2e file.

- [ ] **Step 4: Lock in the top 5**

Save the selection to `/tmp/audit-top5.md` with one row per chosen migration:

```markdown
| rank | test_file | verdict | vitest_counterpart | source_under_test |
```

This file feeds Tasks 6–10.

- [ ] **Step 5: Sanity check**

Read each of the 5 selected e2e files yourself (`Read` tool, full content). For each one, confirm:
- The verdict still looks right.
- You can name the test pattern that will replace it (plain / builder / RTL prop / RTL service-context).
- The migration scope is reasonable for one task.

If any of the 5 fails this sanity check, replace it with the next highest-scoring candidate from `/tmp/audit-ranked.md`. Re-do this step until all 5 pass.

---

## Task 5: Write and commit the audit report

**Files:**
- Create: `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md`

- [ ] **Step 1: Write the report**

Use `Write` to create the file with this structure:

```markdown
# E2E → Vitest audit report

**Date:** 2026-04-28
**Spec:** [2026-04-28-e2e-vitest-audit-design.md](./2026-04-28-e2e-vitest-audit-design.md)
**Audited:** 182 e2e test files across `test/e2e/tests/**`

## Summary

- Dupes: <count>
- Strong-migrate: <count>
- Partial-overlap: <count>
- Coverage-gap: <count>
- Keep: <count>
- Total: 182

## Top 5 selected for migration this session

(paste contents of /tmp/audit-top5.md, one row per migration)

| rank | test_file | verdict | vitest_counterpart | source_under_test | commit |
|---|---|---|---|---|---|
| 1 | … | … | … | … | _pending_ |
| 2 | … | … | … | … | _pending_ |
| 3 | … | … | … | … | _pending_ |
| 4 | … | … | … | … | _pending_ |
| 5 | … | … | … | … | _pending_ |

## Backlog — Dupe and Strong-migrate not selected this session

(rows from /tmp/audit-ranked.md not in the top 5)

## Coverage gaps — e2e-only, source is unit-testable

(rows from /tmp/audit-merged.md with verdict Coverage-gap)

## Partial-overlap candidates — deferred

(rows with verdict Partial-overlap)

## Per-domain detail

### Bucket 1: Positron notebooks

(paste rows from /tmp/audit-bucket-1.md)

### Bucket 2: Notebook + Quarto + Rmd

(paste rows from /tmp/audit-bucket-2.md)

… (one section per bucket, all 9)
```

Replace placeholders with the actual counts and paste the actual rows. Do not leave bracketed text in the final file.

- [ ] **Step 2: Verify the report is complete**

Run:

```bash
test -s docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md
grep -c '^| test/e2e' docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md
```

Expected: file exists; row count ≥ 182 (each row appears at minimum in its per-domain section, and top 5 / backlog / gap rows duplicate from there).

- [ ] **Step 3: Commit the report**

```bash
git add docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md
git commit -m "$(cat <<'EOF'
docs: add e2e -> vitest audit findings

Audited 182 e2e tests across 9 domain buckets. Report tracks dupes,
strong-migrate candidates, partial overlaps, coverage gaps, and the
top 5 selected for migration this session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds; pre-commit hook passes (Markdown only).

---

## Migration tasks 6–10 — template

> Tasks 6 through 10 are five instances of the same template. Before each one starts, fill in these placeholders from `/tmp/audit-top5.md`:
>
> - `<E2E_PATH>` — e.g. `test/e2e/tests/console/console-ansi.test.ts`
> - `<E2E_NAME>` — basename without extension, e.g. `console-ansi`
> - `<SOURCE_PATH>` — e.g. `src/vs/workbench/services/positronConsole/browser/classes/runtimeItemActivity.ts`
> - `<E2E_ASSERTIONS>` — bullet list of every assertion in the e2e (gathered in Step 1)
> - `<VITEST_PATH>` — new vitest file (decided by `author-vitest-tests` skill in Step 2)
>
> The migration tasks invoke the project's `author-vitest-tests` skill rather than open-coding the vitest creation. The skill enforces the project's authoring conventions, includes a **mandatory user-confirmation gate** for the test plan, and runs an independent review subagent (`review-vitest-tests`) before considering the test done. Only after the skill completes do we delete the e2e and commit.

## Task 6: Migration 1 (top-ranked candidate from Task 5)

**Files:**
- Create: `<VITEST_PATH>` (path determined during Step 2 by the skill)
- Delete: `<E2E_PATH>`
- Reference: `<SOURCE_PATH>`

- [ ] **Step 1: Read the e2e and capture assertions**

Use `Read` on `<E2E_PATH>` (full file). Write a bullet list of every assertion the e2e makes — these are the behaviors the new vitest must reproduce (coverage parity). Save them to `<E2E_ASSERTIONS>` (a scratch variable for use in Step 4 commit message and the user-facing test plan).

Also note: which fixtures does the e2e use (`app`, `python`, `r`, `sessions`, `executeCode`)? If the e2e relies on a runtime fixture for the assertions to even fire, the audit was wrong — demote this candidate, pick the next from `/tmp/audit-ranked.md`, and restart Task 6 with the new candidate.

- [ ] **Step 2: Invoke the `author-vitest-tests` skill**

Run:

```
Skill({ skill: "author-vitest-tests", args: "<SOURCE_PATH>" })
```

Pass `<SOURCE_PATH>` (the source file under test) as `$ARGUMENTS`, not the e2e path. The skill will:

1. Skip Phase 1 (we're not analyzing a branch — we have a specific source file).
2. Run Phase 2 Prepare (read source, check decision table, skim builder JSDoc).
3. Run Phase 2 Draft test plan and **STOP for user confirmation**. This is the mandatory gate. The skill will present a plan with: pattern choice, preset, stubs, test cases. You must wait for the user to approve before proceeding.

When the skill presents its draft plan, augment your message to the user with the e2e context so they can sanity-check coverage parity:

> The author-vitest-tests skill has drafted the above plan. For coverage parity, here are the assertions in the e2e being replaced:
>
> <paste E2E_ASSERTIONS bullet list>
>
> Confirm the test plan covers these, or request additions before I write.

If the user requests changes, relay them to the skill and let it revise.

- [ ] **Step 3: Skill writes, lints, runs, and reviews**

Once the user confirms, the skill continues autonomously through:

- Phase 2 Writing: creates the vitest at `<VITEST_PATH>` (skill-determined), runs `npx vitest run`, runs `npx eslint`, iterates until green.
- Builder enforcement: greps for `positronWorkbenchInstantiationService` / `new TestInstantiationService` and rewrites if found.
- Phase 3 Independent Review: dispatches a `review-vitest-tests` subagent, applies its fixes, re-runs.

You don't drive these steps — the skill does. Wait for it to return with a final summary.

If the skill hits a hard blocker (test won't pass without 5+ stubs, source genuinely needs a runtime, etc.), capture the reason, demote this candidate, and pick the next ranked from `/tmp/audit-ranked.md`. Restart Task 6 with the new candidate.

- [ ] **Step 4: Coverage parity check**

The skill doesn't know about the e2e being replaced. Manually verify:

1. `Read` the new vitest at `<VITEST_PATH>`.
2. For each bullet in `<E2E_ASSERTIONS>`, find the matching `it()` block or assertion in the new vitest.
3. Any e2e assertion with no vitest equivalent must be added now: revise the vitest, re-run `npx vitest run <VITEST_PATH>`, re-run `npx eslint --max-warnings 0 <VITEST_PATH>`.

Do not proceed to deletion until every e2e assertion has a vitest counterpart.

- [ ] **Step 5: Delete the e2e and verify no orphans**

Run:

```bash
git rm <E2E_PATH>
grep -rn "<E2E_NAME>" test/e2e/ src/ --include="*.ts" --include="*.tsx" --include="*.json" || echo "no orphans"
```

Expected: "no orphans". If any results show up, decide each one:
- Imports of helpers from the deleted file → move the helper to a shared `test/e2e/.../helpers/` file (do not move e2e helpers into the vitest directory).
- References in `package.json`, `playwright.config.ts`, or tag lists → remove the entry.
- References in CI config → remove the entry.

If anything orphaned is non-trivial (shared helper used by other e2es), unstage the delete (`git restore --staged <E2E_PATH>`), keep the e2e, demote this candidate, pick the next ranked.

- [ ] **Step 6: Format and precommit**

Run:

```bash
node scripts/format.mts <VITEST_PATH>
npm run precommit -- <VITEST_PATH> <E2E_PATH>
```

Expected: zero issues. The skill should have produced a clean file already; this is a final guard.

- [ ] **Step 7: Commit**

```bash
git add <VITEST_PATH>
git commit -m "$(cat <<'EOF'
test: migrate <E2E_NAME> e2e to vitest

Replaces e2e test with vitest covering the same assertions:
- <assertion 1>
- <assertion 2>
- <assertion 3>

The e2e was unnecessary because <one-line reason from audit row>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<E2E_NAME>`, the assertion bullets (from `<E2E_ASSERTIONS>`), and the reason with concrete values. Expected: one commit containing the new vitest and the deleted e2e.

The `author-vitest-tests` skill's hard rule is "Don't auto-commit" — that rule is about the skill itself not committing during its run. Committing here, *after* the skill completes and the user has confirmed the test plan, is consistent with the spec's authorized commit cadence.

- [ ] **Step 8: Verify commit shape**

Run:

```bash
git show --stat HEAD
```

Expected: exactly one file added (vitest), exactly one file deleted (e2e). If anything else slipped in (e.g. node_modules symlink — see `feedback_worktree_git_add.md`), `git reset --soft HEAD~1`, fix staging, recommit.

---

## Task 7: Migration 2 (rank-2 candidate from Task 5)

> Fill placeholders from rank 2 of `/tmp/audit-top5.md` before starting:
> `<E2E_PATH>`, `<E2E_NAME>`, `<SOURCE_PATH>`, `<E2E_ASSERTIONS>`, `<VITEST_PATH>`.

**Files:**
- Create: `<VITEST_PATH>` (path determined during Step 2 by the skill)
- Delete: `<E2E_PATH>`
- Reference: `<SOURCE_PATH>`

- [ ] **Step 1: Read the e2e and capture assertions**

Use `Read` on `<E2E_PATH>` (full file). Write a bullet list of every assertion the e2e makes — these are the behaviors the new vitest must reproduce (coverage parity). Save them to `<E2E_ASSERTIONS>`.

Also note: which fixtures does the e2e use (`app`, `python`, `r`, `sessions`, `executeCode`)? If the e2e relies on a runtime fixture for the assertions to even fire, the audit was wrong — demote this candidate, pick the next from `/tmp/audit-ranked.md`, and restart Task 7 with the new candidate.

- [ ] **Step 2: Invoke the `author-vitest-tests` skill**

Run:

```
Skill({ skill: "author-vitest-tests", args: "<SOURCE_PATH>" })
```

Pass `<SOURCE_PATH>` (the source file under test) as `$ARGUMENTS`. The skill will: skip Phase 1; run Phase 2 Prepare; run Phase 2 Draft test plan and **STOP for user confirmation** (mandatory gate).

When the skill presents its draft plan, augment your message to the user:

> The author-vitest-tests skill has drafted the above plan. For coverage parity, here are the assertions in the e2e being replaced:
>
> <paste E2E_ASSERTIONS bullet list>
>
> Confirm the test plan covers these, or request additions before I write.

If the user requests changes, relay them to the skill and let it revise.

- [ ] **Step 3: Skill writes, lints, runs, and reviews**

Once confirmed, the skill runs Phase 2 Writing (creates vitest at `<VITEST_PATH>`, runs `npx vitest`, runs `npx eslint`, iterates), Builder enforcement (greps for forbidden DI patterns), and Phase 3 Independent Review (dispatches `review-vitest-tests` subagent, applies fixes, re-runs).

You don't drive these — the skill does. Wait for it to return.

If the skill hits a hard blocker (5+ stubs needed, source needs runtime, etc.), capture the reason, demote this candidate, pick the next ranked from `/tmp/audit-ranked.md`. Restart Task 7 with the new candidate.

- [ ] **Step 4: Coverage parity check**

The skill doesn't know about the e2e. Manually verify:

1. `Read` the new vitest at `<VITEST_PATH>`.
2. For each bullet in `<E2E_ASSERTIONS>`, find the matching `it()` block.
3. Any e2e assertion with no vitest equivalent must be added now: revise the vitest, re-run `npx vitest run <VITEST_PATH>`, re-run `npx eslint --max-warnings 0 <VITEST_PATH>`.

Do not proceed to deletion until every e2e assertion has a vitest counterpart.

- [ ] **Step 5: Delete the e2e and verify no orphans**

Run:

```bash
git rm <E2E_PATH>
grep -rn "<E2E_NAME>" test/e2e/ src/ --include="*.ts" --include="*.tsx" --include="*.json" || echo "no orphans"
```

Expected: "no orphans". If references show up: helpers used elsewhere → move them; references in `package.json` / `playwright.config.ts` / CI config / tag lists → remove; if anything non-trivial, unstage the delete, keep the e2e, demote, pick next.

- [ ] **Step 6: Format and precommit**

Run:

```bash
node scripts/format.mts <VITEST_PATH>
npm run precommit -- <VITEST_PATH> <E2E_PATH>
```

Expected: zero issues.

- [ ] **Step 7: Commit**

```bash
git add <VITEST_PATH>
git commit -m "$(cat <<'EOF'
test: migrate <E2E_NAME> e2e to vitest

Replaces e2e test with vitest covering the same assertions:
- <assertion 1>
- <assertion 2>
- <assertion 3>

The e2e was unnecessary because <one-line reason from audit row>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<E2E_NAME>`, the assertion bullets (from `<E2E_ASSERTIONS>`), and the reason with concrete values.

- [ ] **Step 8: Verify commit shape**

Run:

```bash
git show --stat HEAD
```

Expected: exactly one file added (vitest), exactly one file deleted (e2e). If anything else slipped in, `git reset --soft HEAD~1`, fix staging, recommit.

---

## Task 8: Migration 3 (rank-3 candidate from Task 5)

> Fill placeholders from rank 3 of `/tmp/audit-top5.md` before starting:
> `<E2E_PATH>`, `<E2E_NAME>`, `<SOURCE_PATH>`, `<E2E_ASSERTIONS>`, `<VITEST_PATH>`.

**Files:**
- Create: `<VITEST_PATH>` (path determined during Step 2 by the skill)
- Delete: `<E2E_PATH>`
- Reference: `<SOURCE_PATH>`

- [ ] **Step 1: Read the e2e and capture assertions**

Use `Read` on `<E2E_PATH>` (full file). Write a bullet list of every assertion the e2e makes — these are the behaviors the new vitest must reproduce (coverage parity). Save them to `<E2E_ASSERTIONS>`.

Also note: which fixtures does the e2e use (`app`, `python`, `r`, `sessions`, `executeCode`)? If the e2e relies on a runtime fixture for the assertions to even fire, the audit was wrong — demote this candidate, pick the next from `/tmp/audit-ranked.md`, and restart Task 8 with the new candidate.

- [ ] **Step 2: Invoke the `author-vitest-tests` skill**

Run:

```
Skill({ skill: "author-vitest-tests", args: "<SOURCE_PATH>" })
```

Pass `<SOURCE_PATH>` (the source file under test) as `$ARGUMENTS`. The skill will: skip Phase 1; run Phase 2 Prepare; run Phase 2 Draft test plan and **STOP for user confirmation** (mandatory gate).

When the skill presents its draft plan, augment your message to the user:

> The author-vitest-tests skill has drafted the above plan. For coverage parity, here are the assertions in the e2e being replaced:
>
> <paste E2E_ASSERTIONS bullet list>
>
> Confirm the test plan covers these, or request additions before I write.

If the user requests changes, relay them to the skill and let it revise.

- [ ] **Step 3: Skill writes, lints, runs, and reviews**

Once confirmed, the skill runs Phase 2 Writing (creates vitest at `<VITEST_PATH>`, runs `npx vitest`, runs `npx eslint`, iterates), Builder enforcement (greps for forbidden DI patterns), and Phase 3 Independent Review (dispatches `review-vitest-tests` subagent, applies fixes, re-runs).

You don't drive these — the skill does. Wait for it to return.

If the skill hits a hard blocker (5+ stubs needed, source needs runtime, etc.), capture the reason, demote this candidate, pick the next ranked from `/tmp/audit-ranked.md`. Restart Task 8 with the new candidate.

- [ ] **Step 4: Coverage parity check**

The skill doesn't know about the e2e. Manually verify:

1. `Read` the new vitest at `<VITEST_PATH>`.
2. For each bullet in `<E2E_ASSERTIONS>`, find the matching `it()` block.
3. Any e2e assertion with no vitest equivalent must be added now: revise the vitest, re-run `npx vitest run <VITEST_PATH>`, re-run `npx eslint --max-warnings 0 <VITEST_PATH>`.

Do not proceed to deletion until every e2e assertion has a vitest counterpart.

- [ ] **Step 5: Delete the e2e and verify no orphans**

Run:

```bash
git rm <E2E_PATH>
grep -rn "<E2E_NAME>" test/e2e/ src/ --include="*.ts" --include="*.tsx" --include="*.json" || echo "no orphans"
```

Expected: "no orphans". If references show up: helpers used elsewhere → move them; references in `package.json` / `playwright.config.ts` / CI config / tag lists → remove; if anything non-trivial, unstage the delete, keep the e2e, demote, pick next.

- [ ] **Step 6: Format and precommit**

Run:

```bash
node scripts/format.mts <VITEST_PATH>
npm run precommit -- <VITEST_PATH> <E2E_PATH>
```

Expected: zero issues.

- [ ] **Step 7: Commit**

```bash
git add <VITEST_PATH>
git commit -m "$(cat <<'EOF'
test: migrate <E2E_NAME> e2e to vitest

Replaces e2e test with vitest covering the same assertions:
- <assertion 1>
- <assertion 2>
- <assertion 3>

The e2e was unnecessary because <one-line reason from audit row>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<E2E_NAME>`, the assertion bullets (from `<E2E_ASSERTIONS>`), and the reason with concrete values.

- [ ] **Step 8: Verify commit shape**

Run:

```bash
git show --stat HEAD
```

Expected: exactly one file added (vitest), exactly one file deleted (e2e). If anything else slipped in, `git reset --soft HEAD~1`, fix staging, recommit.

---

## Task 9: Migration 4 (rank-4 candidate from Task 5)

> Fill placeholders from rank 4 of `/tmp/audit-top5.md` before starting:
> `<E2E_PATH>`, `<E2E_NAME>`, `<SOURCE_PATH>`, `<E2E_ASSERTIONS>`, `<VITEST_PATH>`.

**Files:**
- Create: `<VITEST_PATH>` (path determined during Step 2 by the skill)
- Delete: `<E2E_PATH>`
- Reference: `<SOURCE_PATH>`

- [ ] **Step 1: Read the e2e and capture assertions**

Use `Read` on `<E2E_PATH>` (full file). Write a bullet list of every assertion the e2e makes — these are the behaviors the new vitest must reproduce (coverage parity). Save them to `<E2E_ASSERTIONS>`.

Also note: which fixtures does the e2e use (`app`, `python`, `r`, `sessions`, `executeCode`)? If the e2e relies on a runtime fixture for the assertions to even fire, the audit was wrong — demote this candidate, pick the next from `/tmp/audit-ranked.md`, and restart Task 9 with the new candidate.

- [ ] **Step 2: Invoke the `author-vitest-tests` skill**

Run:

```
Skill({ skill: "author-vitest-tests", args: "<SOURCE_PATH>" })
```

Pass `<SOURCE_PATH>` (the source file under test) as `$ARGUMENTS`. The skill will: skip Phase 1; run Phase 2 Prepare; run Phase 2 Draft test plan and **STOP for user confirmation** (mandatory gate).

When the skill presents its draft plan, augment your message to the user:

> The author-vitest-tests skill has drafted the above plan. For coverage parity, here are the assertions in the e2e being replaced:
>
> <paste E2E_ASSERTIONS bullet list>
>
> Confirm the test plan covers these, or request additions before I write.

If the user requests changes, relay them to the skill and let it revise.

- [ ] **Step 3: Skill writes, lints, runs, and reviews**

Once confirmed, the skill runs Phase 2 Writing (creates vitest at `<VITEST_PATH>`, runs `npx vitest`, runs `npx eslint`, iterates), Builder enforcement (greps for forbidden DI patterns), and Phase 3 Independent Review (dispatches `review-vitest-tests` subagent, applies fixes, re-runs).

You don't drive these — the skill does. Wait for it to return.

If the skill hits a hard blocker (5+ stubs needed, source needs runtime, etc.), capture the reason, demote this candidate, pick the next ranked from `/tmp/audit-ranked.md`. Restart Task 9 with the new candidate.

- [ ] **Step 4: Coverage parity check**

The skill doesn't know about the e2e. Manually verify:

1. `Read` the new vitest at `<VITEST_PATH>`.
2. For each bullet in `<E2E_ASSERTIONS>`, find the matching `it()` block.
3. Any e2e assertion with no vitest equivalent must be added now: revise the vitest, re-run `npx vitest run <VITEST_PATH>`, re-run `npx eslint --max-warnings 0 <VITEST_PATH>`.

Do not proceed to deletion until every e2e assertion has a vitest counterpart.

- [ ] **Step 5: Delete the e2e and verify no orphans**

Run:

```bash
git rm <E2E_PATH>
grep -rn "<E2E_NAME>" test/e2e/ src/ --include="*.ts" --include="*.tsx" --include="*.json" || echo "no orphans"
```

Expected: "no orphans". If references show up: helpers used elsewhere → move them; references in `package.json` / `playwright.config.ts` / CI config / tag lists → remove; if anything non-trivial, unstage the delete, keep the e2e, demote, pick next.

- [ ] **Step 6: Format and precommit**

Run:

```bash
node scripts/format.mts <VITEST_PATH>
npm run precommit -- <VITEST_PATH> <E2E_PATH>
```

Expected: zero issues.

- [ ] **Step 7: Commit**

```bash
git add <VITEST_PATH>
git commit -m "$(cat <<'EOF'
test: migrate <E2E_NAME> e2e to vitest

Replaces e2e test with vitest covering the same assertions:
- <assertion 1>
- <assertion 2>
- <assertion 3>

The e2e was unnecessary because <one-line reason from audit row>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<E2E_NAME>`, the assertion bullets (from `<E2E_ASSERTIONS>`), and the reason with concrete values.

- [ ] **Step 8: Verify commit shape**

Run:

```bash
git show --stat HEAD
```

Expected: exactly one file added (vitest), exactly one file deleted (e2e). If anything else slipped in, `git reset --soft HEAD~1`, fix staging, recommit.

---

## Task 10: Migration 5 (rank-5 candidate from Task 5)

> Fill placeholders from rank 5 of `/tmp/audit-top5.md` before starting:
> `<E2E_PATH>`, `<E2E_NAME>`, `<SOURCE_PATH>`, `<E2E_ASSERTIONS>`, `<VITEST_PATH>`.

**Files:**
- Create: `<VITEST_PATH>` (path determined during Step 2 by the skill)
- Delete: `<E2E_PATH>`
- Reference: `<SOURCE_PATH>`

- [ ] **Step 1: Read the e2e and capture assertions**

Use `Read` on `<E2E_PATH>` (full file). Write a bullet list of every assertion the e2e makes — these are the behaviors the new vitest must reproduce (coverage parity). Save them to `<E2E_ASSERTIONS>`.

Also note: which fixtures does the e2e use (`app`, `python`, `r`, `sessions`, `executeCode`)? If the e2e relies on a runtime fixture for the assertions to even fire, the audit was wrong — demote this candidate, pick the next from `/tmp/audit-ranked.md`, and restart Task 10 with the new candidate.

- [ ] **Step 2: Invoke the `author-vitest-tests` skill**

Run:

```
Skill({ skill: "author-vitest-tests", args: "<SOURCE_PATH>" })
```

Pass `<SOURCE_PATH>` (the source file under test) as `$ARGUMENTS`. The skill will: skip Phase 1; run Phase 2 Prepare; run Phase 2 Draft test plan and **STOP for user confirmation** (mandatory gate).

When the skill presents its draft plan, augment your message to the user:

> The author-vitest-tests skill has drafted the above plan. For coverage parity, here are the assertions in the e2e being replaced:
>
> <paste E2E_ASSERTIONS bullet list>
>
> Confirm the test plan covers these, or request additions before I write.

If the user requests changes, relay them to the skill and let it revise.

- [ ] **Step 3: Skill writes, lints, runs, and reviews**

Once confirmed, the skill runs Phase 2 Writing (creates vitest at `<VITEST_PATH>`, runs `npx vitest`, runs `npx eslint`, iterates), Builder enforcement (greps for forbidden DI patterns), and Phase 3 Independent Review (dispatches `review-vitest-tests` subagent, applies fixes, re-runs).

You don't drive these — the skill does. Wait for it to return.

If the skill hits a hard blocker (5+ stubs needed, source needs runtime, etc.), capture the reason, demote this candidate, pick the next ranked from `/tmp/audit-ranked.md`. Restart Task 10 with the new candidate.

- [ ] **Step 4: Coverage parity check**

The skill doesn't know about the e2e. Manually verify:

1. `Read` the new vitest at `<VITEST_PATH>`.
2. For each bullet in `<E2E_ASSERTIONS>`, find the matching `it()` block.
3. Any e2e assertion with no vitest equivalent must be added now: revise the vitest, re-run `npx vitest run <VITEST_PATH>`, re-run `npx eslint --max-warnings 0 <VITEST_PATH>`.

Do not proceed to deletion until every e2e assertion has a vitest counterpart.

- [ ] **Step 5: Delete the e2e and verify no orphans**

Run:

```bash
git rm <E2E_PATH>
grep -rn "<E2E_NAME>" test/e2e/ src/ --include="*.ts" --include="*.tsx" --include="*.json" || echo "no orphans"
```

Expected: "no orphans". If references show up: helpers used elsewhere → move them; references in `package.json` / `playwright.config.ts` / CI config / tag lists → remove; if anything non-trivial, unstage the delete, keep the e2e, demote, pick next.

- [ ] **Step 6: Format and precommit**

Run:

```bash
node scripts/format.mts <VITEST_PATH>
npm run precommit -- <VITEST_PATH> <E2E_PATH>
```

Expected: zero issues.

- [ ] **Step 7: Commit**

```bash
git add <VITEST_PATH>
git commit -m "$(cat <<'EOF'
test: migrate <E2E_NAME> e2e to vitest

Replaces e2e test with vitest covering the same assertions:
- <assertion 1>
- <assertion 2>
- <assertion 3>

The e2e was unnecessary because <one-line reason from audit row>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<E2E_NAME>`, the assertion bullets (from `<E2E_ASSERTIONS>`), and the reason with concrete values.

- [ ] **Step 8: Verify commit shape**

Run:

```bash
git show --stat HEAD
```

Expected: exactly one file added (vitest), exactly one file deleted (e2e). If anything else slipped in, `git reset --soft HEAD~1`, fix staging, recommit.

---

## Task 11: Final verification and report update

**Files:**
- Modify: `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md` — fill in commit SHAs for the 5 migrations.

- [ ] **Step 1: Run all 5 new vitests together**

Run:

```bash
npx vitest run <VITEST_PATH_1> <VITEST_PATH_2> <VITEST_PATH_3> <VITEST_PATH_4> <VITEST_PATH_5>
```

Expected: all green.

- [ ] **Step 2: Sanity-run the full vitest suite**

Run:

```bash
npm run test:positron
```

Expected: full suite still green. If anything regresses, identify which migration broke it (`git bisect` across the 5 commits if needed) and revert that one commit; re-add it to the backlog.

- [ ] **Step 3: Confirm git state**

Run:

```bash
git log --oneline main..HEAD
git status
```

Expected: at least 7 commits ahead of main (1 design + 1 report + 5 migrations); working tree clean.

- [ ] **Step 4: Update the report with commit SHAs**

For each of the 5 migrations, get the commit SHA:

```bash
git log --grep "test: migrate" --pretty="%h %s" -5
```

Use `Edit` on `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md` to replace `_pending_` in the "Top 5 selected for migration" table with each migration's short SHA.

If any migration was demoted during execution (replaced by next-ranked), update the row to show the actual migration that ran, and add a note in the backlog section about the demoted candidate and why.

- [ ] **Step 5: Commit the report update**

```bash
git add docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md
git commit -m "$(cat <<'EOF'
docs: record commit SHAs for migrated e2e tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Print final summary to the user**

Output a single message containing:
- Number of e2e tests audited (182).
- Number of e2e tests migrated this session (5, or fewer if any demoted).
- Number of remaining Strong-migrate / Dupe candidates in the backlog.
- Number of coverage-gap follow-ups logged.
- Path to the report.
- The 5 commit SHAs.

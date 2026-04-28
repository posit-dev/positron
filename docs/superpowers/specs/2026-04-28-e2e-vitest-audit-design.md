# E2E → Vitest audit and migration

**Date:** 2026-04-28
**Branch:** `mi/dapper-cellar`
**Author:** Marie Idleman

## Problem

Positron has 182 e2e Playwright tests and 92 Vitest tests. Vitest provides much faster feedback than e2e. Some e2e tests likely overlap with existing vitests (dupes), and others test logic that doesn't need the full app and would be better as vitests. We want to find these and migrate them to reduce e2e burden.

## Goals

- Classify every e2e test in `test/e2e/tests/**` against a fixed rubric.
- Produce a single ranked report of migration candidates and coverage gaps.
- Execute the top 5 highest-confidence migrations end-to-end this session (write vitest, delete e2e, verify, commit).

## Non-goals (this session)

- Implementing coverage-gap tests (e2e-only, no vitest counterpart, but unit-testable). Logged as follow-ups, not built.
- Auditing extension-host tests under `extensions/**/test/`.
- Refactoring source code to make tests easier to migrate. Tests are written against the code as it is.
- Slimming `Partial-overlap` e2e tests. Deferred — riskier, needs per-test judgment.

## Audit methodology

### Rubric

For every e2e file, the audit produces one row:

| Field | Values |
|---|---|
| `test_file` | repo path |
| `verdict` | `Dupe` / `Strong-migrate` / `Partial-overlap` / `Keep` / `Coverage-gap` / `Unclear` |
| `confidence` | High / Med / Low |
| `vitest_counterpart` | repo path or `none` |
| `source_under_test` | repo path(s) — what the e2e is really exercising |
| `why_e2e_unnecessary` | one-line rationale (only if Strong-migrate / Dupe) |
| `notes` | flags, edge cases, anything weird |

### Verdict definitions

- **Dupe**: same source, same assertions already covered in vitest. Action: delete e2e.
- **Strong-migrate**: e2e tests pure logic / single component / formatted output with no real runtime needed. No existing vitest. Action: write vitest, delete e2e.
- **Partial-overlap**: some assertions are migratable; full e2e workflow worth keeping. Action (deferred): extract migratable bits to vitest, slim the e2e.
- **Keep**: needs real runtime, cross-pane interaction, IPC, or network. No action.
- **Coverage-gap**: e2e is the only coverage, but the source is unit-testable. Action: log for future vitest backfill.
- **Unclear**: deeper read needed. Action: I personally re-audit before ranking.

### Agent dispatch

Nine parallel `Explore` subagents, one per bucket. Each agent receives:
- The full rubric.
- The full vitest inventory (all 92 paths) so they can match counterparts.
- A strict output schema (one markdown row per file, no prose).
- Instruction to read each test file in full plus the source under test plus any candidate vitest before classifying. No verdict from filename alone.

Bucket layout:

| # | Bucket | Directories |
|---|---|---|
| 1 | Positron notebooks | `notebooks-positron/` |
| 2 | Notebook + Quarto + Rmd | `notebook/`, `quarto/`, `r-markdown/` |
| 3 | Data Explorer | `data-explorer/` |
| 4 | Console + Output + Variables | `console/`, `output/`, `variables/`, `environment-pane/` |
| 5 | Editor surfaces | `editor/`, `editor-action-bar/`, `top-action-bar/`, `code-actions/`, `references/`, `autocomplete/`, `diagnostics/`, `search/`, `evaluation/` |
| 6 | Visual outputs | `plots/`, `viewer/`, `pdf/`, `apps/`, `shiny/`, `catalog-explorer/` |
| 7 | Assistant + LSP | `assistant/`, `assistant-eval/`, `posit-assistant/`, `lsp/` |
| 8 | Runtime + Sessions | `connections/`, `debug/`, `reticulate/`, `interpreters/`, `sessions/` |
| 9 | Workbench surfaces | `extensions/`, `import-vs-code-settings/`, `new-folder-flow/`, `welcome/`, `help/`, `layouts/`, `workbench/`, `tasks/`, `test-explorer/`, `scm/`, `r-pkg-development/`, `remote-ssh/` |

Each agent writes its findings to `/tmp/audit-bucket-<n>.md`.

### Synthesis and ranking

After agents return:
1. Concatenate bucket outputs into the report at `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md`.
2. Re-audit any `Unclear` rows manually.
3. Rank candidates with this scoring:
   - +3 High confidence, +1 Med confidence
   - +2 Dupe (cheapest — vitest already exists)
   - +2 Strong-migrate with small scope (single file, < ~150 lines of test code)
   - −1 Partial-overlap (always more work)
   - −2 Touches React component or async user-event sequencing (more careful migration)
4. Pick the top 5 by score for execution.

## Migration recipe (per candidate)

Each of the 5 migrations follows this sequence:

1. Read the e2e test in full + the source under test + any existing vitest in the area.
2. Choose pattern using the project's testing rules:
   - Pure function → plain vitest (`positronUpdateUtils.vitest.ts` style)
   - Service / DI class → builder vitest (`createTestContainer().withX().build()`)
   - React component, props only → RTL prop-driven (`setupRTLRenderer`)
   - React component using services → RTL service-context (`withReactServices`)
3. Write the new `*.vitest.ts` / `*.vitest.tsx` next to the source (match `test/` vs `tests/` convention).
4. Run it: `npx vitest run <file>` until green.
5. Lint it: `npx eslint --max-warnings 0 <file>`.
6. Delete the e2e file: `git rm test/e2e/tests/.../<name>.test.ts`.
7. Verify no orphaned imports/helpers in `test/e2e/` (grep for the deleted basename).
8. Format + precommit: `node scripts/format.mts <new-file>` then `npm run precommit -- <new-file> <deleted-e2e>`.
9. Commit as one atomic commit per migration: `test: migrate <name> e2e to vitest`. One commit per migration so each is independently revertable.

## Constraints

- Builder anti-patterns from `.claude/rules/vitest-tests.md` apply: no `positronWorkbenchInstantiationService()`, no direct `TestInstantiationService`, no wide-interface `as unknown as <Interface>` casts (use `stubInterface<T>()`).
- RTL conventions enforced by `eslint-plugin-testing-library` and `eslint-plugin-jest-dom`. No `eslint-disable` of those rules without a one-line justification naming the real constraint.
- Coverage parity: every assertion in the deleted e2e must have an equivalent (or stronger) assertion in the new vitest. The commit message lists the replaced assertions.
- Vitest does not need build daemons. Lint may; confirm `npm run build-ps` status before starting if needed.

## Stop conditions

A migration stops and the candidate is demoted to a follow-up note if:
- The vitest needs to mock 5+ services — signals entangled source that needs refactor first (out of scope).
- The e2e genuinely depends on real runtime output we can't replicate. Audit was wrong; demote verdict and document why.
- Lint flags an unavoidable RTL anti-pattern. Surface it; do not suppress.

## Verification before claiming done

End of session:
- `npx vitest run <new-files>` plus a sanity run of all vitest.
- `git status` confirms 5 commits, 5 e2e deletions, 5 vitest additions.
- Audit report updated: 5 candidates marked `Migrated` with commit SHAs.
- Final summary message lists the 5 migrations, remaining backlog count, coverage-gap count.

## Deliverables

- `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-design.md` — this design.
- `docs/superpowers/specs/2026-04-28-e2e-vitest-audit-report.md` — the findings table (created after audit, updated after migrations).
- 5 commits, each: 1 vitest added + 1 e2e deleted.
- Final summary: 5 migrations + remaining backlog count + coverage-gap count.

## Follow-ups (logged in report, not built this session)

- Coverage-gap tests (e2e-only, unit-testable source) — separate planning pass.
- `Partial-overlap` slim-downs.
- `Unclear` rows after manual re-audit.
- Extension-host test audit under `extensions/**/test/`.

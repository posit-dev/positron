# e2e Tag Audit Feedback Loop - Design

- Date: 2026-07-01
- Status: Approved (brainstorm); ready for implementation plan
- Depends on: `scripts/lib/pr-tags-lib.sh` (introduced on branch `mi/military-mallow` / PR #14602)

## Problem

`e2e-tag-paths-map.json` derives e2e feature tags from a PR's changed source
dirs. It is a hand-authored approximation of "which suite covers this code," so
it drifts: dirs split, new features land, and a directory name does not always
equal actual coverage (e.g. `positron-catalog-explorer/src/catalogs/snowflake.ts`
is covered by `@:workbench-snowflake`, not the `@:catalog-explorer` its dir maps
to). Today, catching that drift requires someone remembering to run an ad-hoc
audit by hand. We want that audit to run continuously, cheaply, and
human-in-the-loop.

## Goals

- Surface map drift automatically and regularly, from real merged PRs.
- Reuse the production derivation logic so the audit can never diverge from what
  actually ships on PRs.
- Read-only: never mutate the map or a PR's tags.
- Low maintenance: a weekly report a human skims and acts on.

## Non-goals

- No change to the per-PR derivation mechanism or the map format.
- **No auto-editing the map and no auto-PR.** Whether a divergence should become
  a map entry is a subjective call (contrast: 14248 R-interpreter *should* be
  added; snowflake -> `@:workbench-snowflake` should *not*). A wrong auto-edit
  silently corrupts test selection, which is the exact failure this system
  exists to prevent. The loop stays human-in-the-loop.
- No coverage instrumentation / test-impact analysis (considered; deferred as
  too much infra).
- No LLM in the loop (nondeterministic; would gate CI on an external service).

## Architecture

Two components plus one shared pure primitive.

### Shared primitive (`scripts/lib/pr-tags-lib.sh`)

Add a pure, unit-tested set-difference helper:

```
csv_minus <a_csv> <b_csv>
  Echoes the comma-separated, order-stable tags present in a but not in b.
```

The audit uses it to compute, per PR:
- **gap** = `csv_minus <author_tags> <auto_tags>` - a tag the author set that the
  map did not derive -> candidate map gap (highest-value signal).
- **review** = `csv_minus <auto_tags> <author_tags>` - a tag the map derived that
  the author did not set -> either over-tag or a good catch (needs human).
- match = present in both (informational).

### Component A: `scripts/audit-e2e-tags.sh`

- Usage:
  - `audit-e2e-tags.sh [N] [SKIP]` - manual window: last N merged PRs to `main`,
    skipping the first SKIP (defaults N=50, SKIP=0).
  - `audit-e2e-tags.sh --since <ISO-date>` - PRs merged on/after a date (used by
    the scheduled job).
- Sources `pr-tags-lib.sh` and reuses `derive_map_tags` + `is_derivable_source`
  (identical to production) and `csv_minus` - the audit cannot drift from reality.
- For each merged PR in the window:
  - Fetch body -> extract `@:` tags, restricted to the map's tag vocabulary
    (feature tags only; platform/build-variant tags like `@:win`, `@:workbench-*`
    are excluded from the comparison).
  - Fetch changed files -> `derive_map_tags`.
  - Compute gap and review via `csv_minus`.
- Output (stdout, Markdown):
  1. A divergence table: `PR | author | auto | gap | review | title`.
  2. Summary counts (PRs examined, with-gap, with-review, clean).
  3. A "gap hints" block: for each gap PR, the missing tag plus the PR's changed
     Positron dirs (via `positron_dir_of`) as *candidates* a human might map.
     Advisory only - it does not emit a ready-to-apply JSON diff, because
     attributing a missing tag to a specific dir is the subjective step we keep
     with the human.
- Read-only. No writes to the map or GitHub.

### Component B: `.github/workflows/e2e-tag-audit.yml`

- Triggers: `schedule` cron `0 12 * * 1` (Monday 12:00 UTC ~ 6am CT; DST drift of
  1h across the year is accepted for a weekly report) and `workflow_dispatch`
  (manual).
- Steps: checkout; run `audit-e2e-tags.sh --since <7 days ago>`; write the report
  to `$GITHUB_STEP_SUMMARY` (always, durable in the run); upsert a single
  tracking issue.
- Issue upsert: find an **open** issue by a fixed marker (label `e2e-tag-audit` +
  title). If found, edit its body with the current report; else create it,
  assigned to `@marieidleman`, labeled `e2e-tag-audit`. A closed issue is treated
  as acted-on -> create a fresh one rather than reopen.
- Permissions: `contents: read`, `pull-requests: read`, `issues: write`. Uses
  `gh` with `GITHUB_TOKEN`.

### Data flow

```
cron (Mon 12:00 UTC)
  -> workflow
    -> audit-e2e-tags.sh --since <7d ago>
      -> gh: list merged PRs (last 7d) + per-PR files/body
      -> derive_map_tags + is_derivable_source (shared lib)
      -> csv_minus -> gap / review
    -> Markdown report
      -> $GITHUB_STEP_SUMMARY
      -> upsert tracking issue (assigned to Marie)
```

## Report format (illustrative)

```
## e2e tag audit - week of 2026-06-23..2026-06-29

Examined 41 merged PRs: 3 gaps, 6 review, 32 clean.

| PR | author | auto | gap | review | title |
|----|--------|------|-----|--------|-------|
| 14248 | @:interpreter | @:ark | @:interpreter | @:ark | Fix runtime cache missing R versions |
| ...   |               |      |     |        |       |

### Gap hints (author had a tag the map did not derive)
- #14248 `@:interpreter` - changed Positron dirs: extensions/positron-r/
```

## Testing

- Unit: `csv_minus` in `scripts/test/pr-tags-lib-test.sh` - a-not-in-b,
  order-stable, empty-a, empty-b, no-overlap, full-overlap.
- The `gh` fetch, Markdown formatting, and issue upsert are glue: validated by a
  manual `workflow_dispatch` run, not unit-tested.

### Testing from the feature branch (no merge required)

- **Script:** runs locally today. This branch (`mi/e2e-tag-audit`) is cut from
  `mi/military-mallow`, so `pr-tags-lib.sh` is present - `bash
  scripts/audit-e2e-tags.sh 50` works with local `gh` auth, exactly like the
  ad-hoc audit run during brainstorming.
- **Workflow:** `workflow_dispatch` runs from any branch that contains the
  workflow file: `gh workflow run e2e-tag-audit.yml --ref mi/e2e-tag-audit`
  exercises the full path (fetch -> report -> job summary -> issue upsert) while
  still on the branch.
- **Only the `schedule:` cron** requires the file on the default branch; that is
  the sole step that waits for merge.

## Rollout

1. Land `csv_minus` + `audit-e2e-tags.sh` with unit tests.
2. Add the workflow with `workflow_dispatch` only; run it manually to validate
   the report and the issue upsert.
3. Enable the `schedule` trigger once the manual run looks right.
4. Rebase onto `main` after PR #14602 (the `pr-tags-lib.sh` dependency) merges.

## Risks / accepted tradeoffs

- **Gap hints are heuristic** (dir attribution is fuzzy) - kept advisory,
  human decides. This is deliberate, not a defect.
- **Cron DST drift** of 1 hour - accepted for a weekly report.
- **Issue-upsert identity** relies on a stable label + title marker; a manually
  renamed/relabeled issue would cause a duplicate. Low impact.

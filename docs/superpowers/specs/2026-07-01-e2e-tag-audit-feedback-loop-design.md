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
- **No auto-editing the map and no auto-PR.** The report may include a *suggested*
  JSON diff, but a human reviews and applies it by hand. Whether a divergence
  should become a map entry is a subjective call (contrast: 14248 R-interpreter
  *should* be added; snowflake -> `@:workbench-snowflake` should *not*). A wrong
  auto-edit silently corrupts test selection, which is the exact failure this
  system exists to prevent. The loop stays human-in-the-loop.
- No coverage instrumentation / test-impact analysis (considered; deferred as
  too much infra).
- No LLM in the loop (nondeterministic; would gate CI on an external service).

## Architecture

Two components plus one shared pure primitive.

### Shared primitives (`scripts/lib/pr-tags-lib.sh`)

Add pure, unit-tested helpers:

```
csv_minus <a_csv> <b_csv>
  Echoes the comma-separated, order-stable tags present in a but not in b.

longest_map_prefix <file> <map_file>
  Echoes the single longest map key that prefixes <file> (the winning entry
  under most-specific-wins), or nothing. This is the same selection
  derive_map_tags makes internally, exposed so the report can name the exact
  entry a suggested edit should target.
```

The audit uses `csv_minus` to compute, per PR:
- **gap** = `csv_minus <author_tags> <auto_tags>` - a tag the author set that the
  map did not derive -> candidate map gap (highest-value signal).
- **review** = `csv_minus <auto_tags> <author_tags>` - a tag the map derived that
  the author did not set -> either over-tag or a good catch (needs human).
- match = present in both (informational).

For each gap tag, a suggestion is **ancestor-explained** (and flagged `(review)`
rather than proposed as a fix) when a *shorter* matching prefix of the changed
file(s) already maps to that tag - i.e. a more-specific leaf deliberately
narrowed it away (e.g. `positron-r/src/testing/` dropping `@:ark`). This is a
pure check over the map keys, unit-tested alongside the primitives.

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
- Output (stdout, Markdown) - two tables split by the action they imply:
  1. **Summary line** - PRs examined, gaps, over-tags, clean.
  2. **Gaps table** - PRs where the author set a tag the map did not derive
     (consider *adding* to the map). Columns: `PR | Missing | Candidate entry |
     Title`.
     - `PR` is an explicit Markdown link (`[#N](<repo-url>/pull/N)`) so it
       resolves in both the tracking issue and the job summary. (Repo URL from
       `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY` in CI, defaulting to the
       `posit-dev/positron` origin locally.)
     - `Missing` = author minus derived. `Candidate entry` = `longest_map_prefix`
       for the changed files (where an add would land). Ancestor-explained rows
       are marked `(review)` so intentional narrowing isn't mistaken for a gap.
  3. **Suggested diffs** - one fenced JSON diff per gap row, adding the missing
     tag(s) to the candidate entry, PR context as a comment. *Proposals to review
     and apply by hand*, not auto-applied.
  4. **Over-tags table** - PRs where the map derived a tag the author did not set
     (*review*: over-tag vs. good catch). Columns: `PR | Extra | Source entry |
     Title`. `Extra` = derived minus author; `Source entry` = the entry that
     produced it. **Review-only: no suggested diffs**, because over-tag and
     good-catch are indistinguishable to the tool.
- A PR with both a gap and an over-tag appears in both tables (each row targets a
  different decision).
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

The report renders as Markdown (shown here as it would appear in the issue /
job summary):

> ## e2e tag audit - week of 2026-06-23..2026-06-29
>
> Examined 41 merged PRs: 2 gaps, 6 over-tags, 33 clean.
>
> ### Gaps - author set a tag the map did not derive (consider adding)
>
> | PR | Missing | Candidate entry | Title |
> |----|---------|-----------------|-------|
> | [#14248](https://github.com/posit-dev/positron/pull/14248) | @:interpreter | `extensions/positron-r/` | Fix runtime cache missing R versions |
> | [#14336](https://github.com/posit-dev/positron/pull/14336) | @:ark | `extensions/positron-r/src/testing/` (review) | Multi-line desc in R test explorer |
>
> #### Suggested map edits (review before applying)
>
> ~~~diff
> # 14248  author had @:interpreter, map did not derive it
> -  "extensions/positron-r/": ["@:ark"],
> +  "extensions/positron-r/": ["@:ark", "@:interpreter"],
> ~~~
> ~~~diff
> # 14336  author had @:ark  (review: positron-r/src/testing/ intentionally drops @:ark)
> -  "extensions/positron-r/src/testing/": ["@:test-explorer"],
> +  "extensions/positron-r/src/testing/": ["@:test-explorer", "@:ark"],
> ~~~
>
> ### Over-tags - map derived a tag the author did not set (review only)
>
> | PR | Extra | Source entry | Title |
> |----|-------|--------------|-------|
> | [#14502](https://github.com/posit-dev/positron/pull/14502) | @:console,@:interpreter | `extensions/positron-python/` | Filter Packages pane version picker |
> | [#14447](https://github.com/posit-dev/positron/pull/14447) | @:console,@:posit-assistant,@:positron-notebooks | `positronConsole/`,`positronNotebook/` | Gate AI on ai.enabled |

## Testing

- Unit (in `scripts/test/pr-tags-lib-test.sh`):
  - `csv_minus` - a-not-in-b, order-stable, empty-a, empty-b, no-overlap,
    full-overlap.
  - `longest_map_prefix` - picks the longest matching key; nothing on no match;
    agrees with what `derive_map_tags` selects.
  - ancestor-explained check - true when a shorter matching prefix supplies the
    missing tag (the `positron-r/src/testing/` drops `@:ark` case), false for a
    genuine gap (14248 `@:interpreter`).
- The `gh` fetch, table/diff formatting, and issue upsert are glue: validated by
  a manual `workflow_dispatch` run, not unit-tested.

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

- **Suggested diffs are proposals, not fixes.** Attribution targets the longest
  matching entry deterministically, but whether to apply is the human's call;
  ancestor-explained rows are flagged so intentional narrowing (e.g. testing
  dropping `@:ark`) isn't pasted in. Deliberate, not a defect.
- **Cron DST drift** of 1 hour - accepted for a weekly report.
- **Issue-upsert identity** relies on a stable label + title marker; a manually
  renamed/relabeled issue would cause a duplicate. Low impact.

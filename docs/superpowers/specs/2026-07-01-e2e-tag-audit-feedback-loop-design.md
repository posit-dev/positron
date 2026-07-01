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
- **No auto-editing the map, no auto-PR, and no auto-generated diff.** The report
  points at the candidate `Entry`; the human writes any map edit. Whether a
  divergence should become a map entry is a subjective call (contrast: 14248
  R-interpreter *should* be added; snowflake -> `@:workbench-snowflake` should
  *not*; and on multi-feature PRs the missing tag often belongs to a different
  feature than the changed source). A wrong edit silently corrupts test
  selection, which is the exact failure this system exists to prevent. The loop
  stays human-in-the-loop.
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
  - **Suppress gaps on non-source PRs.** A `+gap` is only reported when the PR
    changed derivable source (i.e. it has a non-empty `Entry` / `longest_map_prefix`
    resolves for at least one changed file). Test-only, docs-only, and lockfile-only
    PRs are QA/infra work that the author tags by hand; on those every author tag
    would otherwise show as a false gap against an empty derivation. Over-tags
    (`-`) are unaffected: they only exist when the map derived something, which
    already implies a source change.
- Output (stdout, Markdown) - one table, one row per divergent PR:
  1. **Summary** - PRs examined, then count bullets in order: `Clean`,
     `Under-tagged` (the `+` rows), `Over-tagged` (the `-` rows). Same wording as
     the Slack bullets so the two match.
  2. **Delta table** - columns: `PR | Title | Author | Derived | Delta | Entry`.
     - `PR` is an explicit Markdown link (`[#N](<repo-url>/pull/N)`) so it
       resolves in the job summary and any Slack link. (Repo URL from
       `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY` in CI, defaulting to the
       `posit-dev/positron` origin locally.)
     - `Author` (what the PR was actually tagged) and `Derived` (what the map
       produced) are the baseline for reference.
     - `Delta` = signed, comma-separated tags:
       - **`+@:X`** = author had it, map missed it -> consider *adding* (gap).
       - **`-@:X`** = map produced it, author did not set it -> *review*
         (over-tag to narrow, or a good catch to keep).
       A `+` that is ancestor-explained (a leaf deliberately narrowed the tag
       away) is suffixed `(review)` so it isn't mistaken for a real gap.
     - `Entry` = `longest_map_prefix` for the changed source files - the map key
       to act from (add a `+` there / narrow a `-` there). No auto-generated diff:
       on multi-feature PRs the missing tag often belongs to a *different* feature
       than the changed source dir (e.g. an author tagging a test's coverage), so
       a generated diff attributes to the wrong entry. The human writes the edit
       from `Entry`; for a clear gap like #14248 it's obvious, for a
       cross-cutting one it's correctly a no-op.
  3. **Legend** - a one-line key under the table explaining `+` / `-` / `(review)`.
- Read-only. No writes to the map or GitHub.

### Component B: `.github/workflows/e2e-tag-audit.yml`

- Triggers: `schedule` cron `0 12 * * 1` (Monday 12:00 UTC ~ 6am CT; DST drift of
  1h across the year is accepted for a weekly report) and `workflow_dispatch`
  (manual).
- Steps: checkout; run `audit-e2e-tags.sh --since <7 days ago>`; write the full
  report to `$GITHUB_STEP_SUMMARY` (always - this is the canonical, durable
  record for the run); post a Slack notification for visibility.
- **Delivery mirrors the nightly bootstrap-extensions workflow**
  (`extensions-check-nightly.yml`) - same channel and mechanism, just linking to
  the report instead of a PR:
  - Post to `#positron-dev` via `chat.postMessage` with the
    `SLACK_TOKEN_TEST_STATUS` bot token (same `curl -X POST
    https://slack.com/api/chat.postMessage` + `jq` payload the nightly uses).
  - Message is the **same summary block** the job summary opens with (one format
    for both), a header line + a link:

    ```
    :label: *e2e tag audit* - week of 2026-06-23..29 - <run-url|view report>
    Examined 41 merged PRs:
    - Clean: 33
    - Under-tagged: 2
    - Over-tagged: 6
    ```

    `run-url` is `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    (the run page renders the full job-summary report, incl. the table). Slack
    renders `-` lines as bullets.
  - **Post every week, including clean weeks.** Unlike the nightly (which runs
    *daily* and skips no-op days to avoid spam), this runs *weekly* (~52/yr), so a
    clean-week post is low-noise, serves as a heartbeat that the job ran, and the
    `Clean: N` line makes it a positive signal rather than silence.
  - A `slack-workflow-status@v3.1.3` job notifies `#positron-test-results` on
    workflow **failure**, same as the nightly.
- **No tracking issue** (dropped): a weekly report is a rolling snapshot - fixed
  divergences simply fall off next week - so an assignable issue with open/closed
  state adds bookkeeping without value, and it keeps us off GitHub issues.
- Permissions: `contents: read`, `pull-requests: read`. Uses `gh` with
  `GITHUB_TOKEN` for reads; Slack via the secret token.

### Data flow

```
cron (Mon 12:00 UTC)
  -> workflow
    -> audit-e2e-tags.sh --since <7d ago>
      -> gh: list merged PRs (last 7d) + per-PR files/body
      -> derive_map_tags + is_derivable_source (shared lib)
      -> csv_minus -> gap / over-tag
    -> Markdown report
      -> $GITHUB_STEP_SUMMARY  (always; canonical record)
      -> Slack #positron-dev  (chat.postMessage every week; summary block + run link)
```

## Report format (illustrative)

The full report renders as Markdown in the job summary (the Slack post repeats
the summary block below and links to it):

> ## e2e tag audit - week of 2026-06-23..2026-06-29
>
> Examined 41 merged PRs:
> - Clean: 33
> - Under-tagged: 2
> - Over-tagged: 6
>
> | PR | Title | Author | Derived | Delta | Entry |
> |----|-------|--------|---------|-------|-------|
> | [#14248](https://github.com/posit-dev/positron/pull/14248) | Fix runtime cache missing R versions | @:interpreter | @:ark | +@:interpreter, -@:ark | `extensions/positron-r/` |
> | [#14336](https://github.com/posit-dev/positron/pull/14336) | Multi-line desc in R test explorer | @:ark,@:test-explorer | @:test-explorer | +@:ark (review) | `extensions/positron-r/src/testing/` |
> | [#14502](https://github.com/posit-dev/positron/pull/14502) | Filter Packages pane version picker | @:packages-pane | @:console,@:interpreter,@:packages-pane | -@:console, -@:interpreter | `extensions/positron-python/` |
> | [#14447](https://github.com/posit-dev/positron/pull/14447) | Gate AI on ai.enabled | @:assistant | @:assistant,@:console,@:posit-assistant,@:positron-notebooks | -@:console, -@:posit-assistant, -@:positron-notebooks | `positronConsole/`, `positronNotebook/` |
>
> **Legend:** `+` author had it, map missed it (consider adding at `Entry`) - `-`
> map produced it, author didn't (review: over-tag or good catch) - `(review)`
> a leaf intentionally narrowed this tag away.

## Testing

- Unit (in `scripts/test/pr-tags-lib-test.sh`):
  - `csv_minus` - a-not-in-b, order-stable, empty-a, empty-b, no-overlap,
    full-overlap.
  - `longest_map_prefix` - picks the longest matching key; nothing on no match;
    agrees with what `derive_map_tags` selects.
  - ancestor-explained check - true when a shorter matching prefix supplies the
    missing tag (the `positron-r/src/testing/` drops `@:ark` case), false for a
    genuine gap (14248 `@:interpreter`).
- The `gh` fetch, table formatting, and Slack post are glue: validated by a
  manual `workflow_dispatch` run, not unit-tested.

### Testing from the feature branch (no merge required)

- **Script:** runs locally today. This branch (`mi/e2e-tag-audit`) is cut from
  `mi/military-mallow`, so `pr-tags-lib.sh` is present - `bash
  scripts/audit-e2e-tags.sh 50` works with local `gh` auth, exactly like the
  ad-hoc audit run during brainstorming.
- **Workflow:** `workflow_dispatch` runs from any branch that contains the
  workflow file: `gh workflow run e2e-tag-audit.yml --ref mi/e2e-tag-audit`
  exercises the full path (fetch -> report -> job summary -> Slack post) while
  still on the branch. (Use a throwaway test channel or the `dry-run` path so a
  branch run doesn't post to `#positron-dev`.)
- **Only the `schedule:` cron** requires the file on the default branch; that is
  the sole step that waits for merge.

## Rollout

1. Land `csv_minus` + `audit-e2e-tags.sh` with unit tests.
2. Add the workflow with `workflow_dispatch` only; run it manually to validate
   the report and the Slack post (against a test channel first).
3. Enable the `schedule` trigger once the manual run looks right.
4. Rebase onto `main` after PR #14602 (the `pr-tags-lib.sh` dependency) merges.

## Risks / accepted tradeoffs

- **The report triages, it does not fix.** It surfaces divergences and points at
  the candidate `Entry`; the human decides and edits. No auto-generated diff -
  real-PR testing showed that on multi-feature PRs (e.g. #14319, a flaky
  session-state *test* that only changed `positronConsole/` source) a generated
  diff attributes the author's extra tags to the wrong entry. Deliberate.
- **The `+` (gap) signal is noisier than `-` (over-tag).** Author tags can exceed
  what the changed source dir maps to (cross-cutting knowledge, test coverage);
  the source-PR filter and the `(review)` flag remove the bulk, but some `+` rows
  are still "author knew more than the dir implies," not map bugs. Triage
  accordingly.
- **Cron DST drift** of 1 hour - accepted for a weekly report.
- **Slack is ephemeral; the job summary is the record.** The message is the
  summary block + link, posted every week. If someone misses the Slack ping, the
  run's summary still holds the full report (incl. the table).

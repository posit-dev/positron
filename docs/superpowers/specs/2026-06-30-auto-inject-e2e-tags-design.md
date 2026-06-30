# Auto-inject e2e feature tags from a PR's changed files

## Problem

Positron selects which e2e suites run on a PR from `@:feature-name` tags in the
PR body. `scripts/pr-tags-parse.sh` greps those tags out and feeds the list to
Playwright's `--grep`. The system works, except authors regularly forget to add
the right tags, so the e2e suites that cover their change never run on the PR.

Two failure modes matter:

1. **Changed source, no tag.** Author edits feature source (e.g.
   `src/vs/workbench/contrib/positronConsole`) without touching tests and
   forgets to tag the suite that covers it.
2. **Edited/added a test, no tag.** Author adds or edits an e2e test but forgets
   to put the feature tag in the PR body.

## Goal

Derive the correct feature tags from the PR's changed files and inject them, so
the right suites run even when the author forgets. Constraints, in priority
order:

- **Reliable** - deterministic, runs on every push, no LLM, no dependency on
  PETE (which is being decommissioned as a PR auto-runner).
- **Low maintenance** - one curated map with a guardrail that prevents silent rot.
- **Minimum correct coverage** - inject the smallest correct tag set, never "run
  everything just in case." Over-running wastes CI; the map encodes the minimum.
- **Overridable** - the author can opt out, and injection is purely additive so a
  wrong tag can only ever *add* a suite (safe), never drop one.

## Non-goals

- LLM-based diff analysis (reliability + cost + PETE is going away).
- Convention-derived naming (`positronConsole` -> `console`). Too fragile: real
  mismatches exist (`positronNotebook` -> `@:positron-notebooks`,
  `positronPackages` -> `@:packages-pane`, `positronDataExplorerEditor` ->
  `@:data-explorer`). The map makes these explicit.
- Per-test-case selection. Granularity stays at the feature-tag level, matching
  the current system.

## Design

### 1. Source/extension path-prefix map

A new file `.github/workflows/e2e-tag-paths-map.json` maps **source** path
prefixes to the feature tag(s) that cover them. This handles the "changed
source, no tag" case: source files carry no `@:` tags, so a curated mapping is
the only signal for which suite covers a source change.

```jsonc
{
  "src/vs/workbench/contrib/positronConsole/":    ["@:console"],
  "src/vs/workbench/services/positronConsole/":   ["@:console"],
  "extensions/positron-assistant/":               ["@:assistant", "@:posit-assistant"]
}
```

- **Source/service/extension dirs only.** The map deliberately does NOT contain
  `test/e2e/tests/*` entries (see section 2 for why). Test files describe
  themselves; mapping their directories would be redundant and brittle to dir
  renames.
- **Matching is prefix-based.** A changed file matches an entry when its path
  starts with the entry's prefix. This keeps the bash simple and the map
  readable; full glob support can come later if a real case needs it.
- **The tag *value* encodes minimum-correct coverage.** The map author picks the
  smallest correct set per path - usually a single tag.
- These dirs rename rarely; the nightly guardrail (section 6) flags any new or
  renamed `positron*` dir / `positron-*` extension that lacks an entry.
- Matched tags are unioned (deduped) with the author's body tags, the
  test-file-derived tags (section 2), and `@:critical`. `pr-tags-parse.sh`
  already injects `@:critical` unconditionally in the non-`@:all` branch, so it
  is always present unless the author used `@:all` (which runs everything
  anyway). This design adds the derived tags to that same branch.

### 2. Changed test files -> declared feature tags

This handles the "edited/added a test, no tag" case **without** a test-directory
map. A changed e2e test file already declares the features it covers via
`tags.XXX` enum references (e.g. `tag: [tags.CONSOLE, tags.SESSIONS]`). For each
changed file under `test/e2e/tests/`, read the `tags.XXX` references, resolve
each to its `@:value` from `test/e2e/infra/test-runner/test-tags.ts`, and union
the result in.

- **Rename-proof and self-describing.** The tags come from the file's own
  contents and the changed-file list from the diff, so renaming a test directory
  changes nothing. There is no test-dir mapping to maintain or to fall stale.
- **Reads the whole changed file**, not just added lines, for feature tags: if
  you touch a console test, the console suite should run. A test cross-tagged
  with multiple features injects all of them (the test genuinely belongs to each
  suite). This is the deliberate trade accepted in exchange for dropping the
  brittle directory map - bounded (only cross-tagged tests, only when edited) and
  safe (over-running never misses coverage).
- **Excludes non-feature tags.** Platform, environment, and special tags are
  governed by other mechanisms and are skipped when reading a test file. Exclude
  any resolved value matching: `@:critical`, `@:soft-fail`, `@:performance`,
  `@:cross-browser`, `@:win`, `@:web`, `@:web-only`, `@:jupyter`, `@:pyrefly`,
  `@:publisher`, `@:remote-ssh`, `@:remote-wsl`, `@:workbench*`, `@:rhel-*`,
  `@:suse-*`, `@:sles-*`, `@:debian-*`.
- **Known limitation:** the build-variant tags above (`@:jupyter`,
  `@:workbench*`, `@:pyrefly`, `@:publisher`, `@:remote-ssh`, `@:remote-wsl`) gate
  separate build jobs via dedicated PR-body greps, not the feature `grep`. So
  editing a test tagged *only* with a build-variant tag will not auto-enable that
  job - the author still tags those manually, same as today. The common feature
  tests (console, plots, variables, sessions, data-explorer, ...) are fully
  covered.

### 3. Platform tags (`@:win` / `@:web`) - separate track

Platform tags are not feature tags and are never derived from paths. They are
detected from:

- the PR body (existing behavior, unchanged), and
- **added** diff lines in changed `test/e2e/tests/**` files (new).

Reading only *added* lines means a brand-new test carrying `@:win` enables the
Windows job, while a small edit to an existing `@:win`-tagged test does not -
matching current team practice (small edits don't opt into win/web).

### 4. No-match behavior

When neither the source map nor the test-file read produces a tag and the body
carries no feature tags,
fall back to today's behavior: only `@:critical` runs. In that case, **post a
sticky PR comment** warning the author that auto-tagging found no matches and
that they should add feature tag(s) manually if the change has e2e coverage.

- Sticky: find-by-marker and upsert, so it doesn't spam on every push.
- **Lifecycle.** The comment is keyed by a hidden marker and reflects the current
  state on every push:
  - no-match -> the warning text.
  - a later push *does* match -> the comment is updated in place to a resolved
    state listing the tags now being applied (so a stale warning never lingers).
  - if upsert-to-resolved is not feasible cheaply, delete the comment on match
    instead. Either way the warning must not survive a push that resolves it.
- **Infra exclusion.** A PR whose changed files are *entirely* within an
  exclusion list (`.github/`, `scripts/`, `docs/`, plus the usual config/lockfile
  paths) does not post the no-match comment - those PRs are not expected to carry
  e2e coverage and the warning would be noise. The exclusion only suppresses the
  comment; tag derivation is unaffected.
- Posting is **non-fatal**: fork PRs get a read-only `GITHUB_TOKEN`, so the
  comment step must fail gracefully and never break the tags job.

### 5. Override

- **`@:no-auto-tags`** token in the PR body disables the **derived tagging** for
  that PR - both the source map (section 1) and the test-file read (section 2) -
  for the rare case where the extra CI cost isn't wanted. It does **not** affect
  the platform-tag-from-added-lines scan (section 3) - a new test carrying
  `@:win`/`@:web` should still enable those jobs regardless. (If a PR needs to
  suppress platform jobs too, the author simply omits those tags from the new
  test, since the scan only reads what's literally in the diff.)
- All injection is **additive** - it only ever adds tags. The author's explicit
  body tags are always honored. A wrong/extra auto-tag costs an extra suite run
  (safe), never a missed regression.
- Derived tags are echoed in the workflow log (as `@:critical` / `@:ark` already
  are), so it's visible what was added and why.
- **Discoverability.** `@:no-auto-tags` and the auto-tagging behavior are
  documented in the no-match comment text and the PR template's tag section, so
  authors learn the escape hatch exists without reading this spec.

### 6. Guardrail against map rot (PR-time, scoped)

The map can't silently fall out of date, but the check runs **at PR time, scoped
to the dirs the PR actually touches** - not as a nightly full sweep. When a PR
changes a file under a `src/vs/workbench/contrib/positron*` /
`src/vs/workbench/services/positron*` dir or a `positron-*` extension that has no
entry in `e2e-tag-paths-map.json`, the unmapped dir is surfaced in the advisory
comment and the workflow log. This gives the author immediate, relevant feedback
on the very PR that introduces a new feature dir, and never blocks an unrelated
PR over a pre-existing gap elsewhere.

- **Scoped, not global.** Every new Positron dir arrives via a PR that edits
  files in it, so the PR-time check catches new/renamed dirs on introduction -
  the same coverage a nightly sweep would give, without the separate workflow to
  maintain or the noise of failing unrelated PRs.
- **Warn, not block.** The unmapped-dir notice is advisory (comment + log), not a
  hard CI failure - consistent with the rest of the feature being additive and
  non-blocking. (Could escalate to a job failure later if authors ignore it.)
- **Opt-out for areas with no e2e coverage.** Many `positron*` dirs are pure
  plumbing; the check is satisfied by an **entry existing**, not by a non-empty
  tag list. An explicit empty value documents "intentionally no e2e coverage" and
  silences the notice while injecting no tags:

```jsonc
{
  "src/vs/workbench/contrib/positronTelemetry/": []   // no e2e coverage by design
}
```

- A standalone `scripts/check-e2e-tag-map.sh` is retained as a **local/manual**
  full-sweep utility (handy for the initial audit and ad-hoc checks), but nothing
  runs it automatically - the authoritative check is the PR-time scoped one.

## Implementation surface

- **`scripts/lib/pr-tags-lib.sh`** - pure helpers (`derive_map_tags`,
  `derive_test_file_tags`, `find_unmapped_positron_dirs`,
  `scan_added_platform_tags`, `is_infra_only`, `union_csv_tags`), unit-tested with
  no `gh`/network.
- **`scripts/pr-tags-parse.sh`** - extend with: (a) match changed files (already
  fetched via `gh api .../pulls/N/files` for the `@:ark` injection - this is
  relative to the PR's base ref, so non-`main`-targeted PRs compute the right
  set) against the source map and union matched tags; (b) for changed
  `test/e2e/tests/**` files, read their declared feature tags and union them in;
  (c) scan added test-file diff lines for `@:win`/`@:web`; (d) honor
  `@:no-auto-tags`; (e) compute the PR-time guardrail (unmapped Positron dirs this
  PR touches); (f) emit `no_matches` and `unmapped_dirs` signals for the comment
  step. Matching uses `jq` (present on GitHub-hosted runners).
- **`.github/workflows/e2e-tag-paths-map.json`** - the source/extension map.
- **`.github/workflows/test-pull-request.yml`** - add a comment-upsert step to the
  `pr-tags` job for the no-match / unmapped-dir warning; grant it
  `pull-requests: write`.
- **`scripts/check-e2e-tag-map.sh`** - retained as a local/manual full-sweep
  audit utility (no automated runner; the nightly workflow is removed).

## Rollout

A live script before the map exists would silently no-op, so land the map first.
Phased delivery:

1. **Map.** Land `e2e-tag-paths-map.json` (drafted by the audit task below).
2. **Script.** Extend `pr-tags-parse.sh` and wire it into `test-pull-request.yml`.
   Because injected tags are additive and echoed in the workflow log, the first
   PRs that exercise it are self-observing - the log shows what *would* be added
   before anyone relies on it, which covers the canary need without a separate
   dry-run mode.
3. **Comment.** Enable the comment-upsert step (no-match + unmapped-dir warnings)
   last, once derivation is trusted.

## Security boundary

The map lives under `.github/workflows/`. A PR can edit
`e2e-tag-paths-map.json`, but auto-injection is **additive and tag-scoped** - the
worst a malicious edit achieves is running *more* e2e suites (a CI-cost DoS, not
a coverage bypass), and it can never *remove* coverage. The `@:critical` floor is
unaffected. `pr-tags-parse.sh` runs in the base-repo context with the repo's
`GITHUB_TOKEN`; for fork PRs that token is read-only, so the comment step
degrades gracefully (section 4). No secrets are exposed to PR-head content.

## Tasks (ordered)

1. **Audit + draft the source map.** Walk every `positron*` contrib/service dir
   and `positron-*` extension; cross-reference each against the existing
   `@:feature-name` tags; assign the minimum-correct tag set or an explicit `[]`.
   (Test directories are NOT mapped.) This is the bulk of the human effort and
   precedes code.
2. Ship the map (+ retain `check-e2e-tag-map.sh` as a local utility).
3. Extend `pr-tags-parse.sh` (derivation + PR-time guardrail) + wire into
   `test-pull-request.yml`.
4. Add the comment-upsert step (no-match + unmapped-dir warnings).

## Testing

The derivation logic has real branching (prefix match, enum resolution +
exclusion for test-file tags, unmapped-dir detection, dedupe, opt-out, no-match,
infra-exclusion, platform-from-added-lines), so it warrants a focused test
harness at **`scripts/test/pr-tags-lib-test.sh`** (plain-bash assert harness -
chosen over bats so CI needs no install). It exercises the pure library functions
with a table of inputs -> expected outputs.

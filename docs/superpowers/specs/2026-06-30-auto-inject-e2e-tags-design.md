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

### 1. Unified path-prefix -> feature-tag map

A new file `.github/workflows/e2e-tag-paths-map.json` maps path prefixes to the
feature tag(s) that cover that path. Source dirs, service dirs, extensions, and
e2e test dirs are all just paths, so one map covers all of them:

```jsonc
{
  "test/e2e/tests/console/":                      ["@:console"],
  "src/vs/workbench/contrib/positronConsole/":    ["@:console"],
  "src/vs/workbench/services/positronConsole/":   ["@:console"],
  "extensions/positron-assistant/":               ["@:assistant", "@:posit-assistant"],
  "test/e2e/tests/notebooks-positron/":           ["@:positron-notebooks"]
}
```

- **Matching is prefix-based.** A changed file matches an entry when its path
  starts with the entry's prefix. This keeps the bash simple and the map
  readable; full glob support can come later if a real case needs it.
- **The tag *value* encodes minimum-correct coverage.** The map author picks the
  smallest correct set per path - usually a single tag. Cross-tagging inside test
  files (a console test also tagged `tags.SESSIONS`) does NOT widen selection,
  because selection is driven by the file's *path*, not by the tags inside it.
- Matched tags are unioned (deduped) with the author's body tags and
  `@:critical`. `pr-tags-parse.sh` already injects `@:critical` unconditionally
  in the non-`@:all` branch, so it is always present unless the author used
  `@:all` (which runs everything anyway). This design adds the map-derived tags
  to that same branch.

### 2. Platform tags (`@:win` / `@:web`) - separate track

Platform tags are not feature tags and are never derived from paths. They are
detected from:

- the PR body (existing behavior, unchanged), and
- **added** diff lines in changed `test/e2e/tests/**` files (new).

Reading only *added* lines means a brand-new test carrying `@:win` enables the
Windows job, while a small edit to an existing `@:win`-tagged test does not -
matching current team practice (small edits don't opt into win/web).

### 3. No-match behavior

When the path-map matches nothing for a PR and the body carries no feature tags,
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

### 4. Override

- **`@:no-auto-tags`** token in the PR body disables the **path-map derivation**
  for that PR (for the rare case where the extra CI cost isn't wanted). It does
  **not** affect the platform-tag-from-added-lines scan (section 2) - a new test
  carrying `@:win`/`@:web` should still enable those jobs regardless. (If a PR
  needs to suppress platform jobs too, the author simply omits those tags from
  the new test, since the scan only reads what's literally in the diff.)
- All injection is **additive** - it only ever adds tags. The author's explicit
  body tags are always honored. A wrong/extra auto-tag costs an extra suite run
  (safe), never a missed regression.
- Derived tags are echoed in the workflow log (as `@:critical` / `@:ark` already
  are), so it's visible what was added and why.
- **Discoverability.** `@:no-auto-tags` and the auto-tagging behavior are
  documented in the no-match comment text and the PR template's tag section, so
  authors learn the escape hatch exists without reading this spec.

### 5. Guardrail against map rot

A nightly workflow (clone of `extensions-check-nightly.yml`) flags any
`src/vs/workbench/contrib/positron*` dir, `src/vs/workbench/services/positron*`
dir, `positron-*` extension, or `test/e2e/tests/*` dir that has no entry in
`e2e-tag-paths-map.json`. This is the same maintenance pattern already in use for
`extensions-tag-map.json`, so the map can't silently fall out of date.

**Opt-out for areas with no e2e coverage.** Many `positron*` dirs and extensions
are pure plumbing with no e2e tests; mapping them to a real tag would be wrong.
The guardrail therefore checks that an **entry exists**, not that its tag list is
non-empty. An explicit empty value documents "intentionally no e2e coverage":

```jsonc
{
  "src/vs/workbench/contrib/positronTelemetry/": []   // no e2e coverage by design
}
```

An empty-value entry satisfies the guardrail (so it stops flagging) and injects
no tags. New dirs still get flagged until someone makes a deliberate choice -
either a real tag or an explicit `[]` - which is the point.

## Implementation surface

- **`scripts/pr-tags-parse.sh`** - extend with: (a) match changed files (already
  fetched via `gh api .../pulls/N/files` for the `@:ark` injection - this is
  relative to the PR's base ref, so non-`main`-targeted PRs compute the right
  set) against the map and union matched tags; (b) scan added test-file diff lines
  for `@:win`/`@:web`; (c) honor `@:no-auto-tags`; (d) emit a `no_matches` signal
  for the comment step. Matching uses `jq` (present on GitHub-hosted runners,
  already used elsewhere in these workflows).
- **`.github/workflows/e2e-tag-paths-map.json`** - the new map (~40-50 entries).
- **`.github/workflows/test-pull-request.yml`** - add a comment-upsert step to the
  `pr-tags` job for the no-match warning; grant it `pull-requests: write`.
- **New nightly guardrail workflow** - flags unmapped dirs/extensions.

## Rollout

Sequencing matters: a live guardrail before the map is populated would fail
nightly immediately, and a live script before the map exists would silently
no-op. Phased delivery:

1. **Map + guardrail (warning-only).** Land `e2e-tag-paths-map.json` (drafted by
   the audit task below) and the nightly guardrail in non-failing/warning mode.
   Verify it doesn't flag anything unexpected, then flip it to failing.
2. **Script + workflow.** Extend `pr-tags-parse.sh` and wire it into
   `test-pull-request.yml`. Because injected tags are additive and echoed in the
   workflow log, the first PRs that exercise it are self-observing - the log
   shows what *would* be added before anyone relies on it, which covers the
   canary need without a separate dry-run mode.
3. **No-match comment.** Enable the comment-upsert step last, once derivation is
   trusted.

## Security boundary

The map lives under `.github/workflows/`. A PR can edit
`e2e-tag-paths-map.json`, but auto-injection is **additive and tag-scoped** - the
worst a malicious edit achieves is running *more* e2e suites (a CI-cost DoS, not
a coverage bypass), and it can never *remove* coverage. The `@:critical` floor is
unaffected. `pr-tags-parse.sh` runs in the base-repo context with the repo's
`GITHUB_TOKEN`; for fork PRs that token is read-only, so the comment step
degrades gracefully (section 3). No secrets are exposed to PR-head content.

## Tasks (ordered)

1. **Audit + draft the map.** Walk every `positron*` contrib/service dir,
   `positron-*` extension, and `test/e2e/tests/*` dir; cross-reference each
   against the existing `@:feature-name` tags; assign the minimum-correct tag set
   or an explicit `[]`. This is the bulk of the human effort and precedes code.
2. Ship map + guardrail (warning-only), then flip to failing.
3. Extend `pr-tags-parse.sh` + wire into `test-pull-request.yml`.
4. Add the no-match comment-upsert step.

## Testing

The map-matching and tag-union logic has real branching (prefix match, dedupe,
opt-out, no-match, infra-exclusion, platform-from-added-lines), so it warrants a
focused test harness at **`scripts/test/pr-tags-parse.bats`** (bats; if bats
isn't already a dev dependency, a plain-bash assert-loop script in the same
location is an acceptable fallback). It drives the parse logic with a table of
`changed-files + body -> expected (feature tags, platform flags, no-match)`
cases. Run it in the existing PR check job. The map *data* is validated by the
nightly guardrail, not this harness.

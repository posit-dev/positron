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
- Matched tags are unioned (deduped) with the author's body tags and the
  always-present `@:critical`.

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
- Only posted on the no-match case (avoid comment noise on normal PRs).
- Posting is **non-fatal**: fork PRs get a read-only `GITHUB_TOKEN`, so the
  comment step must fail gracefully and never break the tags job.

### 4. Override

- **`@:no-auto-tags`** token in the PR body disables the path-map derivation for
  that PR (for the rare case where the extra CI cost isn't wanted).
- All injection is **additive** - it only ever adds tags. The author's explicit
  body tags are always honored. A wrong/extra auto-tag costs an extra suite run
  (safe), never a missed regression.
- Derived tags are echoed in the workflow log (as `@:critical` / `@:ark` already
  are), so it's visible what was added and why.

### 5. Guardrail against map rot

A nightly workflow (clone of `extensions-check-nightly.yml`) flags any
`src/vs/workbench/contrib/positron*` dir, `src/vs/workbench/services/positron*`
dir, `positron-*` extension, or `test/e2e/tests/*` dir that has no entry in
`e2e-tag-paths-map.json`. This is the same maintenance pattern already in use for
`extensions-tag-map.json`, so the map can't silently fall out of date.

## Implementation surface

- **`scripts/pr-tags-parse.sh`** - extend with: (a) match changed files (already
  fetched for the `@:ark` injection) against the map and union matched tags;
  (b) scan added test-file lines for `@:win`/`@:web`; (c) honor `@:no-auto-tags`;
  (d) emit a `no_matches` signal for the comment step.
- **`.github/workflows/e2e-tag-paths-map.json`** - the new map (~40-50 entries).
- **`.github/workflows/test-pull-request.yml`** - add a comment-upsert step to the
  `pr-tags` job for the no-match warning; grant it `pull-requests: write`.
- **New nightly guardrail workflow** - flags unmapped dirs/extensions.

## Testing

The map-matching and tag-union logic has real branching (prefix match, dedupe,
opt-out, no-match, platform-from-added-lines), so it warrants a focused test
harness: a table of `changed-files -> expected (feature tags, platform flags,
no-match)` cases driving the parse logic. The map data itself is validated by the
nightly guardrail rather than a unit test.

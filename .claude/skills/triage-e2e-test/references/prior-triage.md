# Prior-triage reconciliation -- reference

Read this when `find-prior-triage.js` returns a non-`none` verdict and you need
to decide what it means for the current triage. `find-prior-triage.js` already
does the search, spec-path filter, merge-SHA resolution, and git-ancestry
partition; this file explains how to act on its verdict.

## What each `verdict` means

| verdict | meaning | action |
|---|---|---|
| `none` | no PR body names this spec path | nothing to reconcile; proceed normally |
| `open-attempt-in-flight` | an unmerged PR already diagnoses this test | **stop.** Point the engineer at the open PR (`openAttempts[].url`) instead of starting a parallel diagnosis |
| `recurred-after-fix` | occurrences post-date a merged fix's commit | lead with this. Treat the prior hypothesis as **ruled out**, not a guess to re-test -- start from "why didn't that fix hold," not from re-deriving the same mechanism |
| `fix-holding` | a merged fix exists, no occurrences post-date it, and enough post-fix runs in the failing lane to mean something | the fix looks like it held; quote `sufficiency.probabilityIfUnfixed`, and check whether the live pattern is a different failure mode than the one it closed |
| `too-recent-to-tell` | too few post-fix runs to judge -- **including none supplied at all** | say so explicitly; do not declare success or failure prematurely. `sufficiency.runsNeeded` is how many clean runs would settle it |

## Reading `mergedAttempts[]`

Each entry carries `number`, `url`, `mergedAt`, `mergeSha`, the extracted
`hypothesis` / `targetedFailure` / `confidence`, and the ancestry partition:

- `afterFixShas` -- occurrences that **are** descendants of the fix commit: the
  failure recurred after the fix meant to close it.
- `beforeFixShas` -- occurrences that predate the fix: old news already covered
  by that PR's diagnosis; don't re-litigate them.
- `unknownShas` -- SHAs git couldn't resolve even after a fetch.

When a test has multiple patterns and the ancestry check splits them -- one
pattern's occurrences all predating a fix, another's all postdating it -- that
split **is** the diagnosis: the predating pattern is old news, the postdating
one is what's still live. Lead with the split.

## When `none` is not proof there was no prior fix

The search matches **spec paths** in PR bodies, so a fix that only touched a POM,
fixture, or helper never registers. If the failing locator is absent from the
working tree it was replaced -- find by what, then re-run with `--fix-sha` so the
ancestry partition and verdict still apply:

```bash
git log --oneline -S'<failing locator or helper>' -- test/e2e/
```

## Judging whether a fix held

Occurrence SHAs are the numerator only. Pass `--post-fix-runs` (and
`--baseline-rate` from the pattern's `rates[]`) to get a scored `sufficiency`
object; without a denominator the verdict is `too-recent-to-tell` by
construction, never `fix-holding`. Read three fields off it:

- `probabilityIfUnfixed` -- `(1-p)^N`: how often that clean streak happens by
  luck anyway. Quote it. At p~0.5, N=4 is ~0.06: suggestive, not proof.
- `runsNeeded` -- clean runs required to clear the bar. A rare flake needs far
  more than a frequent one, so this is what "check back later" should mean.
- `scopeWarning` -- set when `--environment` was omitted. Both numbers must
  describe **one** os/browser lane; a test-health `total_runs` spans them all,
  and mixing it with a lane-specific rate inflates N and clears the bar on runs
  that never exercised the failing lane.

## Supersedes

If a merged fix didn't hold (`recurred-after-fix`), the eventual diagnosis block
gets a **Supersedes** bullet naming it -- see
[`diagnosis-block.md`](diagnosis-block.md).

## If the script itself is broken

Only if `find-prior-triage.js` is broken, do the search and ancestry partition by
hand -- see [`script-fallbacks.md`](script-fallbacks.md).

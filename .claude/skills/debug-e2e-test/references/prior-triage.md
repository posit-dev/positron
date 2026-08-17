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

Occurrence SHAs are the numerator only. Without a denominator the verdict is
`too-recent-to-tell` by construction, never `fix-holding`.

**Get both numbers from `--since-fix`, not from `rates[]`.** Re-run the history
query with the fix's `mergedAt`, then feed the `fixHeld` block straight back:

```bash
node .claude/skills/debug-e2e-test/scripts/triage-history.js \
  --test-key '<key>' --lookback-days 30 --since-fix '<mergedAt>'
# -> patterns[].fixHeld: { usable, postFixRuns, baselineRate, environment, note }

node .claude/skills/debug-e2e-test/scripts/find-prior-triage.js \
  --spec-path '<path>' --triage-id <id> --occurrence-shas '[...]' \
  --fix-sha '<mergeSha>' \
  --post-fix-runs <fixHeld.postFixRuns> \
  --baseline-rate <fixHeld.baselineRate> \
  --environment '<fixHeld.environment>'
```

`rates[]` is the wrong baseline source even though it looks right: it covers the
**whole** lookback, so it already contains the post-fix runs. Feeding it back
lets a fix be judged partly by its own clean runs, which drags the rate toward
zero exactly when the fix worked and makes `runsNeeded` too easy to clear.
`fixHeld.baselineRate` is the pre-fix remainder instead.

Use a `--lookback-days` long enough to reach back before the fix (30 is the max,
and the usual choice here); the script refuses rather than guessing when the
window doesn't. On `usable: false`, report `note` and stop -- that is a
`too-recent-to-tell`, not a reason to substitute an unscoped number.

Then read three fields off `sufficiency`:

- `probabilityIfUnfixed` -- `(1-p)^N`: how often that clean streak happens by
  luck anyway. Quote it. At p~0.5, N=4 is ~0.06: suggestive, not proof.
- `runsNeeded` -- clean runs required to clear the bar. A rare flake needs far
  more than a frequent one, so this is what "check back later" should mean.
  Very sensitive to `p` -- one real triage needed 4 runs at a 54% burst rate but
  15 at the 19% lookback rate. Say which rate you fed it.
- `scopeWarning` -- set when `--environment` was omitted. Both numbers must
  describe **one** os/browser lane; a test-health `total_runs` spans them all,
  and mixing it with a lane-specific rate inflates N and clears the bar on runs
  that never exercised the failing lane. `fixHeld.environment` is already scoped
  this way, so passing it through is what keeps the warning off.

## Reporting the check

A fix-held check is a status line, not a triage report. The engineer already
knows the mechanism, so restating the diagnosis, the failure-mode table, the
onset commit, or how you counted is noise. Four lines, in this order:

1. **Verdict** -- holding / too early / recurred, in a few words.
2. **Evidence** -- clean post-fix runs against `runsNeeded`, plus
   `probabilityIfUnfixed` phrased as "happens by luck X% of the time anyway".
3. **When it settles** -- the remaining runs, in wall-clock time.
4. **Action** -- usually "nothing to do"; on `recurred`, the next step.

Add nothing else unless asked.

## Supersedes

If a merged fix didn't hold (`recurred-after-fix`), the eventual diagnosis block
gets a **Supersedes** bullet naming it -- see
[`diagnosis-block.md`](diagnosis-block.md).

## If the script itself is broken

Only if `find-prior-triage.js` is broken, do the search and ancestry partition by
hand -- see [`script-fallbacks.md`](script-fallbacks.md).

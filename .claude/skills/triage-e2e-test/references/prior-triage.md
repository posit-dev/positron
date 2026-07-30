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
| `fix-holding` | a merged fix exists, no occurrences post-date it, enough runs since | the fix looks like it held; say so, and check whether the live pattern is a different failure mode than the one it closed |
| `too-recent-to-tell` | merged fix is very recent, few/no runs since | say so explicitly; do not declare success or failure prematurely |

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

The script matches **spec paths** in PR bodies. A fix that only touched a POM,
fixture, or helper never names the spec, so it returns `none` while a merged fix
exists. Whenever the failing locator or helper is **absent from the working
tree**, it was replaced -- find by what, before trusting `none`:

```bash
git log --oneline -S'<failing locator or helper name>' -- test/e2e/
```

## Verifying a suspected fix by hand

1. **Get every failure SHA.** `triage-history.js` keeps 1; the API allows 20.
   Above 20 it returns 400 and leaves the *previous* raw JSON in place, which
   reads as "the API only has one occurrence" -- it doesn't.
   ```bash
   node .claude/skills/e2e-failure-analyzer/scripts/e2e-query-history.js \
     --repo positron --test-keys '["<key>"]' --branch main \
     --lookback-days 14 --occurrences-per-pattern 20
   ```
2. **Partition them:** `git merge-base --is-ancestor <fixSha> <occSha>` per SHA.
3. **Bracket the onset:** sweep `--lookback-days` (2/3/6/8/11/14). The smallest
   window where the count saturates brackets it; clean runs in the window
   immediately before a suspected regressor confirm it.
4. **Get the denominator.** The API returns SHAs for failures only, so count
   post-fix runs from CI instead:
   ```bash
   gh api 'repos/posit-dev/positron/actions/runs?branch=main&created=>=<YYYY-MM-DD>' \
     --jq '.workflow_runs[] | select(.name=="Test: Merge to branch")
           | [.head_sha, .created_at, (.conclusion//"running")] | @tsv'
   ```
   Exclude in-flight runs. A workflow `conclusion` of `failure` is the whole
   suite, not this test -- it is not an occurrence.
5. **State sufficiency as a number.** Zero failures in N post-fix runs at
   baseline rate p is only worth `(1-p)^N`: at p~0.5, N=4 is ~0.06 --
   suggestive, not proof. Report the figure and what N would settle it. Never
   call a fix closed on a handful of green runs.

## Supersedes

If a merged fix didn't hold (`recurred-after-fix`), the eventual diagnosis block
gets a **Supersedes** bullet naming it -- see
[`diagnosis-block.md`](diagnosis-block.md).

## If the script itself is broken

Only if `find-prior-triage.js` is broken, do the search and ancestry partition by
hand -- see [`script-fallbacks.md`](script-fallbacks.md).

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
| `fix-holding` | a merged fix exists, no occurrences post-date it, enough runs since | the fix looks like it held; if `failure_patterns` is now empty that's a clean bill, not a fresh triage |
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

## Supersedes

If a merged fix didn't hold (`recurred-after-fix`), the eventual diagnosis block
gets a **Supersedes** bullet naming it -- see
[`diagnosis-block.md`](diagnosis-block.md).

## Doing it by hand (fallback)

Only if `find-prior-triage.js` is broken:

```bash
gh search prs --repo posit-dev/positron --match body "E2E Triage Diagnosis" \
  --json number,title,url,state,body --limit 50
```

Filter results yourself for a body containing this test's exact spec path.
For merged matches, get the merge commit and partition occurrences by ancestry:

```bash
gh pr view <number> --json mergeCommit,mergedAt
git merge-base --is-ancestor <fix-merge-sha> <occurrence-sha> \
  && echo "after fix" || echo "before fix / unrelated history"
```

If a SHA isn't found locally, `git fetch origin` first -- occurrence SHAs come
from CI runs across branches your clone may not have fetched.

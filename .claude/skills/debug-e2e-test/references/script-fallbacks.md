# Script fallbacks -- reference

Read this **only when one of the skill's scripts is itself broken** and you need
to do its work by hand. A non-`ok` verdict or an `error` field is not a broken
script -- that is the script working, and `history-query.md` / `prior-triage.md`
say what to do about it.

Doing these by hand loses the merging, filtering, and on-disk payload storage the
wrappers provide, so fix the script instead when you can.

## Dual-branch history query (`triage-history.js`)

```bash
node .claude/skills/e2e-failure-analyzer/scripts/e2e-query-history.js \
  --repo positron --test-keys '["<key>"]' --branch <branch> \
  --lookback-days 14 --occurrences-per-pattern 1
```

Query the current branch **and** `main`, then merge `failure_patterns[]` by
failure text (not array position). Querying only the current branch risks two
false negatives (a new branch reports zero runs; a branch with one passing run
masks an established main flake); querying only main misses what the branch
itself introduced. Evaluate zero-runs **per branch**, never on the merged total.

## Prior-triage search (`find-prior-triage.js`)

```bash
gh search prs --repo posit-dev/positron --match body "E2E Triage Diagnosis" \
  --json number,title,url,state,body --limit 50
```

Filter the results yourself for a body containing this test's exact spec path.
For merged matches, get the merge commit and partition occurrences by ancestry:

```bash
gh pr view <number> --json mergeCommit,mergedAt
git merge-base --is-ancestor <fix-merge-sha> <occurrence-sha> \
  && echo "after fix" || echo "before fix / unrelated history"
```

If a SHA isn't found locally, `git fetch origin` first -- occurrence SHAs come
from CI runs across branches your clone may not have fetched.

The same search without the spec-path filter lists every PR carrying a
diagnosis block:

```bash
gh search prs --repo posit-dev/positron --match body "E2E Triage Diagnosis" \
  --json number,title,url
```

## Appending a diagnosis block (`record-diagnosis.js`)

Prefer `record-diagnosis.js` -- it renders the block, validates the fields, and
is the only writer of `diagnosisBlockRecorded`, which gates `phase=done`. A
hand-appended block leaves that flag unset, so you would also have to set it
manually and you lose the field validation.

If you must append by hand, write the body to a file and use:

```bash
gh api repos/<owner>/<repo>/pulls/<n> -X PATCH -F body=@<file>
```

`gh pr edit` fails on the Projects-classic GraphQL deprecation.

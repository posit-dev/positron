# History query -- reference

Read this **only** when `triage-history.js` reports a condition its compact
output can't resolve on its own (a `zero-runs-both` verdict, an `error`, or a
key you need to rebuild). The normal path never needs it.

## Building the test key

`resolve-test-key.js` (SKILL step 1) does this for you and is the normal path.
What is below is why it exists, and the fallback when it can't run.

Keys are `testName|||specPath`. `testName` is the **full hierarchical
Playwright title** -- every enclosing `test.describe()` block joined to the
`test()` title with `" > "`, not just the leaf title. Using only the leaf title
silently returns a zero-runs result (looks clean, is actually a key mismatch),
which is exactly why the hierarchy is read from Playwright rather than assembled
by hand.

**Fallback if `resolve-test-key.js` fails.** It shells out to
`npx playwright test --list`, so it fails as a unit when any spec fails to
import -- run that command directly to see the real error, and fix the import
rather than guessing a key around it. Only if listing cannot be made to work:
grep `test/e2e/tests/` for the exact title and spec path, then walk outward to
collect every enclosing `test.describe()` title. See
[`../../e2e-failure-analyzer/scripts/README.md`](../../e2e-failure-analyzer/scripts/README.md#building-a-test-key)
for the worked example. Treat a hand-built key as suspect: if it returns
`zero-runs-both`, assume the key before assuming the record is clean.

**Ambiguity is not yours to resolve.** When the resolver returns `candidates`
with no `resolved`, two or more tests genuinely match (a leaf title reused across
specs, or a whole spec named). Present them and ask. Picking one silently is how
a triage ends up investigating the wrong test's history.

## What each `verdict` from `triage-history.js` means

| verdict | meaning | action |
|---|---|---|
| `ok` | live history on the queried branch(es), patterns present | proceed to pattern selection |
| `ok-current-branch-new` | current branch has 0 runs, main has real history | proceed on main's data; note the branch has no history of its own yet |
| `zero-runs-both` | **every** queried branch reports `total_runs: 0` | **stop**, but settle *which* zero it is first (below): a key mismatch, or a test CI has genuinely never run |
| `clean` | nonzero runs, no failure patterns | **stop.** Nothing to triage -- report a clean bill of health for the lookback window |

### Which zero is it?

`zero-runs-both` has two causes, and they need opposite actions. Settle it with
one command -- whether the *committed* spec on `origin/main` already contains this
title:

```bash
git show origin/main:'<specPath>' 2>/dev/null | grep -F '<leaf title>'
```

- **No output** (or the path doesn't exist on main) -- the test is new, renamed, or
  still uncommitted, so CI has never run it and the key is fine. **Rebuilding the
  key is wasted work.** Say it has no CI history yet and switch to the local entry.
  If it was renamed, the old title holds the history the new one can't see.
- **A match** -- the title is on main, so CI should have history for it. Now the
  key is the suspect: rebuild the full hierarchical key (above) and re-run.

## How `lastSeen` is derived

The test-health API puts **no timestamp on occurrences**, so `triage-history.js`
derives one per pattern into `lastSeen: { date, daysAgo, sha }`:

1. `git show -s --format=%cI <sha>` -- the local commit date. Offline, instant,
   and within minutes of the CI run date.
2. `gh api repos/{owner}/{repo}/actions/runs/<id> --jq .created_at` -- fallback
   when the sha isn't in the local clone (shallow clone, force-push, unfetched
   branch). Authoritative but needs network.
3. Neither resolves -> `{ date: null, daysAgo: null, sha }`. The sha still names
   the latest occurrence, because the API returns occurrences most-recent-first.

That ordering is why `lastSeen` is accurate even at the default
`--occurrences-per-pattern 1`: index 0 already *is* the most recent occurrence,
so the date only has to be resolved, not searched for.

`lastSeen` does **not** reorder the table -- patterns stay count-descending. It
is a separate axis: a high-count pattern with a stale `daysAgo` was likely an
acute burst that a merged fix already closed, which count and rate alone cannot
show. Check it against `find-prior-triage.js` before recommending it.

## Missing API key vs. API unreachable

`triage-history.js` exits non-zero with `{ "error": ..., "cause": ... }`. The two
causes get different responses, so read `cause` before reporting:

- **`missing-api-key`** -- no key in `E2E_INSIGHTS_API_KEY` or the repo-root
  `.env.e2e` (a placeholder value counts as missing). Caught in a pre-flight,
  before any query. Relay the setup steps in the `error` string verbatim -- they
  name the 1Password path -- and stop. This is a first-run setup gap, not a
  finding about the test, and there is **no degraded mode**: without history
  there is nothing to triage, so do not substitute a local run or guess at
  failure modes.
- **`api-unreachable`** -- a key was found but a branch query returned `{}`.
  API-side or network. Suggest a retry; do **not** send the engineer to
  1Password.

Either way: do **not** fall back to the other branch's result as if it were
complete, and do not treat an empty response as "no failures."

## If the script itself is broken

`triage-history.js` already runs both branch queries and merges them. Only drop
to the raw script if the wrapper is broken -- see
[`script-fallbacks.md`](script-fallbacks.md).

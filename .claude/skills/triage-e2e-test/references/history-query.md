# History query -- reference

Read this **only** when `triage-history.js` reports a condition its compact
output can't resolve on its own (a `zero-runs-both` verdict, an `error`, or a
key you need to rebuild). The normal path never needs it.

## Building the test key

Keys are `testName|||specPath`. `testName` is the **full hierarchical
Playwright title** -- every enclosing `test.describe()` block joined to the
`test()` title with `" > "`, not just the leaf title. Using only the leaf title
silently returns a zero-runs result (looks clean, is actually a key mismatch).

If you only have a partial name, grep `test/e2e/tests/` for the exact title and
spec path, then walk outward to collect every enclosing `test.describe()` title.
See [`../../e2e-failure-analyzer/scripts/README.md`](../../e2e-failure-analyzer/scripts/README.md#building-a-test-key)
for the full worked example.

## What each `verdict` from `triage-history.js` means

| verdict | meaning | action |
|---|---|---|
| `ok` | live history on the queried branch(es), patterns present | proceed to pattern selection |
| `ok-current-branch-new` | current branch has 0 runs, main has real history | proceed on main's data; note the branch has no history of its own yet |
| `zero-runs-both` | **every** queried branch reports `total_runs: 0` | **stop.** This is a key mismatch, not a clean record -- rebuild the full hierarchical key (above) and re-run |
| `clean` | nonzero runs, no failure patterns | **stop.** Nothing to triage -- report a clean bill of health for the lookback window |

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

## API unreachable

`triage-history.js` exits non-zero with `{ "error": ... }` when a branch query
returns `{}` (API down or `E2E_INSIGHTS_API_KEY` unset). Say so and stop -- do
**not** fall back to the other branch's result as if it were complete, and do
not treat an empty response as "no failures."

## If the script itself is broken

`triage-history.js` already runs both branch queries and merges them. Only drop
to the raw script if the wrapper is broken -- see
[`script-fallbacks.md`](script-fallbacks.md).

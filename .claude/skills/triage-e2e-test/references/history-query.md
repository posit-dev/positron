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

## API unreachable

`triage-history.js` exits non-zero with `{ "error": ... }` when a branch query
returns `{}` (API down or `E2E_INSIGHTS_API_KEY` unset). Say so and stop -- do
**not** fall back to the other branch's result as if it were complete, and do
not treat an empty response as "no failures."

## If the script itself is broken

`triage-history.js` already runs both branch queries and merges them. Only drop
to the raw script if the wrapper is broken -- see
[`script-fallbacks.md`](script-fallbacks.md).

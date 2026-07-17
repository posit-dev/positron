# e2e-query-history.js -- test-health API reference

Shared reference for querying the `test-health` endpoint of the e2e-test-insights
API (`https://connect.posit.it/e2e-test-insights-api`). Used today by
`e2e-failure-analyzer` (run-centric) and `triage-e2e-test` (test-centric); any
skill may call it directly for a lightweight "does this test have known CI
history" check. The API itself has no gate -- only the guided triage workflow
in `triage-e2e-test` is manual-only, not the underlying script.

## Auth

Requires `E2E_INSIGHTS_API_KEY`. Falls back to the `.env.e2e` file at the repo
root (same local secrets file the e2e Playwright suite uses; see
`test/e2e/.env.e2e.example`) if the env var isn't set. If neither is present
the script warns on stderr and returns `{}` with exit code 0 -- treat an empty
response as "API unreachable," not "no failures."

## `repo_id`

Always `positron`, for both `posit-dev/positron` and `posit-dev/positron-builds`
runs -- `positron-builds` uses positron as a submodule and results are stored
under the `positron` repo ID regardless of which repo triggered the run.

## Building a test key

Keys are `testName|||specPath`. `testName` is the **full hierarchical
Playwright title** -- every enclosing `test.describe()` block joined to the
`test()` title with `" > "`, not just the leaf title. E.g. for:

```ts
test.describe('Source Content Management', ..., () => {
  test('Verify SCM Tracks File Modifications, Staging, and Commit Actions', ...)
```

the key's `testName` is `"Source Content Management > Verify SCM Tracks File
Modifications, Staging, and Commit Actions"`, not just the inner string. Using
only the leaf title silently returns an empty/zero-runs result (looks like a
clean test, actually a key mismatch) rather than an error -- if a query comes
back with `total_runs: 0` for a test you know runs regularly, rebuild the key
with the full describe-chain prefix before concluding it's clean.

If you only have a partial name, grep `test/e2e/tests/` for the exact title
and spec path, then walk outward to collect every enclosing `test.describe()`
title.

## `--test-keys`: always pass a JSON array, even for one key

```bash
node e2e-query-history.js --repo positron \
  --test-keys '["<testName>|||<specPath>"]' \
  --branch <branch> --lookback-days 14 --occurrences-per-pattern 2
```

The API also accepts a plain comma-separated string, but it splits on *every*
comma in that string to find multiple keys -- a test name that itself contains
a comma (e.g. "Verify SCM Tracks File Modifications, Staging, and Commit
Actions") gets mis-split and rejected with a 400. The JSON array form has no
such ambiguity. Use it even for a single key.

## Reading the response

- `failure_patterns[]` -- distinct failure modes, count-descending, each with
  `count`, `percentage`, and (if `--occurrences-per-pattern` was set) up to N
  representative `occurrences` carrying `sha`, `os`, `browser`, `outcome`
  (`failed` | `flaky`), `run_url`, `report_url`.
- `insight.type` -- `"new"` (first-time failure, likely regression),
  `"recurring"` / `"known_flaky"` (established pattern), `"rare_flake"`
  (infrequent).
- `history.pass_rate` -- low = known flaky; 100% before this run = regression.
- `environment_breakdown` -- check this **before** concluding a test is
  "flaky": 0% pass on one OS/browser combo with 100% on others is a
  deterministic regression on that platform, not flakiness, even when the
  aggregate pass rate looks mixed.
- `{}` response -- the API was unreachable or the key was unset; say so and
  stop rather than treating it as "no failures."
- `total_runs: 0` -- a test with real CI history never reports this on every
  branch queried; on a single-branch query it usually means the test key is
  wrong (see "Building a test key" above), not that the test is clean.

## Options reference

See the script's own header comment for the full CLI flag list (`--run-id`,
`--branch`, `--lookback-days`, `--max-patterns`, etc.).

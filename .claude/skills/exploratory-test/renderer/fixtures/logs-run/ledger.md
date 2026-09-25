# Test ledger

PR: posit-dev/positron#1234 - Branch: midleman/exp-ab-dx-opus - Commit: ed2487a1a2
Diff: 2f4a58bc...ed2487a1
Run: 2026-09-22 14:05-14:31 - Explore: Opus 5.5 - Verify: Sonnet 5

## Environment
(True for the whole run. Rendered in Run details, not in Coverage.)
- Positron 2026.10.0 build 12, dev build of ed2487a1a2 (Code - OSS 1.105.0), on Ubuntu 22.04 (Linux x64).
- Pre-launched via CDP 44987, workspace /tmp/exploratory-workspace, window 1600x1300.
- Python 3.10.12 with pandas, polars, duckdb and pyarrow.

## Logs
(Every file copied into logs/ at the end of the run. Rendered as the Logs list in Run details.)
- logs/44987-app.log | Positron window (renderer and dev-tools console) | 2 errors, both in Finding 1
- logs/exthost.log | Extension host | no errors
- logs/python-console.log | Python console output | no errors

## Files
(Every file a scenario used, saved as it was when used. Rendered as Test files in Run details.)
- files/slow.py | Python helper that builds the slow sources | S04, S08, S09; Findings 1, 2

---

## S01 - pandas frame, mixed types
Status: pass
Result: Null %, histograms and frequency tables all load; datetime/all-null show no sparkline as before

Steps:
1. Create `df` with int, float, str, datetime, bool and all-null columns.
2. Run `%view df`.
3. VERIFY Null %, histograms and frequency tables load, and datetime and all-null columns show no sparkline, as before. -> PASS
   Evidence: 01-df-open.png

## S03 - Expand on a healthy source
Status: pass
Result: Summary stats appear for NaN and inf columns

Preconditions:
- `edge` open | S02 | `edge` with all-NaN, inf, all-null string, object and complex columns, opened with `%view edge`.

Steps:
1. Expand the all-NaN and inf columns.
2. VERIFY The summary stats appear. -> PASS
   Evidence: 03-edge-expanded.png

## S04 - Paced loading on a slow source
Status: pass
Result: Sparklines land about 2 per 4 s, loading dots in the rest, pause at about 30 s

Preconditions:
- `slow.py` loaded | | files/slow.py, then run `%run -i slow.py`. `make_slow()` makes each value's hash sleep, standing in for a large or remote table.

Steps:
1. Run `slow = make_slow(ncols=20, delay=0.002)` (about 2 s per column), then `%view slow`.
2. Watch for 35 s.
3. VERIFY Sparklines arrive steadily (about 2 every 4 s), with loading dots on the rest. -> PASS
4. VERIFY Loading pauses at about 30 s with "Summaries paused. Continue". -> PASS
   Evidence: 04-slow-paused.png

## S08 - Retry on a source over 10 s per column
Status: fail - Finding 1
Result: Fails 3/3

Preconditions:
- `slow.py` loaded | | files/slow.py, then run `%run -i slow.py`. `make_slow()` makes each value's hash sleep, standing in for a large or remote table.

Steps:
1. Run `one12 = make_slow(ncols=1, nrows=1000, delay=0.012)`. One string column whose frequency table takes about 13 s.
2. Run `%view one12` and wait 15 s.
3. VERIFY The column summary loads. -> FAIL - Finding 1
   Observed: Loading dots, then "Some summaries unavailable. Retry"; the sparkline slot empties.
   Evidence: 09-one12-unavailable.png, 07-slow12-unavailable.png
   Log: logs/44987-app.log:1182 | Renderer | 2x (after each Retry)
     Error: get_column_profiles timed out after 10 seconds
       at DataExplorerClient.getColumnProfiles (languageRuntimeDataExplorerClient.ts:212)
       at TableSummaryCache.loadColumnProfiles (tableSummaryCache.ts:538)
       at TableSummaryCache.retryColumnProfiles (tableSummaryCache.ts:611)
4. Click Retry and wait 15 s. Repeat once.
5. VERIFY The summary loads after Retry. -> FAIL - Finding 1
   Observed: Same notice after each Retry.
   Evidence: 08-slow12-after-retry.png

## S09 - Continue after scrolling down
Status: fail - Finding 2
Result: Loads off-screen columns

Preconditions:
- `slow.py` loaded | | files/slow.py, then run `%run -i slow.py`. `make_slow()` makes each value's hash sleep, standing in for a large or remote table.

Steps:
1. Run `slow80 = make_slow(ncols=80, nrows=1000, delay=0.002)`, then `%view slow80`.
2. Wait about 35 s until "Summaries paused. Continue" appears.
3. VERIFY s00 to s13 have sparklines. -> PASS
4. Scroll the summary panel to the bottom (s62 to s79 visible), click Continue and wait until "Summaries paused." returns (32 s).
5. VERIFY The visible columns s62 to s79 get sparklines. -> FAIL - Finding 2
   Observed: Only s62 has one.
   Evidence: 23-continue-visible-still-empty.png
   Log: logs/exthost.log:88 | Extension host | 1x
     Warning: profile request for s63 cancelled
6. Scroll the summary panel up by about one screen.
7. VERIFY Continue spent its budget on the visible columns, not the ones above them. -> FAIL - Finding 2
   Observed: s49 to s61, off-screen when Continue was pressed, got sparklines.
   Evidence: 22-continue-loaded-offscreen.png

---

## Not run
- N01 - R data.frame / tibble backend - Time; Python and DuckDB cover both null-vs-omitted serializations the diff mentions
- N02 - Data-grid cell and row-header placeholders, "Value unavailable" - Could not make value fetches slow: the slow-hash trick only slows profiling
- N05 - Positron web - Desktop build only

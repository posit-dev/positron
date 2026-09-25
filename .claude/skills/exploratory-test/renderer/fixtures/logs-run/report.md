# Exploratory test: column summaries on slow sources

PR: posit-dev/positron#1234

`midleman/exp-ab-dx-opus` | `ed2487a1a2`

**Result:** Column summaries load and pause on schedule. **A column over 10 s never loads, and Continue loads the wrong columns.**
**Tested:** the summary panel on pandas and a slow source, 4 scenarios
**Not exercised:** the web build

## Findings

| # | Finding | Severity | Impact | Introduced? | Reproduction |
|---|---------|----------|--------|-------------|--------------|
| 1 | A column over 10 s never loads, and Retry cannot help | major | summary never appears | yes | 3/3 |
| 2 | Continue loads off-screen columns, not the visible ones | moderate | visible columns stay empty | yes | 2/2 |

### Finding 1: A column over 10 s never loads, and Retry cannot help

> **Confirmed** | Reproduced **3/3** | **Introduced by this change**

**Repro** -- starting state: `slow.py` loaded with `%run -i slow.py`.

**Preconditions:** default settings

1. Run `one12 = make_slow(ncols=1, nrows=1000, delay=0.012)`. One string column whose frequency table takes about 13 s.
2. Run `%view one12` and wait 15 s.
3. Verify the column summary loads. -> FAIL (finding 1)
   Observed: Loading dots, then "Some summaries unavailable. Retry"; the sparkline slot empties.
   Evidence: 09-one12-unavailable.png, 07-slow12-unavailable.png
   Log: logs/44987-app.log:1182 | Renderer | 2x (after each Retry)
     Error: get_column_profiles timed out after 10 seconds
       at DataExplorerClient.getColumnProfiles (languageRuntimeDataExplorerClient.ts:212)
       at TableSummaryCache.loadColumnProfiles (tableSummaryCache.ts:538)
       at TableSummaryCache.retryColumnProfiles (tableSummaryCache.ts:611)
4. Click Retry and wait 15 s. Repeat once.
5. Verify the summary loads after Retry. -> FAIL (finding 1)
   Observed: Same notice after each Retry.
   Evidence: 08-slow12-after-retry.png

**Observed:** The summary never loads; the panel shows "Some summaries unavailable. Retry", and Retry shows it again.

**Expected:** The summary loads, or Retry loads it.

**Evidence**

- [shots/09-one12-unavailable.png](shots/09-one12-unavailable.png) -- The notice on a one-column frame
- [shots/07-slow12-unavailable.png](shots/07-slow12-unavailable.png) -- The notice on a twelve-column frame
- [shots/08-slow12-after-retry.png](shots/08-slow12-after-retry.png) -- Same notice after Retry

### Finding 2: Continue loads off-screen columns, not the visible ones

> **Confirmed** | Reproduced **2/2** | **Introduced by this change**

**Repro** -- starting state: `slow.py` loaded with `%run -i slow.py`.

**Preconditions:** default settings

1. Run `slow80 = make_slow(ncols=80, nrows=1000, delay=0.002)`, then `%view slow80`.
2. Wait about 35 s until "Summaries paused. Continue" appears.
3. Verify s00 to s13 have sparklines. -> PASS
4. Scroll the summary panel to the bottom (s62 to s79 visible), click Continue and wait until "Summaries paused." returns (32 s).
5. Verify the visible columns s62 to s79 get sparklines. -> FAIL (finding 2)
   Observed: Only s62 has one.
   Evidence: 23-continue-visible-still-empty.png
6. Scroll the summary panel up by about one screen.
7. Verify Continue spent its budget on the visible columns, not the ones above them. -> FAIL (finding 2)
   Observed: s49 to s61, off-screen when Continue was pressed, got sparklines.
   Evidence: 22-continue-loaded-offscreen.png

**Observed:** After Continue, the visible columns stay empty while columns above them load.

**Expected:** Continue loads the columns on screen first.

**Evidence**

- [shots/23-continue-visible-still-empty.png](shots/23-continue-visible-still-empty.png) -- Visible columns still empty
- [shots/22-continue-loaded-offscreen.png](shots/22-continue-loaded-offscreen.png) -- Columns above the fold loaded instead

## Coverage

### Verified

| Scenario | Result | Screenshot | Steps |
|---|---|---|---|
| Retry on a source over 10 s per column | Fails 3/3 (finding 1) | | |
| Continue after scrolling down | Loads off-screen columns (finding 2) | | |
| pandas frame, mixed types | Null %, histograms and frequency tables all load | [shots/01-df-open.png](shots/01-df-open.png) | 1. Create `df` with int, float, str, datetime, bool and all-null columns.<br>2. Run `%view df`.<br>3. Verify null %, histograms and frequency tables load, and datetime and all-null columns show no sparkline, as before. -> PASS |
| Paced loading on a slow source | Sparklines land about 2 per 4 s, pause at about 30 s | | 1. Run `slow = make_slow(ncols=20, delay=0.002)`, then `%view slow`.<br>2. Watch for 35 s.<br>3. Verify sparklines arrive steadily, with loading dots on the rest. -> PASS<br>4. Verify loading pauses at about 30 s with "Summaries paused. Continue". -> PASS<br>Evidence: [shots/04-slow-paused.png](shots/04-slow-paused.png) |

### Not exercised

| Scenario | Reason |
|---|---|
| the web build | Desktop build only |

_explore: Opus 5.5 | 120 turns | 25m_

<details>
<summary>Run details</summary>

### Change under test
The column-profile request timeout drops from 60 s to 10 s, with paced loading and a Retry notice.

### Environment
Positron (pre-launched, CDP 44987), workspace /tmp/exploratory-workspace, window 1600x1300. Python 3.10.12 with pandas.

### State manipulation
`slow.py` makes each value's hash sleep, standing in for a large or remote table.

### Branch verification
Grepped `out/` for "Summaries paused"; present only on this branch.

</details>

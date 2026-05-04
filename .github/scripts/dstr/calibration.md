# /dstr Calibration Results

Full-population calibration against 5,000 merged PRs from posit-dev/positron (Feb 2023 – May 2026).

## Methodology

1. **Fetched all 5,000 merged PRs** via GitHub API (`gh pr list --state merged --limit 5000`)
2. **Classified by subsystem** using title/keyword matching to identify DS-relevant population
3. **Sampled 40+ bug-fix PRs** across all DS-relevant subsystems, fetched full descriptions
4. **Extracted recurring failure patterns** from actual bug root causes
5. **Cross-referenced patterns against heuristic table** to verify coverage and identify gaps

## Population Statistics

| Category | Count | % of Total |
|----------|-------|------------|
| Total merged PRs | 5,000 | 100% |
| DS-relevant (keyword match) | ~640 | 12.8% |
| Data Explorer | 305 | 6.1% |
| Plots | 216 | 4.3% |
| Variables Pane | 127 | 2.5% |
| Numeric/Format/Locale | 125 | 2.5% |
| Console Output/Clipboard | 61 | 1.2% |
| Session Lifecycle (restart/reconnect) | 41 | 0.8% |
| Connections | 40 | 0.8% |

**Key finding:** Only ~13% of PRs are DS-relevant. The relevance gate should silence ~87% of invocations. This validates the "when in doubt, say nothing" design.

## Classification (Initial 20-PR Sample)

### Should say "Doesn't need DS input" (14/20 = 70%)

| PR | Title | Why not DS |
|----|-------|-----------|
| #13203 | Fix clipping of inline data explorer in Quarto | CSS-only, no data path |
| #13330 | Rebrand experimental themes | Theming |
| #13304 | Disable terminal initial hint | Config toggle |
| #13344 | Fix copy/select keyboard in PDF viewer macOS | Keyboard routing, not data |
| #13138 | Fix scrolling over webviews in notebooks | DOM scroll passthrough |
| #13280 | Bump Ark to 0.1.251 | Version bump |
| #13112 | Add category filters to Packages pane | UI filter, not user data |
| #13275 | Fix packages pane blank on reshown | Render lifecycle, not data |
| #13310 | Don't show Quarto output in diff view | UI gating |
| #13158 | Prevent stuck helpFocused context key | Focus state bug |
| #13193 | Only enable interrupt when kernel busy | Button state |
| #13144 | Add local links in notebooks | Link resolution |
| #13252 | Package metadata search for R | Package infra, not user data |
| #13200 | Cache notebook renderers for tab switching | Performance cache, data stays in kernel |

### Should produce bullets (6/20 = 30%)

| PR | Title | DS angle |
|----|-------|----------|
| #13245 | Strip ANSI on notebook output copy | Data fidelity in clipboard |
| #13201 | Console scrollback performance & trimming | Data loss from trimming |
| #13098 | Open Data Explorer from editor | Data display correctness |
| #13094 | Save outputs/execution counts settings | Data persistence/round-trip |
| #13205 | Notebook debugging for Ark | Kernel state during debug |
| #12779 | Expect data explorer in R notebooks | Data persistence after restart |

## Simulated Outputs (Initial Sample)

### PR #13245 — Strip ANSI escapes when copying

**Test design gaps:**

- **Copied numeric data survives ANSI stripping intact** — Console output from `df.describe()` or R's `summary()` interleaves ANSI color codes with numeric values (e.g., red for negative numbers). If the stripping regex is too greedy, it could eat adjacent digits. Test by copying output that has ANSI codes immediately adjacent to decimal points or minus signs, then assert the clipboard contains the correct numbers.

### PR #13201 — Console scrollback trimming

**Test design gaps:**

- **Trimming during active streaming doesn't discard the final output line** — A long model training run produces hundreds of iteration lines into a single streaming activity item. The new char-budget trimming can fire mid-stream. Test that the LAST line (often containing final metrics or a convergence warning) is never the one trimmed — the start of the stream is expendable, the end is not.

### PR #13098 — Open Data Explorer from editor

**Test design gaps:**

- **Variable resolution handles R dotted identifiers and Python bracket access** — Real data scientists use `my.data.frame` (R) and `data["sub_df"]` (Python) as variable names. The cursor-word resolution must match language-specific identifier boundaries, not just `\w+`. Test that placing the cursor on `my.data.frame` opens the whole variable, not just `my`.

### PR #13094 — Save outputs/execution counts settings

**Test design gaps:**

- **Round-trip with outputs disabled still renders correctly on reopen** — With `notebook.save.outputs: false`, outputs are stripped on save. Test that reopening the notebook shows empty cell outputs (not stale cached results from the renderer cache). A user who saves, closes, and reopens should not see phantom output that no longer exists on disk.

- **execution_count: null doesn't break external notebook tools** — The setting writes `null` instead of removing the field. Test that nbformat validation still passes and that opening the saved notebook in JupyterLab doesn't show broken execution indicators.

### PR #13205 — Notebook debugging for Ark

**Test design gaps:**

- **Breakpoint injection before cell execution doesn't alter cell output** — The BreakpointSyncService injects breakpoints at parse-time before execution. Test that a cell producing a DataFrame result still produces identical output whether or not breakpoints are set in the cell — the debug infrastructure shouldn't alter the data path.

### PR #12779 — Expect data explorer in R notebooks

**Test design gaps:**

- **Post-restart assertion verifies data content, not just visibility** — The test checks `toBeVisible()` after kernel restart, but the purpose is "output persistence." If the data explorer reconnects with stale/empty state, `toBeVisible()` still passes. Assert shape or at least one cell value after restart to verify the DATA persisted, not just the DOM element.

---

## Recurring Failure Pattern Library

Extracted from 40+ sampled bug-fix PRs across all DS-relevant subsystems. These represent the actual failure modes Positron has experienced — the patterns the system prompt must detect.

### Pattern 1: Numeric Parsing Fragility
**Source PRs:** #9812, #5477, #3456
**Pattern:** Formatting/parsing breaks at magnitude boundaries or special values.
- Thousands separators break `parseFloat` at values ≥ 1000 (#9812)
- INT64 values overflow JavaScript's Number.MAX_SAFE_INTEGER (#5477)
- `inf`, `-inf`, `NaN` not handled in summary statistics (#3456)

**Test signal:** Any PR touching numeric display/parsing → test at magnitude boundaries (0, 1000+, MAX_INT, inf, NaN, negative)

### Pattern 2: Data Explorer State Lifecycle
**Source PRs:** #6550, #6322, #6260, #12323
**Pattern:** Data explorer loses state or shows stale data during tab/session transitions.
- Switching tabs doesn't restore sort/filter state (#6550)
- Column widths reset on tab switch (#6322)
- Inline data explorer shows wrong variable name or stale data (#12323)
- Pending RPC shows incorrect row labels (#5654)

**Test signal:** Any PR touching data explorer open/close/switch → test state persistence across tab changes

### Pattern 3: Copy-Paste Data Fidelity
**Source PRs:** #9536, #9346, #13245, #12651
**Pattern:** Data loses integrity during clipboard operations.
- Sorted column data exported in wrong order (#9536)
- Row selection copy fails with pinned columns (#9346)
- ANSI stripping corrupts adjacent numeric values (#13245)
- Platform-specific key conflict breaks copy entirely (#12651)

**Test signal:** Any PR touching copy/export → verify clipboard content matches source data cell-for-cell

### Pattern 4: Stale Comm Channels After Restart
**Source PRs:** #12428, #12590, #10933, #12635
**Pattern:** Session restart leaves stale communication channels that cause timeouts or wrong data.
- Old UI comm receives RPCs meant for new comm (#12428)
- Connection objects can't resume after restart (#12590)
- R sessions not cleaned up, holding stale references (#10933)
- Packages pane shows "no session" after restart (#12635)

**Test signal:** Any PR touching restart/reconnect → test that the NEW channel is functional AND the old one is dead

### Pattern 5: Streaming Output Race Conditions
**Source PRs:** #12557, #12947, #12549
**Pattern:** Streaming/incremental output arrives out of order or gets lost.
- Only first output message appeared; subsequent streaming lost (#12557)
- Output clearing during re-execution causes flash (#12947)
- Idle/input messages arriving out of order cause phantom execution indicators (#12549)

**Test signal:** Any PR touching cell output rendering → test with multi-message streaming, rapid re-execution, and interrupt

### Pattern 6: Kernel/Session Race at Startup
**Source PRs:** #11309, #10310, #10636, #10070
**Pattern:** Timing-dependent failures at kernel start, reopen, or close.
- Kernel selection fires before runtimes registered → silent skip (#11309)
- Kernel status stuck "active" after notebook reopen (#10310)
- Session not shut down when notebook closed → leaked state (#10636)
- Changing kernel fails silently (#10070)

**Test signal:** Any PR touching kernel/session management → test the sequence: open → start → close → reopen

### Pattern 7: DuckDB/Backend Type Inference
**Source PRs:** #5764, #6884, #9621
**Pattern:** Backend (DuckDB) infers types incorrectly or computes wrong statistics.
- Large CSV files get wrong column types due to sampling (#5764)
- Histogram bin edges computed incorrectly for edge distributions (#6884)
- 0-row data produces errors in statistics/histograms (#9621)

**Test signal:** Any PR touching data profiling/statistics → test with 0 rows, 1 row, all-null columns, and mixed-type columns

### Pattern 8: Multi-Pane Desynchronization
**Source PRs:** #6645, #6629, #12323, #10159
**Pattern:** Multiple views of the same data drift out of sync.
- Variables pane not updated after empty cell execution (#6645)
- Multiple sessions show wrong variables in pane (#6629)
- Inline and full data explorer show different data (#12323)
- Foreground session reports wrong session to extensions (#10159)

**Test signal:** Any PR touching variables/data display with multiple views → verify all panes agree after mutation

### Pattern 9: Null/Undefined Confusion Across Languages
**Source PRs:** #11132, #11308
**Pattern:** JavaScript null vs undefined causes silent failures in cross-language boundaries.
- `_has_children` initialized to `null` but checked with `=== undefined` (#11132)
- Connection modal doesn't update because drivers registered after modal opened (#11308)

**Test signal:** Any PR fixing null checks → verify behavior with both `null` AND `undefined` inputs

### Pattern 10: Render Pipeline Breakage
**Source PRs:** #12755, #11991, #12225
**Pattern:** Upstream dependency changes break rendering without obvious errors.
- VS Code merge removes RequireJS → ipywidgets/plotly silently broken (#12755)
- SVG plot output not rendering in Positron notebooks (#11991)
- ANSI color enum matched as string → raw enum values displayed (#12225)

**Test signal:** Any PR touching render/display paths → verify the OUTPUT content is correct, not just that something renders

---

## Borderline Cases (Important for Gate Calibration)

These PRs are in DS-adjacent areas but should still be SILENT:

| PR | Title | Why silent despite proximity |
|----|-------|----------------------------|
| #13200 | Cache notebook renderers for tab switching | Performance optimization, data stays in kernel — no fidelity risk |
| #12949 | Fix autocompletion in non-inline output Quarto docs | Autocomplete UX, not data correctness |
| #12695 | Fix focus stealing in side-by-side notebooks | Focus management, not data |
| #12458 | Scope notebook action bar to its own editor group | UI chrome scoping |
| #12343 | Fix notebook multiselect leaving cell in edit mode | Selection UX |
| #12114 | Fix autoscroll when moving cells with keyboard | Scroll behavior |
| #12033 | Fix ghost cell keyboard shortcut | Shortcut binding |
| #11562 | Update activity badge of debug pane | Badge display |

**Rule of thumb:** If the fix is about WHERE/WHEN something renders (focus, scroll, visibility, z-index) rather than WHAT data it shows, stay silent.

---

## Quality Observations

1. **87% should be silent.** Population data confirms the gate must be aggressive. Only ~13% of all PRs touch DS-relevant data paths.

2. **10 recurring patterns cover ~90% of DS bugs.** The pattern library above captures the actual failure modes. Bullets should reference these specific scenarios, not generic advice.

3. **"Sounds like any test engineer" = cut it.** Bullets like "test with edge cases" or "add null handling" are generic. The DS insight must be something the dev WOULDN'T think of without a DS background.

4. **The best bullets reference the actual failure mode from the linked issue.** Not "test more scenarios" but "test the EXACT scenario that broke."

5. **One bullet > three weak bullets.** PRs #13245, #13098, #13201 each only have ONE genuine DS insight. Padding to 2-3 would dilute quality.

6. **Borderline PRs tend to be LESS useful to comment on.** Better to be quiet than force a connection. The gate should err toward silence.

7. **The tone that works: "Your test checks X but the bug was Y."** Direct, specific, references the gap between test coverage and actual failure scenario.

8. **Streaming/lifecycle bugs are the hardest to test well.** Patterns 4-6 (stale comms, streaming races, kernel startup) require stateful test scenarios that most devs skip. These are where /dstr adds the most value.

9. **"Data survived the round-trip" is the core DS question.** Patterns 1, 3, 7, and 10 all reduce to: does the data come out the other side unchanged? This is the throughline connecting numeric parsing, clipboard, backend inference, and rendering.

10. **Platform-specific failures are real but hard to predict from diffs.** #12651 (Ctrl+C on Windows) and #11132 (null vs undefined on Win/Linux) are genuine but require platform awareness the model may not have. Don't cite locale/platform unless the diff shows platform-specific code paths.

---

## Design Decisions (from expert panel review, 2026-05-04)

Changes implemented based on review by 5 expert agents (DS, Testing/QA, DevEx, Reliability, DevRel):

### 1. Removed heuristic codes from output
Codes like (H2), (H34) shatter the "trusted colleague" persona. They read like academic citations. Heuristics remain in system prompt as internal reasoning guidance but never appear in developer-facing output.

### 2. Added feedback mechanism
PR comment footer includes thumbs-up/down prompt. Allows passive signal collection on whether suggestions are useful. Future: track reaction rates to identify weak heuristics.

### 3. Brief acknowledgment for non-relevant PRs
Since `/dstr` is opt-in (dev explicitly asks), silence would feel broken. Now posts a single line — confirms the tool ran, doesn't clutter the thread.

### 4. Concrete assertions required in every bullet
Bullets must propose a specific assertion (`expect(cell.text).toBe('3.14')`) or test input (`formatNumber(1700.5)`), not just a direction ("add data assertions"). Vague directions are indistinguishable from generic advice.

### 5. Heuristic library expanded and decomposed
- Split Schema/Type into: Silent Type Coercion + Semantic Type Misuse
- Split Comm Lifecycle into: Channel Cleanup + Message Routing + Kernel Resource Leak
- Added: Partial Delivery, Capability Mismatch, Zombie View, Reconnect Storm, Metamorphic Violation, Unicode Corruption
- Renamed "Coverage Bias" → "Distributional Mismatch" (more precise)
- Renamed "Trust Signal Mismatch" → "Weak Oracle / Trust Signal" (covers test oracle problem)

### 6. Added "weak oracle" detection to decision flow
Tests that assert visibility/shape/completion without checking actual data values are now flagged. This addresses the false-confidence risk: "tests exist but prove nothing about correctness."

### Risks acknowledged but not yet addressed
- **False confidence from silence**: if /dstr says nothing, devs may assume DS testing is fine. Mitigation TBD (possibly periodic random audits).
- **Heuristic maintenance**: 21 heuristics today, risk of bloat. Needs deprecation mechanism.
- **Latency**: placeholder shows "Analyzing..." but if Claude is slow (>90s), devs context-switch. Monitor p95 latency.
- **Discoverability**: no onboarding path for new team members. Needs docs page or team demo.

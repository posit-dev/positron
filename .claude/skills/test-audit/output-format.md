# Test Audit Output Format

Report is ordered bottom-up through the test pyramid (Core Mocha -> Vitest -> Extension host -> E2E) in both sections. This mirrors how the dev should think about coverage: "what do we already have at the cheapest level?" before "what do we need higher up?"

## Report template

```
# Test coverage audit - <scope summary>

Gathered: <PR/branch/files summary, one line>
Analyzed: <N source files>, <M existing test files>

## TL;DR

<1-3 sentence narrative recommendation. State the bottom line: how many items, what verdict pattern dominates, and what they all share.>

Example: *3 items audited. Recommendation: move down 2 to Vitest (medium confidence), keep 1. All move-down candidates trace to NotebookInstance model state; would extend `notebookCells.vitest.ts`.*

## At a glance

| ID  | Test :: scenario          | Verdict             | Conf.  | Why                                            |
|-----|---------------------------|---------------------|--------|------------------------------------------------|
| [1] | <basename> :: <scenario>  | Move down -> Vitest | high   | already covered in `notebookDelete.vitest.ts`  |
| [2] | <basename> :: <scenario>  | Keep                | high   | webview-rendered (markdown-language-features)  |

(Row label: test-file basename + describe/it scenario. Full paths only in per-item detail.)

**HARD RULE:** After the table, ONLY action items (`Move down` / `Move up` / `Split` / `Add`) appear in per-item form. **`Keep`, `Skip`, and `Delete` verdicts NEVER get a per-item block.** They live in the at-a-glance table — the `Why` column is their entire treatment. Do not render them again below. The dev can reply `details N` if they want to challenge one specifically.

(Display mode is governed by Step 5: always step through action items one at a time.)

## Existing coverage

### Core Mocha (upstream, awareness only) - N items

- `someUpstreamThing.test.ts` - references `<changed-file>`; asserts `<summary>`. **Overlaps** with proposed Vitest item #4.

### Action items (per-item blocks below)

Per-item layout: bold `**[N]**` + path on line 1, `**Verdict:**`, then ONE of `**Why:**` / `**Trace:**` / `**Moves to Vitest:** + **Stays in e2e:**`, then `**What changes:**`. Items separated by `---`. IDs cover ALL table rows; blocks below skip Keep/Skip/Delete IDs.

One example per verdict (showing the four shapes):

**[N]** `<path>` -- **Move down -> Vitest** (high)
**Trace** (2 of 6 shown; reply `expand N` for full):
- L23 expect(parser.detect(...)) -> `clearHandler.detect()` (Vitest plain)
- L41 expect(consoleState).toBe('cleared') -> `consoleReducer` (Vitest builder)
- ...4 more, all hitting the parser + reducer layer.
**What changes:** add Vitest test for `src/vs/.../clearHandler.ts`; delete original e2e after replacement verified.

---

**[N]** `<path>` -- **Split** (medium)
**Moves to Vitest:** L15 expect(formatter.format(...)) -> `formatter.format()` (Vitest plain)
**Stays in e2e:** L32 cross-pane check (console -> variables)
**What changes:** add Vitest test for the formatter; trim e2e to the cross-pane assertion.

---

**[N]** `<path>` -- **Move up -> Ext host** (medium) [rare]
**Why:** stubs 5+ fundamental services; assertions are about cross-service dispatch.
**Alternative:** rewrite this Vitest with less mocking if orchestrator-in-isolation is what's worth testing.

---

**[N]** `src/vs/.../<file>.ts` :: <behavior> -- **Add** (high) - <pattern: plain / builder / RTL>
**Why:** <one-line reason>

## Skip
**[N]** `<file>` - Skip (high). Docs-only / type-only / reverted / upstream / action-only.

## Summary
- Add: <V vitest, E ext-host-flag, e2e>
- Move down: <H high, M medium>
- Move up: <N> (rare)
- Split: <N>
- Keep: <N> (X verified via hypothesis-verification trace)
- Delete / Skip: <N>
- Low-confidence (hidden): <N> — reply `show low-confidence` to reveal
- Upstream awareness: <U items, X overlaps>
- Total dev decisions at the gate: <N>
```

## Formatting rules

**Top-level structure:**
- Always lead with `## TL;DR` (1-3 sentence narrative) and `## At a glance`. The dev should be able to make 80% of their decisions from these two sections without scrolling further.
- **`## At a glance` MUST be a real GFM markdown table** with `|` separators and a `|---|---|...|` separator row. Render it EXACTLY ONCE. Never substitute or precede it with a bulleted list, definition list, or labeled blocks. Do NOT render two versions. The literal shape required:

  ```
  | ID  | Test :: scenario | Verdict | Conf. | Why |
  |-----|------------------|---------|-------|-----|
  | [1] | ...              | ...     | ...   | ... |
  ```

- Columns are exactly: `ID` / `Test :: scenario` / `Verdict` / `Conf.` / `Why`. No extra columns, no fewer.
- **Use basenames everywhere visible**: table rows, per-item block headers, Existing-coverage bullets, and inline references in `Why` / `Trace` / `What changes`. If two paths share a basename within the same audit, disambiguate with one parent directory. Full paths appear ONLY on `expand <N>` or `details <N>`.
- The `Why` column is one short phrase per row. Keep it scannable.
- Detailed sections follow in pyramid order (Core Mocha -> Vitest -> Ext host -> E2E), Existing coverage before New coverage needed.

**Display mode + per-item layout:** governed by Step 5 (step-through template). Do not duplicate those rules here.

**Reminders:**
- Per-item header uses the **basename** as the visible label. NEVER put paths in H3 headers.
- Line-number references (`L23`) only when the test file has actually been read.
- Every row in the at-a-glance table carries an explicit verdict and confidence band.

**`details N` on a Keep verdict:** re-render that item with the full hypothesis-verification trace. This is the ONLY case where a Keep gets a per-item block.

## Trace compression

- **`Move down` / `Move up` / `Add` (with traces):** show at most **2 representative assertions** under `**Trace:**`, then a tail line: *"... and N more, all hitting <shared-layer-description>"*. End with `(2 of M shown; reply \`expand <N>\` for full)` if M > 2.
- **`Split`:** bifurcated `**Moves to Vitest:**` / `**Stays in e2e:**` structure, same 2-assertion compression on each side.
- **`Add`** items with no existing trace: just `**Why:**` (one line). No trace block.

## What changes line

- For `Move down`: *"add Vitest test for `<path>`; delete original after replacement verified"*.
- For `Move up`: *"rewrite at higher bucket OR rewrite current Vitest with less mocking"* + one-line characterization.
- For `Split`: *"add Vitest for <subset>; trim original e2e to <remaining-cross-system-subset>"*.
- For `Add`: *"add <pattern> Vitest at `<path>` covering <one-line behavior>"*.

## Other rules

- Low-confidence flags are **suppressed by default**. They appear in the Summary count only. The dev can reply `show low-confidence` to reveal them; when revealed, use compact one-line form (path + verdict + reason; no `Why` / `Trace` block).
- Items are numbered across the whole report (`[1]`...`[N]`) so the dev can reply `approve all except 3,7,12` or `expand 6`.

## Handling `expand <N>` requests

If the dev replies `expand <N>` (or `expand 6, 8`), reissue just those items with the full per-assertion trace shown under `**Trace:**` (no compression). Don't reprint the rest of the report.

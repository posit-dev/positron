# POM Reference Pipeline: Smart Reference + Post-Run Feedback

**Date:** 2026-04-04
**Status:** Approved
**Context:** The qa-test skill picks POM methods from `pom-reference.md`, which currently contains bare signatures only. ~50% of POM methods have JSDoc, but the reference generator strips it out. This leads to wrong method selection (e.g., `waitForCurrentStaticPlot` vs `waitForCurrentPlot`) and missed POM gaps.

## Problem

1. **Generator discards JSDoc.** `generate-pom-reference.ts` (line 155) skips `/**` lines. The skill never sees existing documentation.
2. **No JSDoc on ~50% of methods.** High-traffic POMs like plots, console, and variables have little or no documentation.
3. **Confusable method pairs.** No `@see` cross-references to disambiguate similar methods.
4. **`waitFor*` vs `expect*` naming blur.** Some `waitFor*` methods are used as assertions but named as preconditions.
5. **No feedback loop.** When the skill falls back to raw Playwright or retries with a different method, the knowledge is lost.

## Design

### 1. Reference Generator Enhancement

Update `generate-pom-reference.ts` to extract JSDoc and include it in the reference.

**Output format change:**

Before:
```
## plots (pages/plots.ts)
- waitForCurrentPlot()
- waitForCurrentStaticPlot()
```

After:
```
## plots (pages/plots.ts)
- waitForCurrentPlot() -- Wait for any plot to appear in the Plots pane (sidebar or editor)
- waitForCurrentStaticPlot() -- Wait for a static plot image in the full-size plot viewer (not sidebar)
- clearPlots() -- Click the Clear Plots button
```

**Rules:**
- First line of JSDoc becomes the description (strip `Action:` / `Verify:` prefix for the reference, keep the content)
- `@see` references included as "See also: methodName"
- `@param` tags included for non-obvious parameters
- Methods without JSDoc get no description (bare signature, same as today)

### 2. JSDoc Standardization

**Format:**

```typescript
/** Action: <what it does, one line>. */
async simpleMethod()

/**
 * Action: <what it does>.
 * <Extra context when needed for disambiguation or non-obvious behavior.>
 * @param paramName - <description>
 * @see relatedMethod for <when to use that instead>
 */
async complexMethod(paramName: string)
```

**Conventions:**
- First line starts with `Action:` (does something) or `Verify:` (asserts something)
- `Verify:` methods are named `expect<Thing>()` (e.g., `expectColumnProfileToBeExpanded`)
- `@see` for methods that are easily confused with each other
- `@param` only when the type signature is not self-explanatory (e.g., `@param columnIndex - 1-based index`)
- No `@returns` unless the return value is non-obvious
- Scales from one-liner to multi-line as needed -- same structure either way

**Prioritized rollout:**

| Tier | POMs | Reason | Approx methods |
|------|------|--------|----------------|
| 1 (high-traffic) | plots, console, variables, dataExplorer, editors | Most used by qa-test, most confusion | ~100 |
| 2 (moderate) | quickaccess, hotKeys, inlineDataExplorer, editor, layouts | Used regularly, zero/near-zero JSDoc | ~60 |
| 3 (already decent) | sessions, notebooksPositron, positronAssistant, databot | 50%+ coverage, fill gaps | ~40 |

### 3. `waitFor*` Naming Audit

During the Tier 1 JSDoc pass, audit all `waitFor*` methods and flag any primarily used as assertions.

**Criteria for flagging:**
- Method is commonly the last call in a test or test group (used as verification, not setup)
- No corresponding `expect*` method exists
- Method name implies "wait" but the intent is "assert this is true"

**Action for flagged methods:**
- Add an `expect*` counterpart (thin wrapper, not duplication)
- JSDoc on the `waitFor*` clarifies it is a precondition; `@see` points to the `expect*` version
- Existing tests using `waitFor*` as assertions are not broken -- both work -- but new tests prefer `expect*`

**Example:**
```typescript
/** Action: Wait for any plot to render in the Plots pane.
 *  Use as a precondition before interacting with the plot.
 * @see expectCurrentPlotVisible to assert a plot is showing */
async waitForCurrentPlot()

/** Verify: A plot is visible in the Plots pane. */
async expectCurrentPlotVisible()
```

### 4. Post-Run Failure Analysis

After `/run-plan` completes, the skill analyzes failures and routes feedback into two buckets.

**Bucket 1: POM Gap (raw Playwright fallback)**

Detected when a step uses `type: "action"` with raw actions (`clickSelector`, `snapshot`, `waitForSelector`, etc.) because no POM method existed.

Auto-append to `test/e2e/tests/explore/BACKLOG.md` under `## POM Gaps`:

```markdown
- [ ] **Missing: expectPlotInSidebar (plots.ts)**
  During QA test "DataFrame + matplotlib", no POM method existed to verify a plot
  in the sidebar Plots section. Used raw `waitForSelector('.plot-instance img')`.
  Suggested signature: `expectPlotInSidebar(plotName?: string): Promise<void>`
  Discovered: 2026-04-04
```

**Bucket 2: Method Confusion (retried with different POM method)**

Detected when a `/run-plan` step fails and the retry uses a different POM method on the same POM that succeeds.

Surface in the results report under a `### POM Health` section:

```
### POM Health
- CONFUSION: Called `waitForCurrentStaticPlot` (failed), retried with
  `waitForCurrentPlot` (passed). JSDoc status: missing on both methods.
  Recommendation: Add @see cross-references to disambiguate.
```

Not auto-filed to backlog -- this is a documentation issue, not a gap.

**Detection logic lives in the skill instructions**, not in the runner. The skill already knows which steps failed and what changed on retry.

## Rollout

Phases build on each other:

**Phase 1: Make existing JSDoc visible**
- Update `generate-pom-reference.ts` to extract and include JSDoc descriptions
- Regenerate `pom-reference.md`
- Immediate win: ~50% of methods get descriptions with no new JSDoc written

**Phase 2: Tier 1 JSDoc + naming audit**
- Add JSDoc to high-traffic POMs: plots, console, variables, dataExplorer, editors
- Audit `waitFor*` methods in those POMs, add `expect*` counterparts where needed
- Add `@see` cross-references for confusable method pairs
- Regenerate reference

**Phase 3: Skill post-run analysis**
- Update qa-test skill instructions to detect and route failures
- Builds on Phase 2 because better JSDoc means fewer false "confusion" flags

**Phase 4: Tier 2 + 3 JSDoc**
- Fill in remaining POMs
- Lower urgency, can happen incrementally alongside normal test work

**Future (Approach 3):** Once Phases 1-3 are stable, layer on `--heal` flag for auto-proposing POM additions in a worktree.

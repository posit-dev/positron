# Console Focus Coverage Analysis - Positron IDE
**Date:** 2026-02-04  
**Focus Area:** Console Focus Automation Gaps (Data Science Workflows)

---

## Executive Summary

This analysis identifies **critical missing automated coverage** for console focus behaviors in Positron IDE, specifically targeting workflows that data scientists use daily. While existing test coverage includes basic console operations (input, output, clipboard, history), there are significant gaps in testing **focus preservation and transitions** during iterative analysis sessions—workflows central to exploratory data analysis, notebook usage, and REPL-driven development.

### Current State
- **127 total E2E test files** across the repository
- **12 console-specific test files** covering basic console operations
- **1 dedicated notebook focus test file** (`notebook-focus-and-selection.test.ts`)
- **Console focus helper exists** (`focusConsole()` in hotKeys.ts)
- **Missing:** Cross-component focus tests for console ↔ notebook/editor interactions

### Key Findings
**High-priority gaps identified:**
1. Console focus preservation after notebook cell execution
2. Console input restoration after scrolling through long output
3. Focus behavior after interrupting long-running computations
4. Console readiness after Assistant-driven notebook edits
5. Focus stability during rapid iteration between console and notebooks

---

## Automation Gap Summary (Data Science Workflow Lens)

### Gap Categories

#### 1. **Console ↔ Notebook Focus Transitions** (HIGH IMPACT)
- **Current Coverage:** Notebook cell navigation, notebook ↔ tab switching
- **Missing Coverage:** 
  - Console input focus preservation after running notebook cells
  - Console readiness after switching from notebook back to console
  - Focus behavior when toggling between notebook scratchpad and console

#### 2. **Console Focus During Output-Heavy Operations** (HIGH IMPACT)
- **Current Coverage:** Basic console output display
- **Missing Coverage:**
  - Input focus retention after scrolling through large outputs (DataFrame prints, plot data, logs)
  - Cursor position preservation during streaming output
  - Console input availability during/after async output rendering

#### 3. **Console Focus After Interruption/Restart** (MEDIUM IMPACT)
- **Current Coverage:** Basic interrupt commands work
- **Missing Coverage:**
  - Console focus restoration after interrupting long computation
  - Input readiness verification post-interrupt
  - Focus behavior after kernel restart

#### 4. **Console Focus in Multi-Session Scenarios** (MEDIUM IMPACT)
- **Current Coverage:** Session switching (session-picker tests)
- **Missing Coverage:**
  - Console focus when switching between multiple active consoles (Python/R)
  - Input targeting when multiple console instances visible
  - Focus preservation in split console layouts

#### 5. **Assistant-Driven Workflows** (MEDIUM IMPACT)
- **Current Coverage:** Assistant UI visibility in notebooks
- **Missing Coverage:**
  - Console focus after Assistant edits notebook cells
  - Console readiness after Assistant generates code snippets
  - Focus behavior when dismissing Assistant panel

---

## Ranked Missing Automation Opportunities

### Priority Matrix

| Rank | Gap Area | Impact | Effort | Regression Risk | Data Science Productivity Hit |
|------|----------|--------|--------|-----------------|-------------------------------|
| 1 | Console focus after notebook execution | HIGH | Small | HIGH | Blocks iterative notebook+console workflow |
| 2 | Focus retention during scroll of large output | HIGH | Small | MEDIUM | Disrupts DataFrame/plot inspection |
| 3 | Console focus after interrupt | HIGH | Small | HIGH | Breaks debugging/long-running analysis |
| 4 | Multi-cell execution → console transition | HIGH | Medium | MEDIUM | Impacts rapid prototyping |
| 5 | Assistant edit → console readiness | MEDIUM | Medium | MEDIUM | Affects AI-assisted workflows |

---

## Full GitHub Issue Drafts

---

### Issue #1: Add Playwright regression coverage for console focus preservation after notebook cell execution

#### Background / Problem (User Impact First)

**Critical data science workflow disruption:**

Data scientists in Positron frequently work in a **hybrid notebook+console mode**:
1. Execute cells in a notebook to build analysis scaffolding
2. Return to the console to inspect intermediate variables, test hypotheses, or run quick exploratory commands
3. Switch back to the notebook to refine and document findings

**Current regression risk:**  
If console focus is lost or input is not immediately available after running a notebook cell, users experience:
- **Wasted keystrokes** typing into inactive UI elements
- **Context switching friction** requiring extra clicks/shortcuts to restore console input
- **Flow disruption** during iterative analysis sessions

This is especially problematic during:
- Multi-step data transformations requiring console checks between notebook cells
- Debugging workflows where users alternate between cell execution and console inspection
- Teaching scenarios where instructors demonstrate notebook → console patterns

**Why this matters for notebook-first IDE users:**  
Positron differentiates itself by seamless integration between notebooks and REPL. Any focus instability in this transition undermines the core value proposition of **"notebook and console, working together."**

---

#### What Should Be Automated

**Exact user behavior to cover:**

**Scenario 1: Single cell execution → console return**
- User is in notebook edit mode
- User executes a single cell (Shift+Enter)
- User immediately switches to console (Cmd+K F or click)
- Console input should be immediately ready for typing (no extra clicks/focus needed)

**Scenario 2: Multi-cell execution → console inspection**
- User selects multiple cells in a notebook
- User executes all selected cells
- Execution completes (all cells show done state)
- User switches to console to inspect generated variables
- Console should accept input without focus issues

**Scenario 3: Run cell → scroll output → console**
- User runs a cell that produces long output (e.g., DataFrame print)
- User scrolls through the cell output in the notebook
- User switches to console
- Console input focus should be stable (not stuck on notebook scroll)

---

#### Scope of Coverage

**Included workflows:**
- ✅ Execute single notebook cell → return to console
- ✅ Execute multiple notebook cells → return to console
- ✅ Run cell with long output → scroll → return to console
- ✅ Run notebook cell from keyboard (Shift+Enter) → console focus
- ✅ Run notebook cell from UI button → console focus
- ✅ Notebook kernel busy → notebook kernel idle → console ready
- ✅ Both Python and R notebook → console transitions

**Explicit exclusions:**
- ❌ Console → notebook transitions (separate test coverage)
- ❌ Notebook scratchpad console (complex feature requiring dedicated tests)
- ❌ Multi-window/multi-editor splits (out of scope for initial coverage)
- ❌ Remote kernel scenarios (kernel lifecycle tests handle this)

---

#### Suggested Playwright Test Locations

**Primary location:**  
`test/e2e/tests/notebooks-positron/notebook-console-focus.test.ts` (NEW FILE)

**Why create a new file:**  
- `notebook-focus-and-selection.test.ts` focuses on *intra-notebook* focus (cell-to-cell)
- `console-*.test.ts` files focus on *console-only* operations
- This new file bridges the gap: *inter-component* focus (notebook ↔ console)

**Alternative locations (if consolidation preferred):**
- Add to `test/e2e/tests/console/console-focus-transitions.test.ts` (NEW FILE)
- Extend `test/e2e/tests/notebooks-positron/notebook-kernel-behavior.test.ts` (less ideal—too broad)

---

#### Test Cases to Add (Required)

**Test Suite: Notebook → Console Focus Preservation**

```typescript
test.describe('Notebook to Console Focus Transitions', {
  tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS, tags.CONSOLE, tags.CRITICAL]
}, () => {

  test('Preserve console input focus after executing single notebook cell', async ({ app, python }) => {
    // 1. Open notebook, add cell with simple code
    // 2. Execute cell (Shift+Enter)
    // 3. Wait for cell execution completion
    // 4. Switch to console (focusConsole)
    // 5. Type immediately into console without additional clicks
    // 6. Verify typed text appears in console input
    // 7. Execute console input and verify output
  });

  test('Console accepts input immediately after multi-cell notebook execution', async ({ app, python }) => {
    // 1. Open notebook, add 3 cells with sequential code
    // 2. Select all 3 cells
    // 3. Execute all cells
    // 4. Wait for all cells to complete
    // 5. Switch to console
    // 6. Verify console prompt is ready (>>> or >)
    // 7. Type and execute console command
    // 8. Verify no focus errors or missed keystrokes
  });

  test('Console focus stable after scrolling notebook cell output', async ({ app, python }) => {
    // 1. Open notebook, add cell that prints large DataFrame (100+ rows)
    // 2. Execute cell
    // 3. Scroll through cell output area
    // 4. Switch to console
    // 5. Verify console input has focus (not stuck on notebook scroll container)
    // 6. Type and execute command to verify focus stability
  });

  test('Console input ready after notebook kernel becomes idle', async ({ app, python }) => {
    // 1. Open notebook, add cell with time.sleep(3)
    // 2. Execute cell (kernel becomes busy)
    // 3. While kernel busy, attempt to switch to console
    // 4. Wait for kernel to become idle
    // 5. Verify console input is now ready (not blocked by notebook kernel state)
    // 6. Execute console command to confirm
  });

  test('Console focus preserved across notebook cell execution via UI button', async ({ app, python }) => {
    // 1. Open notebook, add cell with code
    // 2. Click cell "Run" button (not keyboard shortcut)
    // 3. Wait for execution
    // 4. Switch to console
    // 5. Verify console input focus is immediate
  });

  test('R notebook cell execution → console focus stability', async ({ app, r }) => {
    // Same as first test but with R kernel
    // Ensures cross-language focus consistency
  });
});
```

---

#### Implementation Notes (Playwright + Positron Specific)

**Fixtures to reuse:**
- `app.workbench.notebooksPositron` (notebook page object)
- `app.workbench.console` (console page object with `focus()` method)
- `app.workbench.console.activeConsole` (locator for active console instance)
- `python` and `r` fixtures (kernel startup)

**Reliable selectors:**
- **Console input ready state:** `.console-input` with `.active-line-number` showing `>>>` or `>`
- **Notebook cell execution state:** Use `expectExecutionStatusToBe(index, 'idle')` from notebooksPositron
- **Console focus verification:** 
  ```typescript
  await expect(app.workbench.console.activeConsole.locator('.console-input')).toBeFocused();
  ```
- **Keyboard input verification:** Type into console and assert text appears via `waitForCurrentConsoleLineContents()`

**Avoiding flaky timing:**
- ✅ **DO:** Use `waitForReady()` to verify console prompt before input attempts
- ✅ **DO:** Use `expectExecutionStatusToBe()` to confirm notebook cell completion
- ✅ **DO:** Add explicit `focus()` calls before typing (but assert they work immediately)
- ❌ **DON'T:** Use arbitrary `waitForTimeout()` for focus stabilization
- ❌ **DON'T:** Assume focus is ready after notebook execution without verification

**Cross-language coverage:**
- Each focus test should have both Python and R variants (or parameterized)
- Use `python` and `r` fixtures to ensure kernels are started
- Console prompt differs: `>>>` (Python) vs `>` (R)—use `waitForReady(prompt)` to abstract

**Handling async operations:**
- Notebook cell execution is async—always wait for cell completion indicator
- Console input may not be immediately focusable if kernel is transitioning—add retry logic with `toPass()`

---

#### Acceptance Criteria

✅ **Regression test fails before fix and passes after:**
- If console focus is broken after notebook execution, test catches it immediately
- Test fails with clear error: "Console input not focused after notebook cell execution"

✅ **Covers a real notebook/console workflow used daily by data scientists:**
- Test replicates actual user flow: run notebook cells → inspect in console
- Matches common pattern: iterative analysis with notebook + REPL

✅ **Runs reliably in CI without timing hacks:**
- No arbitrary `waitForTimeout()` usage
- Uses proper state verification (`waitForReady`, `expectExecutionStatusToBe`)
- Passes consistently across Windows, macOS, Linux (via tags)

✅ **Improves confidence in iterative analysis sessions:**
- Proves that console remains usable after notebook activity
- Validates cross-component focus management
- Reduces risk of silent regressions that disrupt data science workflows

---

### Issue #2: Add Playwright coverage for console input retention during large output scrolling

#### Background / Problem (User Impact First)

**Critical data science workflow disruption:**

Data scientists frequently work with **large outputs** in the console:
- Printing large DataFrames (100s-1000s of rows) to inspect structure
- Reviewing long stack traces or debug logs
- Examining plot generation details or model summaries
- Streaming output from long-running computations

**Current regression risk:**  
If console input focus is lost while scrolling through output, users experience:
- **Lost cursor position:** Typing starts in wrong location or doesn't register at all
- **Input targeting issues:** Keystrokes go to scroll container instead of input field
- **Flow disruption:** Users must click back into console input, breaking thought process

This is especially problematic when:
- Inspecting DataFrame output and then needing to immediately filter/transform data
- Scrolling through long error messages before retrying a command
- Reviewing multi-line function output before chaining another operation

**Why this matters for notebook-first IDE users:**  
Console-driven workflows are central to exploratory data analysis. Any friction in output inspection → next command severely impacts productivity. Users expect **seamless continuity**: scroll output, then type next command—no clicks required.

---

#### What Should Be Automated

**Exact user behavior to cover:**

**Scenario 1: Print large DataFrame → scroll → type next command**
- User executes command that prints 200-row DataFrame
- User scrolls down to inspect rows 50-100
- User immediately starts typing next command (no click into input)
- Console input should capture keystrokes correctly

**Scenario 2: Long output streaming → scroll during → type after**
- User runs command that produces streaming output (e.g., package install logs)
- While output is streaming, user scrolls to review earlier lines
- Output completes, console returns to ready state
- User types next command—focus should be immediate

**Scenario 3: Scroll to top of old output → return to input**
- User has console with 500+ lines of history
- User scrolls all the way up to review old output
- User presses Cmd+End (or scrolls down) to return to bottom
- User types next command—input should be ready without additional clicks

---

#### Scope of Coverage

**Included workflows:**
- ✅ Execute command with large output → scroll output → type next command
- ✅ Scroll through console history → return to input → verify focus
- ✅ Streaming output → scroll during → verify input after completion
- ✅ Large DataFrame print (Python/R) → scroll → immediate input
- ✅ Long error message → scroll → retry command

**Explicit exclusions:**
- ❌ Notebook cell output scrolling (handled by notebook tests)
- ❌ Terminal pane scrolling (different component)
- ❌ Plot viewer scrolling (not console)
- ❌ Scroll performance/virtualization (performance tests handle this)

---

#### Suggested Playwright Test Locations

**Primary location:**  
`test/e2e/tests/console/console-focus-during-scroll.test.ts` (NEW FILE)

**Why create a new file:**  
- `console-output.test.ts` focuses on output *display correctness*
- `console-input.test.ts` focuses on *input mechanics* (not scrolling)
- This new file focuses on *focus retention during scroll interactions*

**Alternative locations:**
- Extend `test/e2e/tests/console/console-input.test.ts` (less ideal—already has input tests)
- Add to general `console-focus-transitions.test.ts` if that file is created (good consolidation)

---

#### Test Cases to Add (Required)

**Test Suite: Console Input Focus During Output Scrolling**

```typescript
test.describe('Console Focus Retention During Scroll', {
  tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.CRITICAL]
}, () => {

  test('Preserve console input focus after scrolling large DataFrame output - Python', async ({ app, python }) => {
    // 1. Execute code that prints large DataFrame (200 rows)
    // 2. Wait for output to fully render
    // 3. Scroll down in console output area
    // 4. Verify scroll position changed
    // 5. Immediately type next command without clicking
    // 6. Verify typed text appears in console input (not lost)
    // 7. Execute command and verify output
  });

  test('Console input ready after scrolling through console history', async ({ app, python }) => {
    // 1. Execute 20+ commands to build console history
    // 2. Scroll to top of console (earliest output)
    // 3. Scroll back to bottom (current input)
    // 4. Type command immediately
    // 5. Verify input captured correctly
  });

  test('Input focus stable during streaming output with scroll interaction', async ({ app, python }) => {
    // 1. Start command with streaming output (e.g., print lines in loop with delays)
    // 2. While streaming, scroll up to view earlier output
    // 3. Wait for streaming to complete
    // 4. Verify console returns to ready state (>>>)
    // 5. Type next command without clicking
    // 6. Verify input is captured
  });

  test('Console accepts input after scrolling long error message - R', async ({ app, r }) => {
    // 1. Execute R code that produces long error with traceback
    // 2. Scroll through error message
    // 3. Type corrected command immediately
    // 4. Verify input focus is ready
  });

  test('Mouse wheel scroll in output area does not steal focus from input', async ({ app, python }) => {
    // 1. Execute command with large output
    // 2. Use mouse wheel to scroll output (simulate via Playwright)
    // 3. Stop scrolling
    // 4. Type immediately (keyboard)
    // 5. Verify keystrokes go to input, not scroll handler
  });

  test('Keyboard scroll (Page Up/Down) in console preserves input focus', async ({ app, python }) => {
    // 1. Execute command with large output
    // 2. Press Page Down multiple times to scroll
    // 3. Press Page Up to scroll back
    // 4. Type next command
    // 5. Verify input focus is stable
  });
});
```

---

#### Implementation Notes (Playwright + Positron Specific)

**Fixtures to reuse:**
- `app.workbench.console` (console page object)
- `app.workbench.console.activeConsole` (locator for active console)
- `python` and `r` fixtures

**Reliable selectors:**
- **Console output area:** `${ACTIVE_CONSOLE_INSTANCE} .console-output` (scrollable container)
- **Console input field:** `.console-input`
- **Scroll verification:** Use `evaluate()` to check `scrollTop` property before/after scroll

**Generating large output reliably:**
- **Python DataFrame:**
  ```python
  import pandas as pd
  df = pd.DataFrame({'col' + str(i): range(200) for i in range(10)})
  print(df)
  ```
- **R DataFrame:**
  ```r
  df <- data.frame(matrix(1:2000, nrow=200))
  print(df)
  ```
- **Streaming output:**
  ```python
  import time
  for i in range(50):
      print(f"Line {i}")
      time.sleep(0.05)
  ```

**Scroll simulation:**
```typescript
// Scroll output area
const outputArea = app.workbench.console.activeConsole.locator('.console-output');
await outputArea.evaluate(el => el.scrollTop = el.scrollHeight / 2); // Scroll to middle

// Or use mouse wheel
await outputArea.hover();
await app.code.driver.page.mouse.wheel(0, 500); // Scroll down
```

**Focus verification pattern:**
```typescript
// After scroll, verify input still has focus
const consoleInput = app.workbench.console.activeConsole.locator('.console-input');
await expect(consoleInput).toBeFocused();

// Or verify keystrokes are captured
await app.code.driver.page.keyboard.type('test_command');
await app.workbench.console.waitForCurrentConsoleLineContents('test_command');
```

**Avoiding flaky timing:**
- ✅ **DO:** Wait for output rendering to complete before scrolling (use `waitForConsoleContents()`)
- ✅ **DO:** Use `toPass()` for focus verification (focus may stabilize over 1-2 frames)
- ✅ **DO:** Verify scroll actually happened (check `scrollTop` changed)
- ❌ **DON'T:** Assume scroll completes instantly—add small wait after scroll actions
- ❌ **DON'T:** Use fixed timeouts for focus checks—use state-based waits

---

#### Acceptance Criteria

✅ **Regression test fails before fix and passes after:**
- If console focus is broken during/after scrolling, test catches it
- Test fails with clear error: "Console input not focused after scroll interaction"

✅ **Covers a real console workflow used daily by data scientists:**
- Test replicates: print DataFrame → scroll to inspect → type next analysis step
- Matches common pattern: review output details → immediate follow-up command

✅ **Runs reliably in CI without timing hacks:**
- No arbitrary `waitForTimeout()` usage
- Uses proper state verification (output rendered, scroll position stable)
- Passes consistently across Windows, macOS, Linux

✅ **Improves confidence in console output inspection workflows:**
- Proves console remains usable after output scrolling
- Validates focus management in scrollable output scenarios
- Reduces risk of silent regressions that disrupt REPL workflows

---

### Issue #3: Add Playwright coverage for console focus restoration after interrupting long-running computation

#### Background / Problem (User Impact First)

**Critical data science workflow disruption:**

Data scientists frequently interrupt computations:
- **Accidental infinite loops:** Testing loop logic that doesn't terminate as expected
- **Long model training:** Realizing parameters are wrong mid-training
- **Slow data processing:** Interrupting to fix inefficient queries
- **Debugging:** Stopping execution to inspect intermediate state

**Current regression risk:**  
If console focus is not properly restored after interrupt, users experience:
- **Dead console:** Interrupt works, but console input is frozen/unresponsive
- **Lost keystrokes:** Trying to type next command but input is not ready
- **Unclear state:** Console appears ready but doesn't accept input
- **Workflow halt:** User must restart kernel (losing session state) to continue

This is especially critical when:
- Debugging iterative algorithms (frequent interrupt/restart cycles)
- Teaching scenarios where instructors demonstrate interrupt patterns
- Production analysis where interrupting a bad query should not require full kernel restart

**Why this matters for notebook-first IDE users:**  
**Interrupt is a recovery mechanism, not a catastrophic failure.** Users expect:
1. Interrupt computation
2. Console immediately ready for next command
3. Session state preserved (variables intact)

Any focus issues post-interrupt force kernel restarts, **destroying iterative workflow continuity.**

---

#### What Should Be Automated

**Exact user behavior to cover:**

**Scenario 1: Interrupt long computation → type next command**
- User runs command with long-running loop (e.g., `while True: pass`)
- User presses interrupt (Cmd+C or interrupt button)
- Interrupt completes (KeyboardInterrupt or error shown)
- User immediately types next command
- Console input should be ready without additional clicks

**Scenario 2: Interrupt during sleep → console readiness**
- User runs `time.sleep(60)`
- User interrupts after 5 seconds
- Console shows interrupt acknowledgment
- User types `print("test")` immediately
- Console executes command (proves session is alive and input is ready)

**Scenario 3: Interrupt → inspect variables → continue**
- User runs long computation that modifies variables
- User interrupts mid-computation
- User types variable name to inspect current state
- Console shows variable value (proves REPL is responsive)
- User continues analysis

---

#### Scope of Coverage

**Included workflows:**
- ✅ Interrupt infinite loop → verify console input ready
- ✅ Interrupt `sleep` command → type next command
- ✅ Interrupt → inspect variable → continue (session alive)
- ✅ Interrupt via keyboard (Cmd+C) → console focus
- ✅ Interrupt via UI button → console focus
- ✅ Both Python (`KeyboardInterrupt`) and R (interrupt error) scenarios

**Explicit exclusions:**
- ❌ Kernel crash scenarios (handled by kernel lifecycle tests)
- ❌ Interrupt during notebook cell execution (separate test needed)
- ❌ Interrupt during remote kernel execution (remote kernel tests)
- ❌ Multiple rapid interrupts (edge case—not daily workflow)

---

#### Suggested Playwright Test Locations

**Primary location:**  
`test/e2e/tests/console/console-interrupt-recovery.test.ts` (NEW FILE)

**Why create a new file:**  
- `console-python.test.ts` and `console-r.test.ts` have basic interrupt tests (verify interrupt *works*)
- This new file focuses on *focus/input readiness post-interrupt* (recovery behavior)

**Alternative locations:**
- Extend `test/e2e/tests/console/console-python.test.ts` (less ideal—already has interrupt test, would be cluttered)
- Add to `test/e2e/tests/interpreters/interpreter-commands.test.ts` (less ideal—focuses on commands, not console focus)

---

#### Test Cases to Add (Required)

**Test Suite: Console Focus Restoration After Interrupt**

```typescript
test.describe('Console Focus After Interrupt', {
  tag: [tags.WIN, tags.WEB, tags.CONSOLE, tags.CRITICAL]
}, () => {

  test('Console input ready immediately after interrupting infinite loop - Python', async ({ app, python }) => {
    // 1. Paste infinite loop code: while True: pass
    // 2. Execute (do not wait for ready—it won't complete)
    // 3. Wait for execution to start (verify interrupt button appears)
    // 4. Send interrupt (Cmd+C via hotKeys.sendInterrupt())
    // 5. Wait for KeyboardInterrupt error to appear
    // 6. Verify console prompt returns (>>>)
    // 7. Type test command immediately: print("recovered")
    // 8. Verify output appears
  });

  test('Console accepts input after interrupting sleep command - Python', async ({ app, python }) => {
    // 1. Execute: import time; time.sleep(60)
    // 2. Wait for execution to start
    // 3. Interrupt after 2 seconds
    // 4. Wait for interrupt acknowledgment
    // 5. Type: print("interrupted")
    // 6. Verify output shows, proving console is responsive
  });

  test('Console input ready after interrupt via UI button - Python', async ({ app, python }) => {
    // 1. Execute long-running command
    // 2. Click "Interrupt execution" button (not keyboard shortcut)
    // 3. Wait for interrupt to complete
    // 4. Verify console input is immediately ready
    // 5. Type and execute command
  });

  test('Session state preserved and accessible after interrupt - Python', async ({ app, python }) => {
    // 1. Execute: x = 42
    // 2. Execute long-running command that accesses x
    // 3. Interrupt mid-execution
    // 4. Type: print(x)
    // 5. Verify output shows 42 (proves session state intact)
  });

  test('Console input ready after interrupt - R', async ({ app, r }) => {
    // 1. Execute: Sys.sleep(60)
    // 2. Wait for execution to start
    // 3. Interrupt after 2 seconds
    // 4. Wait for R interrupt error
    // 5. Type: print("recovered")
    // 6. Verify output appears
  });

  test('Multiple interrupt-resume cycles maintain console focus', async ({ app, python }) => {
    // 1. Execute long command → interrupt → verify ready
    // 2. Execute another long command → interrupt → verify ready
    // 3. Execute another long command → interrupt → verify ready
    // 4. Proves console focus recovery is reliable across multiple cycles
  });
});
```

---

#### Implementation Notes (Playwright + Positron Specific)

**Fixtures to reuse:**
- `app.workbench.console` (console page object with `interruptExecution()` method)
- `app.workbench.hotKeys.sendInterrupt()` (keyboard-based interrupt)
- `python` and `r` fixtures

**Reliable selectors:**
- **Interrupt button:** `getByLabel('Interrupt execution')` (already used in console.ts)
- **Console ready state:** `.active-line-number` showing `>>>` (Python) or `>` (R)
- **Interrupt acknowledgment:** `waitForConsoleContents('KeyboardInterrupt')` (Python)

**Long-running command patterns:**
```python
# Python infinite loop
while True: pass

# Python long sleep
import time; time.sleep(60)

# Python loop with work
for i in range(1000000):
    x = i ** 2  # Some work to show progress
```

```r
# R long sleep
Sys.sleep(60)

# R infinite loop
while(TRUE) { }
```

**Interrupt verification pattern:**
```typescript
// Start long command (do NOT waitForReady)
await app.workbench.console.pasteCodeToConsole('while True: pass');
await app.workbench.console.sendEnterKey();

// Wait for execution to start
await app.workbench.console.waitForExecutionStarted();

// Send interrupt
await app.workbench.console.interruptExecution();

// Wait for interrupt to complete
await app.workbench.console.waitForConsoleContents('KeyboardInterrupt');

// Verify console is ready
await app.workbench.console.waitForReady('>>>');

// Immediate input test
await app.workbench.console.typeToConsole('print("test")');
await app.workbench.console.sendEnterKey();
await app.workbench.console.waitForConsoleContents('test');
```

**Avoiding flaky timing:**
- ✅ **DO:** Use `waitForExecutionStarted()` before interrupting (ensures command is running)
- ✅ **DO:** Use `waitForConsoleContents()` to verify interrupt acknowledgment
- ✅ **DO:** Use `waitForReady(prompt)` to verify console prompt returns
- ❌ **DON'T:** Interrupt too quickly—command may not have started yet
- ❌ **DON'T:** Assume immediate readiness—add state verification

---

#### Acceptance Criteria

✅ **Regression test fails before fix and passes after:**
- If console focus is broken post-interrupt, test catches it
- Test fails with clear error: "Console not ready after interrupt"

✅ **Covers a real console workflow used daily by data scientists:**
- Test replicates: run bad query → interrupt → fix and retry
- Matches common debugging pattern: test loop → interrupt → adjust → retry

✅ **Runs reliably in CI without timing hacks:**
- No arbitrary `waitForTimeout()` usage
- Uses proper state verification (execution started, interrupt complete, ready state)
- Passes consistently across Windows, macOS, Linux

✅ **Improves confidence in iterative debugging sessions:**
- Proves console remains usable after interrupt recovery
- Validates interrupt does not break console input
- Reduces risk of forcing kernel restarts after interrupt

---

### Issue #4: Add Playwright coverage for console focus during multi-cell notebook execution

#### Background / Problem (User Impact First)

**High-impact data science workflow:**

Data scientists frequently execute **multiple notebook cells in sequence**:
- Running a full analysis pipeline from start to finish
- Re-running a section of cells after editing upstream code
- Executing "setup" cells before starting interactive exploration
- Teaching scenarios where multiple cells run during demonstrations

**Current regression risk:**  
If console focus is affected during multi-cell execution, users experience:
- **Console becomes unresponsive** while notebook is busy
- **Cannot inspect variables** in console during notebook execution
- **Lost ability to interrupt** if notebook execution goes wrong
- **Focus stuck on notebook** after multi-cell execution completes

This is especially problematic when:
- Running a long notebook pipeline and wanting to check console for earlier results
- Needing to interrupt notebook execution from console
- Switching between notebook (for documentation) and console (for quick checks)

**Why this matters for notebook-first IDE users:**  
Positron's strength is **seamless notebook + console integration.** Multi-cell execution should not "lock out" the console. Users expect:
1. Run multiple notebook cells
2. Console remains responsive for variable inspection
3. After notebook cells complete, console is immediately ready for next command

---

#### What Should Be Automated

**Exact user behavior to cover:**

**Scenario 1: Run 5+ cells → switch to console → verify readiness**
- User has notebook with 5+ cells of sequential code
- User executes all cells (Run All or select + execute)
- While cells are executing, user switches to console
- Console should allow input (not blocked by notebook execution)
- After all cells complete, console should be immediately ready

**Scenario 2: Run cells → inspect variable in console → return to notebook**
- User runs multiple notebook cells that create variables
- User switches to console mid-execution
- User types variable name to inspect
- Console shows current variable state
- User returns to notebook to continue

**Scenario 3: Run cells → console remains interruptible**
- User runs notebook cells with long execution time
- User switches to console
- If needed, user can interrupt from console (Cmd+C)
- Console reflects interrupt status

---

#### Scope of Coverage

**Included workflows:**
- ✅ Execute multiple notebook cells → verify console responsiveness
- ✅ Multi-cell execution → switch to console → type command
- ✅ Multi-cell execution complete → console immediately ready
- ✅ Console variable inspection during notebook execution
- ✅ Both Python and R notebook scenarios

**Explicit exclusions:**
- ❌ Single cell execution (covered by Issue #1)
- ❌ Notebook scratchpad console (separate feature)
- ❌ Parallel kernel execution (not supported)
- ❌ Remote notebook kernels (remote kernel tests)

---

#### Suggested Playwright Test Locations

**Primary location:**  
`test/e2e/tests/notebooks-positron/notebook-console-multi-cell.test.ts` (NEW FILE)

**Alternative locations:**
- Extend `test/e2e/tests/notebooks-positron/notebook-console-focus.test.ts` (if Issue #1 file is created)
- Add to `test/e2e/tests/notebooks-positron/notebook-kernel-behavior.test.ts` (less ideal—too broad)

---

#### Test Cases to Add (Required)

**Test Suite: Console Focus During Multi-Cell Notebook Execution**

```typescript
test.describe('Console During Multi-Cell Execution', {
  tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS, tags.CONSOLE]
}, () => {

  test('Console remains responsive during multi-cell notebook execution - Python', async ({ app, python }) => {
    // 1. Create notebook with 5 cells, each with simple code (e.g., x = i, print(i))
    // 2. Select all 5 cells
    // 3. Execute all cells (Run All or execute selection)
    // 4. While cells are executing (verify at least 1 cell still busy)
    // 5. Switch to console
    // 6. Type command in console (e.g., print("console works"))
    // 7. Verify console executes command (proves not blocked)
  });

  test('Console input ready immediately after multi-cell execution completes', async ({ app, python }) => {
    // 1. Create notebook with 5 cells
    // 2. Execute all cells
    // 3. Wait for all cells to complete (all show idle/done state)
    // 4. Switch to console
    // 5. Type command immediately (no extra clicks)
    // 6. Verify console executes command
  });

  test('Console can inspect variables created by notebook cells during execution', async ({ app, python }) => {
    // 1. Create notebook with cells that define variables (x = 1, y = 2, etc.)
    // 2. Execute all cells
    // 3. After first 2 cells complete, switch to console
    // 4. Type: print(x, y) (variables from completed cells)
    // 5. Verify console shows correct values
    // 6. Wait for remaining cells to complete
    // 7. Verify console still responsive
  });

  test('Console interrupt works during multi-cell notebook execution', async ({ app, python }) => {
    // 1. Create notebook with 3 cells, middle cell has long sleep
    // 2. Execute all cells
    // 3. Wait for middle cell to start (first cell done, second cell running)
    // 4. Switch to console
    // 5. Send interrupt from console (Cmd+C)
    // 6. Verify notebook execution stops
    // 7. Verify console is ready for input
  });

  test('Multi-cell execution → console focus stable - R', async ({ app, r }) => {
    // Same as first test but with R kernel
  });
});
```

---

#### Implementation Notes (Playwright + Positron Specific)

**Fixtures to reuse:**
- `app.workbench.notebooksPositron` (notebook page object)
- `app.workbench.console` (console page object)
- `python` and `r` fixtures

**Multi-cell execution pattern:**
```typescript
// Create notebook with multiple cells
await app.workbench.notebooksPositron.newNotebook({ codeCells: 5 });

// Add code to each cell
for (let i = 0; i < 5; i++) {
  await app.workbench.notebooksPositron.addCodeToCell(i, `x${i} = ${i}`);
}

// Execute all cells
await app.workbench.notebooksPositron.selectCellAtIndex(0);
for (let i = 1; i < 5; i++) {
  await app.code.driver.page.keyboard.down('Shift');
  await app.code.driver.page.keyboard.press('ArrowDown');
}
await app.code.driver.page.keyboard.up('Shift');
await app.workbench.hotKeys.executeNotebookCell(); // Executes selected cells
```

**Verify notebook execution state:**
```typescript
// Wait for specific cell to be running
await app.workbench.notebooksPositron.expectExecutionStatusToBe(2, 'running');

// Wait for all cells to complete
for (let i = 0; i < 5; i++) {
  await app.workbench.notebooksPositron.expectExecutionStatusToBe(i, 'idle');
}
```

**Console responsiveness check:**
```typescript
// While notebook is executing, verify console works
await app.workbench.console.focus();
await app.workbench.console.typeToConsole('print("console works")');
await app.workbench.console.sendEnterKey();
await app.workbench.console.waitForConsoleContents('console works');
```

**Avoiding flaky timing:**
- ✅ **DO:** Verify at least one cell is running before testing console
- ✅ **DO:** Use `expectExecutionStatusToBe()` for cell state verification
- ✅ **DO:** Wait for all cells to complete before final console readiness check
- ❌ **DON'T:** Assume cells execute instantly—add proper waits
- ❌ **DON'T:** Test console during cell 1 execution (may complete too fast)

---

#### Acceptance Criteria

✅ **Regression test fails before fix and passes after:**
- If console is blocked during multi-cell execution, test catches it
- Test fails with clear error: "Console not responsive during notebook execution"

✅ **Covers a real notebook+console workflow used daily:**
- Test replicates: run full analysis pipeline → check console for variable state
- Matches common pattern: execute notebook section → inspect results in console

✅ **Runs reliably in CI without timing hacks:**
- No arbitrary `waitForTimeout()` usage
- Uses proper state verification (cell execution status, console ready)
- Passes consistently across platforms

✅ **Improves confidence in notebook+console integration:**
- Proves console remains usable during notebook activity
- Validates parallel notebook/console workflows
- Reduces risk of console "lockout" during notebook execution

---

### Issue #5: Add Playwright coverage for console focus after Positron Assistant notebook interactions

#### Background / Problem (User Impact First)

**Emerging data science workflow:**

With Positron Assistant integration, users increasingly rely on **AI-assisted notebook editing**:
- Asking Assistant to fix broken code in a cell
- Requesting Assistant to explain error messages
- Using Assistant to generate new analysis code
- Assistant editing cell content directly

**Current regression risk:**  
If console focus is disrupted after Assistant interactions, users experience:
- **Focus stuck in Assistant panel** after dismissing suggestions
- **Cannot immediately test Assistant-generated code** in console
- **Lost keystrokes** when trying to switch from Assistant to console
- **Workflow friction** requiring extra clicks to restore console

This is especially problematic when:
- Using Assistant to fix notebook code, then wanting to test in console
- Asking Assistant for code snippet, copying to console for quick test
- Assistant modifies cell, user wants to inspect result in console immediately

**Why this matters for AI-assisted workflows:**  
As Positron expands Assistant capabilities, **seamless transitions between AI suggestions and console testing** become critical. Users expect:
1. Ask Assistant for help
2. Review/apply suggestion
3. Dismiss Assistant panel
4. Console immediately ready for testing

Any focus issues disrupt the **"AI suggests → user tests"** feedback loop.

---

#### What Should Be Automated

**Exact user behavior to cover:**

**Scenario 1: Assistant fixes notebook cell → test in console**
- User has notebook cell with error
- User invokes Assistant to fix error
- Assistant suggests fix, user accepts
- User dismisses Assistant panel
- User switches to console to test related code
- Console input should be immediately ready

**Scenario 2: Assistant generates code → copy to console**
- User asks Assistant for code snippet
- Assistant provides code in chat
- User reviews code (does not apply to cell)
- User switches to console to test snippet
- Console should accept paste and execute

**Scenario 3: Assistant explains error → retry in console**
- Notebook cell produces error
- User asks Assistant to explain
- Assistant provides explanation
- User dismisses Assistant
- User switches to console to try alternative approach
- Console input ready immediately

---

#### Scope of Coverage

**Included workflows:**
- ✅ Assistant edits notebook cell → switch to console
- ✅ Assistant chat interaction → switch to console
- ✅ Dismiss Assistant panel → console focus restoration
- ✅ Assistant code suggestion → test in console

**Explicit exclusions:**
- ❌ Assistant chat-only workflows (no notebook interaction)
- ❌ Assistant code generation quality (functional testing, not focus)
- ❌ Assistant panel UI interactions (Assistant-specific tests)
- ❌ Non-notebook Assistant usage (editor assistant is separate)

---

#### Suggested Playwright Test Locations

**Primary location:**  
`test/e2e/tests/positron-assistant/assistant-notebook-console-flow.test.ts` (NEW FILE)

**Why create a new file:**
- `notebook-assistant-features.test.ts` focuses on Assistant UI visibility
- This new file focuses on **focus transitions after Assistant interactions**

**Alternative locations:**
- Extend `test/e2e/tests/notebooks-positron/notebook-console-focus.test.ts` (if Issue #1 file created)
- Add to `test/e2e/tests/positron-assistant/` (good if Assistant tests are expanding)

---

#### Test Cases to Add (Required)

**Test Suite: Console Focus After Assistant Interactions**

```typescript
test.describe('Console Focus After Assistant Notebook Interactions', {
  tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS, tags.CONSOLE, tags.ASSISTANT]
}, () => {

  test.beforeEach(async ({ settings }) => {
    // Enable Assistant for these tests
    await settings.set({
      'positron.assistant.enable': true,
    });
  });

  test('Console input ready after Assistant fixes notebook cell', async ({ app, python }) => {
    const { notebooksPositron, console, assistant } = app.workbench;
    
    // 1. Create notebook with cell containing error
    await notebooksPositron.newNotebook({ codeCells: 1 });
    await notebooksPositron.addCodeToCell(0, 'print(undefined_var)');
    
    // 2. Execute cell to trigger error
    await notebooksPositron.executeCodeInCell();
    
    // 3. Invoke Assistant to fix error (use cell action)
    await notebooksPositron.triggerCellAction(0, 'Ask assistant to fix');
    
    // 4. Wait for Assistant to respond (may need to mock or use real response)
    await assistant.waitForResponse();
    
    // 5. Accept Assistant suggestion (if applicable)
    // await assistant.acceptSuggestion(); // implementation depends on Assistant API
    
    // 6. Dismiss Assistant panel
    await assistant.closePanel();
    
    // 7. Switch to console
    await console.focus();
    
    // 8. Type command immediately
    await console.typeToConsole('print("test")');
    await console.sendEnterKey();
    
    // 9. Verify console executed command
    await console.waitForConsoleContents('test');
  });

  test('Console focus stable after dismissing Assistant chat', async ({ app, python }) => {
    const { notebooksPositron, console, assistant } = app.workbench;
    
    // 1. Open notebook
    await notebooksPositron.newNotebook({ codeCells: 1 });
    
    // 2. Open Assistant chat
    await assistant.openPositronAssistantChat();
    
    // 3. Ask Assistant a question
    await assistant.sendMessage('How do I create a DataFrame?');
    await assistant.waitForResponse();
    
    // 4. Close Assistant panel
    await assistant.closePanel();
    
    // 5. Switch to console
    await console.focus();
    
    // 6. Verify console input is immediately ready
    await console.typeToConsole('x = 1');
    await console.sendEnterKey();
    await console.waitForReady('>>>');
  });

  test('Console accepts input after Assistant explains notebook error', async ({ app, python }) => {
    const { notebooksPositron, console, assistant } = app.workbench;
    
    // 1. Create notebook with error-producing cell
    await notebooksPositron.newNotebook({ codeCells: 1 });
    await notebooksPositron.addCodeToCell(0, '1 / 0');
    await notebooksPositron.executeCodeInCell();
    
    // 2. Invoke Assistant to explain error
    await notebooksPositron.triggerCellAction(0, 'Ask assistant to explain');
    await assistant.waitForResponse();
    
    // 3. Dismiss Assistant
    await assistant.closePanel();
    
    // 4. Switch to console to try alternative
    await console.focus();
    await console.typeToConsole('print("trying alternative")');
    await console.sendEnterKey();
    await console.waitForConsoleContents('trying alternative');
  });
});
```

**Note:** Implementation details depend on Assistant API maturity. Tests may need mocking or simplified scenarios if full Assistant integration is not stable.

---

#### Implementation Notes (Playwright + Positron Specific)

**Fixtures to reuse:**
- `app.workbench.notebooksPositron` (notebook page object)
- `app.workbench.console` (console page object)
- `app.workbench.assistant` (Assistant page object—may need to be created/extended)
- `settings` fixture (to enable Assistant)

**Assistant interactions (depends on implementation):**
```typescript
// Open Assistant panel
await app.workbench.assistant.openPositronAssistantChat();

// Send message to Assistant
await app.workbench.assistant.sendMessage('How do I...?');

// Wait for response
await app.workbench.assistant.waitForResponse();

// Close Assistant panel
await app.workbench.assistant.closePanel();
```

**Reliable selectors (may vary based on Assistant implementation):**
- **Assistant panel:** `.positron-assistant-chat` or similar
- **Assistant close button:** `getByLabel('Close Assistant')`
- **Cell action menu:** Already implemented in `notebooksPositron.triggerCellAction()`

**Avoiding flaky timing:**
- ✅ **DO:** Wait for Assistant response before closing panel
- ✅ **DO:** Verify Assistant panel is fully closed before switching to console
- ✅ **DO:** Use `waitForReady()` to confirm console prompt after focus switch
- ❌ **DON'T:** Assume Assistant responds instantly—use proper waits
- ❌ **DON'T:** Test focus immediately after Assistant opens—wait for panel to stabilize

**Handling Assistant variability:**
- If Assistant responses are non-deterministic, consider:
  - Mocking Assistant responses for test reliability
  - Using simple, predictable Assistant queries
  - Focusing tests on *focus behavior* not *Assistant quality*

---

#### Acceptance Criteria

✅ **Regression test fails before fix and passes after:**
- If console focus is broken after Assistant interaction, test catches it
- Test fails with clear error: "Console not ready after Assistant panel closed"

✅ **Covers a real AI-assisted notebook workflow:**
- Test replicates: Ask Assistant → apply suggestion → test in console
- Matches emerging pattern: AI generates code → user tests immediately

✅ **Runs reliably in CI (with Assistant properly configured):**
- No arbitrary `waitForTimeout()` usage
- Uses proper state verification (Assistant responded, panel closed, console ready)
- May require Assistant mocking for CI stability

✅ **Improves confidence in AI-assisted workflows:**
- Proves console remains usable after Assistant interactions
- Validates focus management across Assistant + notebook + console
- Reduces risk of disrupting emerging AI-powered workflows

---

## Summary & Implementation Roadmap

### Recommended Implementation Order

1. **Issue #1** (Console focus after notebook execution) - **HIGHEST PRIORITY**
   - Most common workflow, highest regression risk
   - Establishes foundation for cross-component focus tests
   - Estimated effort: 4-6 hours (includes new test file setup)

2. **Issue #3** (Console focus after interrupt) - **CRITICAL FOR DEBUGGING**
   - Essential for iterative development workflows
   - Relatively simple test scenarios
   - Estimated effort: 2-3 hours

3. **Issue #2** (Console focus during scroll) - **HIGH IMPACT, MEDIUM COMPLEXITY**
   - Common during DataFrame inspection workflows
   - Requires scroll interaction testing setup
   - Estimated effort: 3-4 hours

4. **Issue #4** (Multi-cell execution) - **BUILDS ON ISSUE #1**
   - Extends single-cell focus tests to multi-cell scenarios
   - Can reuse fixtures from Issue #1
   - Estimated effort: 2-3 hours

5. **Issue #5** (Assistant interactions) - **FUTURE-PROOFING**
   - Emerging workflow as Assistant matures
   - May require Assistant API stabilization first
   - Estimated effort: 4-6 hours (includes Assistant test infrastructure)

### Total Estimated Effort
**16-22 hours** of focused Playwright test development

### Impact Assessment
- **Without these tests:** Silent regressions in console focus will disrupt data science workflows, forcing users to work around focus issues with extra clicks/keyboard shortcuts
- **With these tests:** Continuous confidence that console remains responsive during all major workflows, protecting core Positron value proposition

### Next Steps
1. Create test infrastructure (new test files, shared fixtures)
2. Implement Issues #1 and #3 first (highest impact, foundational)
3. Add Issues #2 and #4 (build on foundation)
4. Monitor Assistant maturity, implement Issue #5 when ready

---

## Appendix: Existing Coverage Summary

### Well-Covered Areas
✅ Console input mechanics (typing, pasting, history)  
✅ Console output rendering (text, ANSI, wrapping)  
✅ Basic interrupt commands (interrupt works)  
✅ Notebook cell focus (within notebook)  
✅ Session switching (between interpreters)  
✅ Clipboard operations in console  

### Coverage Gaps (Addressed by This Analysis)
❌ Console focus after notebook cell execution  
❌ Console input during output scrolling  
❌ Console readiness post-interrupt  
❌ Console focus during multi-cell notebook runs  
❌ Console focus after Assistant interactions  

### Test File Locations Reference
- **Console tests:** `test/e2e/tests/console/`
- **Notebook tests (Positron-specific):** `test/e2e/tests/notebooks-positron/`
- **Notebook tests (VSCode):** `test/e2e/tests/notebook/`
- **Assistant tests:** `test/e2e/tests/positron-assistant/`
- **Page objects:** `test/e2e/pages/console.ts`, `test/e2e/pages/notebooksPositron.ts`

---

**End of Analysis**

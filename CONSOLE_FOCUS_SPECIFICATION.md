# Console Focus Management and Expected Interaction Behaviors
## Requirements-Level Specification for Positron IDE

**Generated:** 2026-02-04 10:41 UTC

---

## Executive Summary

This specification analyzes **100** open and **100** closed 
console issues from the Positron repository, filtering for focus and input targeting behavior.

**Focus-Related Issues Found:**
- Open: 43 of 100 (43.0%)
- Closed: 23 of 100 (23.0%)

This document extracts a coherent **Console Focus Model** based on:
- What behaviors are currently broken (open issues)
- What behaviors are already fixed/guaranteed (closed issues)
- What the expected state transitions are

---

# PART 1: OPEN ISSUES — Currently Broken Focus Behaviors

## Overview

**Total Open Focus-Related Issues:** 43

**Distribution by Focus Type:**
- Interaction Rules: 16 issues
- Click/Scroll Focus Behavior: 11 issues
- Prompt Lifecycle Focus: 6 issues
- Unexpected Focus Change: 5 issues
- General Focus Issue: 4 issues
- Terminal Consistency: 1 issues

**Severity Distribution:**
- High: 3 issues
- Medium: 36 issues
- Low: 4 issues

---

## Open Issues by Focus Type

### Interaction Rules (16 issues)

**High-Priority Issues:**

#### Issue #9699: Notebook: Notebook consoles don't show plots or HTML widgets
*Severity: High*

**URL:** https://github.com/posit-dev/positron/issues/9699

**Focus Keywords:** select, click

**Expected:** or desired behavior:
**Actual:** clicking it doesn't do anything

---

**Other Issues:**

| # | Title | Severity |
|---|-------|----------|
| [#11478](https://github.com/posit-dev/positron/issues/11478) | Console: Mechanism to select start folder in multi-root workspace | Medium |
| [#11411](https://github.com/posit-dev/positron/issues/11411) | console: double-clicking text should select it, not jump to the bottom | Medium |
| [#9856](https://github.com/posit-dev/positron/issues/9856) | Columns with a URL that are abbreviated in the console change the actu... | Medium |
| [#9449](https://github.com/posit-dev/positron/issues/9449) | Slow startup (time to interactive R console) | Low |
| [#8803](https://github.com/posit-dev/positron/issues/8803) | Should `"editor.acceptSuggestionOnEnter": "smart"` apply to our consol... | Medium |
| [#8471](https://github.com/posit-dev/positron/issues/8471) | Console: Pasting can jitter the console preventing it from auto scroll... | Medium |
| [#8447](https://github.com/posit-dev/positron/issues/8447) | Un-register interpreter when a runtime is removed by user | Medium |
| [#7379](https://github.com/posit-dev/positron/issues/7379) | Console: Can't navigate history popup with PageUp/PageDown or click | Medium |
| [#7072](https://github.com/posit-dev/positron/issues/7072) | Session quickpick should order items by the last selected time | Medium |
| [#5797](https://github.com/posit-dev/positron/issues/5797) | Create new command to interpolate text into code, to run in the consol... | Medium |
| [#5581](https://github.com/posit-dev/positron/issues/5581) | Console: Sticky Scroll; show command for context while viewing its out... | Medium |
| [#5115](https://github.com/posit-dev/positron/issues/5115) | Feature request: add more JSON prompts in the workbench settings to al... | Medium |
| [#5023](https://github.com/posit-dev/positron/issues/5023) | `executeCode`: Surprising behaviour when evaluating syntactically inco... | Medium |
| [#4585](https://github.com/posit-dev/positron/issues/4585) | Console: Pasting a very long chunk of code into the console breaks scr... | Medium |
| [#4445](https://github.com/posit-dev/positron/issues/4445) | R: Console doesn't scroll down to input line when focused | Medium |

### Click/Scroll Focus Behavior (11 issues)

**High-Priority Issues:**

#### Issue #7100: Python: Cursor skips to end of function after an empty line
*Severity: High*

**URL:** https://github.com/posit-dev/positron/issues/7100

**Focus Keywords:** cursor

**Trigger:** an empty line
**Expected:** or desired behavior:
**Actual:** the next code line **within the if-statement** should be executed

---

#### Issue #5272: Frontend should break up multiline selections that get sent to Console by complete expressions
*Severity: High*

**URL:** https://github.com/posit-dev/positron/issues/5272

**Focus Keywords:** select, type, input, prompt

**Expected:** behaviour when the user sends very long input
**Actual:** enqueue complete expressions invisibly

---

**Other Issues:**

| # | Title | Severity |
|---|-------|----------|
| [#10972](https://github.com/posit-dev/positron/issues/10972) | LSP in the console: let language servers statically analyze console hi... | Medium |
| [#9530](https://github.com/posit-dev/positron/issues/9530) | Output from later/promises doesn't get matched to correct console inpu... | Medium |
| [#9500](https://github.com/posit-dev/positron/issues/9500) | "Ctrl+n" keybinding does not work in the R console | Medium |
| [#8738](https://github.com/posit-dev/positron/issues/8738) | Cannot scroll within multiline statements in R Console | Medium |
| [#8687](https://github.com/posit-dev/positron/issues/8687) | Console input prompt does not focus when an activity input prompt ends | Medium |
| [#7118](https://github.com/posit-dev/positron/issues/7118) | Console: Unable to focus after Notebook + Max Aux Bar View | Medium |
| [#5452](https://github.com/posit-dev/positron/issues/5452) | Should execution mode be handled by the main thread rather than runtim... | Medium |
| [#5189](https://github.com/posit-dev/positron/issues/5189) | Unexpected continuation prompt on Enter due to conflict between comple... | Medium |
| [#4502](https://github.com/posit-dev/positron/issues/4502) | Attempting to return a polars lazyframe removes the console | Medium |

### Prompt Lifecycle Focus (6 issues)

**Other Issues:**

| # | Title | Severity |
|---|-------|----------|
| [#10411](https://github.com/posit-dev/positron/issues/10411) | Console: Poor/no feedback when kernel is unreachable | Medium |
| [#8201](https://github.com/posit-dev/positron/issues/8201) | Can't correctly paste into Python `input()` or R `menu()` prompt in th... | Medium |
| [#7575](https://github.com/posit-dev/positron/issues/7575) | Epic: Assistant: Support Inline Chat for Console | Medium |
| [#6895](https://github.com/posit-dev/positron/issues/6895) | Console Restore: Continuation prompts not restored | Medium |
| [#5710](https://github.com/posit-dev/positron/issues/5710) | Windows: `Ctrl + C` is unreliable to interrupt a `readline()` | Low |
| [#4802](https://github.com/posit-dev/positron/issues/4802) | Statement range executions currently aren't considered as `input_reply... | Medium |

### Unexpected Focus Change (5 issues)

**Other Issues:**

| # | Title | Severity |
|---|-------|----------|
| [#10929](https://github.com/posit-dev/positron/issues/10929) | Console: Return of the Dancing Consoles (flipping between R/Python at ... | Medium |
| [#10016](https://github.com/posit-dev/positron/issues/10016) | Python console intermittently fails to restart properly (restart butto... | Low |
| [#6896](https://github.com/posit-dev/positron/issues/6896) | Console Restore: Possibility for dropped output | Medium |
| [#5898](https://github.com/posit-dev/positron/issues/5898) | Console: should Esc cancel a continuation prompt? | Medium |
| [#4447](https://github.com/posit-dev/positron/issues/4447) | Cancel multiline input with `Esc` at console | Low |

### General Focus Issue (4 issues)

**Other Issues:**

| # | Title | Severity |
|---|-------|----------|
| [#8690](https://github.com/posit-dev/positron/issues/8690) | Cannot clear line when in pdb | Medium |
| [#7903](https://github.com/posit-dev/positron/issues/7903) | Absent action/behavior for 'Show Active Interpreter Session Profile Re... | Medium |
| [#5840](https://github.com/posit-dev/positron/issues/5840) | Python: Improve the discovery of the %view magic use in the Console to... | Medium |
| [#4594](https://github.com/posit-dev/positron/issues/4594) | Invalid input run from editor does not produce error in console (is no... | Medium |

### Terminal Consistency (1 issues)

**Other Issues:**

| # | Title | Severity |
|---|-------|----------|
| [#8173](https://github.com/posit-dev/positron/issues/8173) | Cmd + click on link in Console asks about an external URI opener | Medium |

## Broken Focus Behaviors (Unmet Requirements)

Based on open issues, these focus behaviors are **currently broken** and must be fixed:

### Click/Scroll Focus Behavior

- **[Medium]** Console must lsp in the console: let language servers statically analyze console history (Issue #10972)
- **[Medium]** Console must output from later/promises doesn't get matched to correct console input (Issue #9530)
- **[Medium]** Console must "ctrl+n" keybinding does not work in the r console (Issue #9500)
- **[Medium]** Console must cannot scroll within multiline statements in r console (Issue #8738)
- **[Medium]** Console must console input prompt does not focus when an activity input prompt ends (Issue #8687)
- **[Medium]** Console must console: unable to focus after notebook + max aux bar view (Issue #7118)
- **[Medium]** Console must should execution mode be handled by the main thread rather than runtimes? (Issue #5452)
- **[Medium]** Console must unexpected continuation prompt on enter due to conflict between completions and console (Issue #5189)
- **[Medium]** Console must attempting to return a polars lazyframe removes the console (Issue #4502)
- **[High]** Console must python: cursor skips to end of function after an empty line (Issue #7100)
- **[High]** Console must frontend should break up multiline selections that get sent to console by complete expressions (Issue #5272)

### General Focus Issue

- **[Medium]** Console must cannot clear line when in pdb (Issue #8690)
- **[Medium]** Console must absent action/behavior for 'show active interpreter session profile report' (workbench.action.languageruntime.showprofile) (Issue #7903)
- **[Medium]** Console must python: improve the discovery of the %view magic use in the console to view data frames (Issue #5840)
- **[Medium]** Console must invalid input run from editor does not produce error in console (is not executed) (Issue #4594)

### Interaction Rules

- **[Low]** Console must slow startup (time to interactive r console) (Issue #9449)
- **[Medium]** Console must console: mechanism to select start folder in multi-root workspace (Issue #11478)
- **[Medium]** Console must console: double-clicking text should select it, not jump to the bottom (Issue #11411)
- **[Medium]** Console must columns with a url that are abbreviated in the console change the actual content of that column (when clicking). (Issue #9856)
- **[Medium]** Console must should `"editor.acceptsuggestiononenter": "smart"` apply to our console? (Issue #8803)
- **[Medium]** Console must console: pasting can jitter the console preventing it from auto scrolling (Issue #8471)
- **[Medium]** Console must un-register interpreter when a runtime is removed by user (Issue #8447)
- **[Medium]** Console must console: can't navigate history popup with pageup/pagedown or click (Issue #7379)
- **[Medium]** Console must session quickpick should order items by the last selected time (Issue #7072)
- **[Medium]** Console must create new command to interpolate text into code, to run in the console (Issue #5797)
- **[Medium]** Console must console: sticky scroll; show command for context while viewing its output (Issue #5581)
- **[Medium]** Console must feature request: add more json prompts in the workbench settings to allow distinguishing of sent and received code and output (Issue #5115)
- **[Medium]** Console must `executecode`: surprising behaviour when evaluating syntactically incorrect code (Issue #5023)
- **[Medium]** Console must console: pasting a very long chunk of code into the console breaks scroll (Issue #4585)
- **[Medium]** Console must r: console doesn't scroll down to input line when focused (Issue #4445)
- **[High]** Console must notebook: notebook consoles don't show plots or html widgets (Issue #9699)

### Prompt Lifecycle Focus

- **[Low]** Console must windows: `ctrl + c` is unreliable to interrupt a `readline()` (Issue #5710)
- **[Medium]** Console must console: poor/no feedback when kernel is unreachable (Issue #10411)
- **[Medium]** Console must can't correctly paste into python `input()` or r `menu()` prompt in the console on windows (Issue #8201)
- **[Medium]** Console must epic: assistant: support inline chat for console (Issue #7575)
- **[Medium]** Console must console restore: continuation prompts not restored (Issue #6895)
- **[Medium]** Console must statement range executions currently aren't considered as `input_reply`s, is that right? (Issue #4802)

### Terminal Consistency

- **[Medium]** Console must cmd + click on link in console asks about an external uri opener (Issue #8173)

### Unexpected Focus Change

- **[Low]** Console must python console intermittently fails to restart properly (restart button on console action bar) (Issue #10016)
- **[Low]** Console must cancel multiline input with `esc` at console (Issue #4447)
- **[Medium]** Console must console: return of the dancing consoles (flipping between r/python at boot) (Issue #10929)
- **[Medium]** Console must console restore: possibility for dropped output (Issue #6896)
- **[Medium]** Console must console: should esc cancel a continuation prompt? (Issue #5898)

---

# PART 2: CLOSED ISSUES — Fixed/Guaranteed Focus Behaviors

## Overview

**Total Closed Focus-Related Issues:** 23

**Distribution by Focus Type:**
- Interaction Rules: 7 issues
- General Focus Issue: 6 issues
- Click/Scroll Focus Behavior: 5 issues
- Unexpected Focus Change: 4 issues
- Terminal Consistency: 1 issues

---

## Closed Issues by Focus Type

### Interaction Rules (7 fixes)

| # | Title | Fixed Behavior |
|---|-------|----------------|
| [#10518](https://github.com/posit-dev/positron/issues/10518) | Right click on output shows right click options fo... | Resolved interaction rules |
| [#10376](https://github.com/posit-dev/positron/issues/10376) | Ctrl+Enter Fails to Execute R Code with dplyr Pipe... | Resolved interaction rules |
| [#10158](https://github.com/posit-dev/positron/issues/10158) | Can't interrupt selection/activity prompts on Wind... | Resolved interaction rules |
| [#10058](https://github.com/posit-dev/positron/issues/10058) | Copying text from console with context menu adds `... | Resolved interaction rules |
| [#7884](https://github.com/posit-dev/positron/issues/7884) | multisessions: with exited sessions the `+` sessio... | Resolved interaction rules |
| [#7005](https://github.com/posit-dev/positron/issues/7005) | Console Multisessions: new session created when us... | Resolved interaction rules |
| [#6451](https://github.com/posit-dev/positron/issues/6451) | Console Multisessions: Keyboard Accessibility / Mo... | Resolved interaction rules |

### General Focus Issue (6 fixes)

| # | Title | Fixed Behavior |
|---|-------|----------------|
| [#10713](https://github.com/posit-dev/positron/issues/10713) | Keep "Cmd click to launch VS Code Native REPL" fro... | Resolved general focus issue |
| [#10593](https://github.com/posit-dev/positron/issues/10593) | Wrong JSON typing for console.fontLigatures | Resolved general focus issue |
| [#10045](https://github.com/posit-dev/positron/issues/10045) | Running Python module imports from subdirectories ... | Resolved general focus issue |
| [#7693](https://github.com/posit-dev/positron/issues/7693) | Multisessions: Cannot read properties of null (rea... | Resolved general focus issue |
| [#7681](https://github.com/posit-dev/positron/issues/7681) | `demo(graphics)` is not interactive the first time... | Resolved general focus issue |
| [#6634](https://github.com/posit-dev/positron/issues/6634) | Certain prompts do not display correctly in the co... | Resolved general focus issue |

### Click/Scroll Focus Behavior (5 fixes)

| # | Title | Fixed Behavior |
|---|-------|----------------|
| [#7522](https://github.com/posit-dev/positron/issues/7522) | Creating a Console doesn't raise or focus the Cons... | Resolved click/scroll focus behavior |
| [#6881](https://github.com/posit-dev/positron/issues/6881) | multisession console: cannot restart session after... | Resolved click/scroll focus behavior |
| [#6845](https://github.com/posit-dev/positron/issues/6845) | console: input prompt truncated on startup | Resolved click/scroll focus behavior |
| [#6585](https://github.com/posit-dev/positron/issues/6585) | The Console shows a text cursor when it shouldn't | Resolved click/scroll focus behavior |
| [#6347](https://github.com/posit-dev/positron/issues/6347) | E2E Test: Console session tab list | Resolved click/scroll focus behavior |

### Unexpected Focus Change (4 fixes)

| # | Title | Fixed Behavior |
|---|-------|----------------|
| [#8303](https://github.com/posit-dev/positron/issues/8303) | Can't close console that has failed to start | Resolved unexpected focus change |
| [#7619](https://github.com/posit-dev/positron/issues/7619) | history search in console by Ctrl-R acts weird wit... | Resolved unexpected focus change |
| [#6795](https://github.com/posit-dev/positron/issues/6795) | Multi-Console: Starting a new session of the proje... | Resolved unexpected focus change |
| [#6389](https://github.com/posit-dev/positron/issues/6389) | Console Multisessions: Metadata menu does not disa... | Resolved unexpected focus change |

### Terminal Consistency (1 fixes)

| # | Title | Fixed Behavior |
|---|-------|----------------|
| [#8507](https://github.com/posit-dev/positron/issues/8507) | Unwanted `Cmd click to launch VS Code Native REPL`... | Resolved terminal consistency |

## Guaranteed Focus Behaviors (Established Requirements)

Based on closed issues, these focus behaviors are **now guaranteed** by the Console:

### Click/Scroll Focus Behavior

- Console now guarantees creating a console doesn't raise or focus the console tab (Fixed in #7522)
- Console now guarantees multisession console: cannot restart session after force-quit (Fixed in #6881)
- Console now guarantees console: input prompt truncated on startup (Fixed in #6845)
- Console now guarantees the console shows a text cursor when it shouldn't (Fixed in #6585)
- Console now guarantees e2e test: console session tab list (Fixed in #6347)

### General Focus Issue

- Console now guarantees keep "cmd click to launch vs code native repl" from appearing in the python console (Fixed in #10713)
- Console now guarantees wrong json typing for console.fontligatures (Fixed in #10593)
- Console now guarantees running python module imports from subdirectories interactively (Fixed in #10045)
- Console now guarantees multisessions: cannot read properties of null (reading 'offsetparent') (Fixed in #7693)
- Console now guarantees `demo(graphics)` is not interactive the first time around (Fixed in #7681)
- Console now guarantees certain prompts do not display correctly in the console (Fixed in #6634)

### Interaction Rules

- Console now guarantees right click on output shows right click options for a notebook cell (Fixed in #10518)
- Console now guarantees ctrl+enter fails to execute r code with dplyr pipe and multi-line code blocks (Fixed in #10376)
- Console now guarantees can't interrupt selection/activity prompts on windows (Fixed in #10158)
- Console now guarantees copying text from console with context menu adds `nbsp` instead of spaces (Fixed in #10058)
- Console now guarantees multisessions: with exited sessions the `+` session menu is missing active session (Fixed in #7884)
- Console now guarantees console multisessions: new session created when user clicks on disconnected session (Fixed in #7005)
- Console now guarantees console multisessions: keyboard accessibility / mouse control issues (Fixed in #6451)

### Terminal Consistency

- Console now guarantees unwanted `cmd click to launch vs code native repl` in python console startup (Fixed in #8507)

### Unexpected Focus Change

- Console now guarantees can't close console that has failed to start (Fixed in #8303)
- Console now guarantees history search in console by ctrl-r acts weird with the letter "p" (Fixed in #7619)
- Console now guarantees multi-console: starting a new session of the project's selected interpreter is awkward (Fixed in #6795)
- Console now guarantees console multisessions: metadata menu does not disappear after clicking to view output channel (Fixed in #6389)

---

# PART 3: Console Focus Model Specification

## State Transition Model

Based on analysis of both open and closed issues, the Console Focus Model should support these state transitions:

### Core States

1. **Input Ready** — Console prompt is focused and ready for user input
2. **Executing** — Code is running, prompt may show activity indicator
3. **Scrollback Mode** — User is scrolling/selecting in output history
4. **Unfocused** — Console pane does not have focus

### Expected Transitions

```
                    ┌─────────────┐
         ┌─────────►│ Input Ready │◄──────────┐
         │          └──────┬──────┘           │
         │                 │                  │
         │                 │ Submit code      │
         │                 ▼                  │
         │          ┌──────────┐              │
         │          │Executing │              │ Complete/
         │          └────┬─────┘              │ Restore
         │               │                    │
         │               │ Complete           │
         │               ▼                    │
    Escape/         ┌────────────┐            │
    Click prompt    │ Scrollback │────────────┘
         │          │    Mode    │
         └──────────┤            │
                    └────┬───────┘
                         │
                         │ Lose focus
                         ▼
                    ┌───────────┐
                    │ Unfocused │
                    └───────────┘
```

### Interaction Rules

#### Rule 1: Click Behavior

**Status:** 5 behaviors established, 11 broken

**Expected Behavior:**
- Clicking in scrollback/output → should NOT automatically refocus prompt
- Clicking on prompt → should focus prompt for input
- Clicking console pane header → should focus the pane
- Double-click in output → should select word, maintain focus

**Current Issues:**
- #10972: LSP in the console: let language servers statically analyze console history
- #9530: Output from later/promises doesn't get matched to correct console input
- #9500: "Ctrl+n" keybinding does not work in the R console
- #8738: Cannot scroll within multiline statements in R Console
- #8687: Console input prompt does not focus when an activity input prompt ends

#### Rule 2: Scroll Behavior

**Status:** 0 behaviors established, 4 broken

**Expected Behavior:**
- Scrolling with mouse wheel → should NOT steal focus from other panes
- Scrolling should enter Scrollback Mode
- New output arriving → should NOT auto-scroll if user is in Scrollback Mode
- Focus should remain on prompt unless user explicitly clicks in scrollback

**Current Issues:**
- #8471: Console: Pasting can jitter the console preventing it from auto scrolling
- #5581: Console: Sticky Scroll; show command for context while viewing its output
- #4585: Console: Pasting a very long chunk of code into the console breaks scroll
- #4445: R: Console doesn't scroll down to input line when focused

#### Rule 3: Prompt Lifecycle

**Status:** 0 behaviors established, 6 broken

**Expected Behavior:**
- After code execution completes → prompt should regain focus
- Activity prompts (confirmations) → should automatically focus input
- Interrupt/restart → should restore focus to prompt
- Error output → should NOT prevent focus restoration

**Current Issues:**
- #10411: Console: Poor/no feedback when kernel is unreachable
- #8201: Can't correctly paste into Python `input()` or R `menu()` prompt in the console on Windows
- #7575: Epic: Assistant: Support Inline Chat for Console
- #6895: Console Restore: Continuation prompts not restored
- #5710: Windows: `Ctrl + C` is unreliable to interrupt a `readline()`

#### Rule 4: Focus Restoration

**Status:** 0 behaviors established, 2 broken

**Expected Behavior:**
- Switching back to Positron window → Console should restore focus if it had it
- Opening/closing other panes → should NOT steal Console focus
- Workspace reload → should restore previous focus state
- Tab switching → should maintain focus context

**Current Issues:**
- #6896: Console Restore: Possibility for dropped output
- #6895: Console Restore: Continuation prompts not restored

#### Rule 5: Unexpected Focus Changes

**Status:** 4 behaviors fixed, 5 broken

**Expected Behavior:**
- Console should NEVER steal focus unprompted
- Output rendering should NOT cause focus changes
- Background operations should NOT affect focus
- Console focus should be stable during typing

**Current Issues:**
- #10929: Console: Return of the Dancing Consoles (flipping between R/Python at boot)
- #10016: Python console intermittently fails to restart properly (restart button on console action bar)
- #6896: Console Restore: Possibility for dropped output
- #5898: Console: should Esc cancel a continuation prompt?
- #4447: Cancel multiline input with `Esc` at console

#### Rule 6: VS Code Terminal Consistency

**Status:** 1 behaviors aligned, 1 inconsistencies

**Expected Behavior:**
- Console focus behavior should match VS Code integrated terminal
- Keyboard shortcuts should behave consistently
- Click-to-focus rules should align with terminal
- Focus indicators should be consistent

**Current Issues:**
- #8173: Cmd + click on link in Console asks about an external URI opener

---

# PART 4: Gap Analysis and Priorities

## Focus Maturity by Category

| Focus Type | Closed (Fixed) | Open (Broken) | Maturity |
|------------|----------------|---------------|----------|
| Click/Scroll Focus Behavior | 5 | 11 | 🔴 Volatile |
| General Focus Issue | 6 | 4 | 🟡 Improving |
| Interaction Rules | 7 | 16 | 🔴 Volatile |
| Prompt Lifecycle Focus | 0 | 6 | ⚠️ Emerging |
| Terminal Consistency | 1 | 1 | 🔴 Volatile |
| Unexpected Focus Change | 4 | 5 | 🔴 Volatile |

## Priority Rankings

Based on severity and frequency, these are the priority focus areas:

### Priority 1: Interaction Rules

**Urgency Score:** 21
**Issue Count:** 16 (0 critical, 1 high)

**Top Issues:**
- **[Low]** #9449: Slow startup (time to interactive R console)
- **[Medium]** #11478: Console: Mechanism to select start folder in multi-root workspace
- **[Medium]** #11411: console: double-clicking text should select it, not jump to the bottom

**Recommended Action:**
- Codify interaction rules in design doc
- Implement consistent selection/copy behavior
- Align with VS Code terminal patterns

---

### Priority 2: Click/Scroll Focus Behavior

**Urgency Score:** 21
**Issue Count:** 11 (0 critical, 2 high)

**Top Issues:**
- **[Medium]** #10972: LSP in the console: let language servers statically analyze console history
- **[Medium]** #9530: Output from later/promises doesn't get matched to correct console input
- **[Medium]** #9500: "Ctrl+n" keybinding does not work in the R console

**Recommended Action:**
- Audit event handlers for click/scroll in console output area
- Define clear state machine for scrollback vs input mode
- Add comprehensive click interaction tests

---

### Priority 3: Prompt Lifecycle Focus

**Urgency Score:** 6
**Issue Count:** 6 (0 critical, 0 high)

**Top Issues:**
- **[Low]** #5710: Windows: `Ctrl + C` is unreliable to interrupt a `readline()`
- **[Medium]** #10411: Console: Poor/no feedback when kernel is unreachable
- **[Medium]** #8201: Can't correctly paste into Python `input()` or R `menu()` prompt in the console on Windows

**Recommended Action:**
- Review prompt lifecycle state transitions
- Ensure focus restoration after all code execution paths
- Test activity prompt focus behavior

---

### Priority 4: Unexpected Focus Change

**Urgency Score:** 5
**Issue Count:** 5 (0 critical, 0 high)

**Top Issues:**
- **[Low]** #10016: Python console intermittently fails to restart properly (restart button on console action bar)
- **[Low]** #4447: Cancel multiline input with `Esc` at console
- **[Medium]** #10929: Console: Return of the Dancing Consoles (flipping between R/Python at boot)

**Recommended Action:**
- Identify and eliminate all unsolicited focus changes
- Add focus change logging for debugging
- Review output rendering pipeline for focus side effects

---

### Priority 5: General Focus Issue

**Urgency Score:** 4
**Issue Count:** 4 (0 critical, 0 high)

**Top Issues:**
- **[Medium]** #8690: Cannot clear line when in pdb
- **[Medium]** #7903: Absent action/behavior for 'Show Active Interpreter Session Profile Report' (workbench.action.languageRuntime.showProfile)
- **[Medium]** #5840: Python: Improve the discovery of the %view magic use in the Console to view Data Frames

**Recommended Action:**
- Investigate and fix reported focus issues
- Add test coverage for focus scenarios
- Document expected behavior

---

### Priority 6: Terminal Consistency

**Urgency Score:** 1
**Issue Count:** 1 (0 critical, 0 high)

**Top Issues:**
- **[Medium]** #8173: Cmd + click on link in Console asks about an external URI opener

**Recommended Action:**
- Audit differences from VS Code terminal
- Align keyboard shortcuts and behaviors
- Document intentional deviations

---

# Conclusion

## Summary

**Analysis Coverage:**
- Total issues reviewed: 200
- Focus-related issues: 66
- Current broken behaviors: 43
- Established behaviors: 23

## Key Findings

1. **Highest Priority:** Interaction Rules with 16 open issues
3. **Most Volatile Areas:** Click/Scroll Focus Behavior, Interaction Rules, Terminal Consistency, Unexpected Focus Change

## Next Steps

1. **Immediate:** Address all Critical and High severity focus issues
2. **Short-term:** Implement and test the Console Focus Model state machine
3. **Medium-term:** Achieve parity with VS Code terminal focus behavior
4. **Long-term:** Eliminate all focus-related regressions through comprehensive testing

---

*This specification is grounded in GitHub issue evidence and provides a requirements-level*
*foundation for Console Focus Management in Positron IDE.*
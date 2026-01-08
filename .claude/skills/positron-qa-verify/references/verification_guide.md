# Verification Guide Reference

This document provides guidance for generating effective QA verification guides from GitHub issues and PRs.

## Core Principles

1. **Be actionable** - Every scenario should be testable
2. **Be specific** - No vague instructions like "test the feature"
3. **Be complete** - Cover the main scenario, edge cases, and regressions
4. **Be concise** - Respect the tester's time, no fluff

## Guide Structure

### 1. Issue Summary

**Purpose:** Give the tester immediate context about what they're verifying.

**Should include:**
- What was broken or missing
- How it affects users
- Which component/area is involved

**Good example:**
```
The Data Explorer's scrollbars would snap back to position 0 when dragging on Safari.
This made it impossible to navigate large dataframes on Safari, forcing users to use
keyboard navigation or switch browsers. Affects the Data Explorer component.
```

**Bad example:**
```
There was a bug in the Data Explorer that needed to be fixed.
```

### 2. Root Cause (Optional)

**When to include:**
- PR explicitly states the cause
- Small PR diff makes it obvious
- Understanding the cause helps identify test scenarios

**When to skip:**
- Large refactors where cause is complex
- PR doesn't clearly explain it
- Not relevant to testing approach

**Good example:**
```
The virtual scrolling logic was using the wrong event handler for Safari's
scroll events, causing position to reset on each drag.
```

**Bad example:**
```
The code was wrong and now it's fixed.
```

### 3. Test Scenarios

This is the most important section. Break down into subsections:

#### Primary Scenario

The main reproduction steps from the issue. Always test this first.

**Format:**
```markdown
### Primary Scenario

[Step-by-step reproduction from the issue]

**Expected:** [What should happen now]
**Previously:** [What was broken before the fix]
```

**Example:**
```markdown
### Primary Scenario

1. Open Positron on Safari
2. Create a large dataframe: `df = pd.DataFrame({'col': range(10000)})`
3. View in Data Explorer
4. Drag the scrollbar down to row 5000
5. Release the scrollbar

**Expected:** Scrollbar stays at position, showing rows around 5000
**Previously:** Scrollbar snapped back to 0, showing first rows
```

#### Edge Cases

Additional scenarios from:
- Comments on the issue
- PR review comments
- Code analysis (for small PRs)
- Your inference based on the fix

**Format:**
```markdown
### Edge Cases

#### [Scenario name]
[Steps]

**Why test:** [Brief explanation of what this verifies]
```

**Example:**
```markdown
### Edge Cases

#### Horizontal scrollbar
1. Create wide dataframe: `df = pd.DataFrame({f'col{i}': range(100) for i in range(50)})`
2. View in Data Explorer
3. Drag horizontal scrollbar
4. Release

**Why test:** Ensures fix works for both scroll directions

#### Rapid scrolling
1. Open large dataframe in Data Explorer
2. Rapidly drag scrollbar up and down multiple times
3. Release at various positions

**Why test:** Stress tests the event handler under rapid input
```

#### Regression Checks

Things to verify still work that might have been affected by the fix.

**Format:**
```markdown
### Regression Checks

- [ ] [What to verify]
- [ ] [Another thing to verify]
```

**Example:**
```markdown
### Regression Checks

- [ ] Scrollbar works normally on Chrome and Firefox
- [ ] Keyboard navigation (arrow keys) still works
- [ ] Mouse wheel scrolling still works
- [ ] Scrollbar position persists when switching between tabs
```

### 4. Testing Context

**Environment requirements:**
- Specific OS/browser if issue is platform-specific
- Language version (Python/R) if relevant
- Required packages or extensions
- Positron version if specified

**Setup steps:**
- Any required configuration
- Files to create
- Extensions to enable

**Example:**
```markdown
## Testing Context

**Environment:**
- Safari browser (any version)
- Any OS with Safari support (macOS, iOS)
- Python or R (issue affects both)

**Setup:**
No special setup required. Any dataframe with >100 rows will work.

**Related PRs:**
- #8931 - Adds tests for Safari scrolling behavior
```

### 5. References

Always include:
- Link to original issue
- Link to PR(s)
- Links to related issues mentioned

**Format:**
```markdown
## References

- Issue: https://github.com/posit-dev/positron/issues/8930
- PR: https://github.com/posit-dev/positron/pull/8931
- Related: #7234 (Chrome scrolling issue)
```

## Writing Tips

### Extracting Test Scenarios from Comments

Comments often contain gold:

**Look for patterns like:**
- "Also happens when..."
- "Same issue with..."
- "We should also test..."
- "Edge case: ..."
- "What about...?"

**Example comment:**
```
"Also happens when you use the horizontal scrollbar. And if you scroll quickly
multiple times it gets worse."
```

**Extracted scenarios:**
- Test horizontal scrollbar (in addition to vertical)
- Test rapid repeated scrolling

### Extracting from PR Descriptions

**Look for:**
- "This also fixes..." (additional scenarios)
- "Changes include..." (areas to test)
- "Note that..." (edge cases or limitations)
- Testing notes or QA sections

**Example PR description:**
```
Fixes the scrollbar snap issue on Safari by updating the event handler.

This also improves scrolling performance on all browsers.

Note: This doesn't affect the fixed-position headers, which use a different
scrolling mechanism.
```

**Extracted info:**
- Primary: Safari scrollbar fix
- Bonus: Performance improvement to verify on all browsers
- Regression: Check that headers still work

### Code Analysis Tips (for small PRs)

When reviewing diffs for small PRs:

**Look for:**
- Which files changed (indicates affected areas)
- Test files added/modified (what did developers test?)
- Configuration changes (environment implications)
- Multiple functions touched (broader impact)

**Example diff insights:**
```
Files changed:
- src/vs/workbench/contrib/dataExplorer/browser/virtualScroll.ts
- src/vs/workbench/contrib/dataExplorer/test/virtualScroll.test.ts

Insight: Changes are isolated to virtual scrolling component.
         Tests were added for the specific scenario.
         Should focus testing on scrolling, not broader Data Explorer features.
```

## Common Pitfalls to Avoid

### ❌ Vague Scenarios

**Bad:**
```
Test that the Data Explorer works correctly
```

**Good:**
```
1. Open dataframe with 10,000 rows
2. Scroll to row 5,000
3. Verify position holds and no snap-back occurs
```

### ❌ Missing Context

**Bad:**
```
Verify the scrollbar fix
```

**Good:**
```
**Environment:** Safari browser on macOS
**Expected:** Scrollbar stays in position after dragging
**Previously:** Scrollbar snapped back to 0
```

### ❌ Too Many Assumptions

**Bad:**
```
Test the obvious scrolling scenarios
```

**Good:**
```
### Test Scenarios
1. Vertical scrollbar drag
2. Horizontal scrollbar drag
3. Rapid scrolling
4. Scroll then switch tabs
```

### ❌ Ignoring Comments

**Don't just use the issue body** - comments often contain:
- Additional reproduction steps
- Edge cases discovered during debugging
- Platform-specific notes
- Related issues

Always read all comments before generating scenarios.

### ❌ Overcomplicated Root Cause

**Bad:**
```
The issue was caused by a race condition in the virtual DOM reconciliation
algorithm when Safari's scroll event coalescing triggered a re-render before
the state had propagated through the React fiber tree...
```

**Good:**
```
Safari's scroll events were handled differently, causing position to reset.
```

Or just skip it if too complex.

## Examples

### Example 1: Simple Bug Fix

**Issue:** Console crashes when printing None in Python

**Good verification guide:**
```markdown
# Verification Guide: Console crashes when printing None in Python

**Issue:** #4567
**PR:** #4589
**Component:** Console

---

## Issue Summary

Printing `None` in the Python console causes Positron to crash. This affects
any code that prints None values, making the console unusable for common
debugging workflows.

## Root Cause

The console's output renderer didn't handle None values, attempting to call
.toString() on undefined.

## Test Scenarios

### Primary Scenario

1. Open Positron with Python
2. In the console, type: `print(None)`
3. Press Enter

**Expected:** Console prints "None" and remains functional
**Previously:** Positron crashed

### Edge Cases

#### None in variables
```python
x = None
print(x)
```

#### None in lists
```python
items = [1, None, 3]
print(items)
```

#### Multiple None values
```python
print(None, None, None)
```

### Regression Checks

- [ ] Printing other falsy values works (0, False, "", [])
- [ ] Printing normal values still works
- [ ] Console error handling works for real errors

## Testing Context

**Environment:**
- Python 3.x (any version)
- No special setup required

## References

- Issue: https://github.com/posit-dev/positron/issues/4567
- PR: https://github.com/posit-dev/positron/pull/4589
```

### Example 2: Feature with Multiple Scenarios

**Issue:** Add keyboard shortcut for running selected code

**Good verification guide:**
```markdown
# Verification Guide: Add keyboard shortcut for running selected code

**Issue:** #3456
**PR:** #3478
**Component:** Editor

---

## Issue Summary

Users can now run selected code using Cmd+Enter (Ctrl+Enter on Windows/Linux).
Previously, running selected code required right-clicking or using the Run menu.
This makes running code snippets much faster.

## Test Scenarios

### Primary Scenario

1. Open a Python or R file
2. Select a few lines of code
3. Press Cmd+Enter (or Ctrl+Enter)

**Expected:** Selected code runs in the console
**Previously:** Shortcut was not available

### Edge Cases

#### Single line selection
1. Click in a line (cursor only, no selection)
2. Press Cmd+Enter

**Expected:** Current line runs

#### Multiple selections (from PR comments)
1. Make multiple selections (Cmd+click)
2. Press Cmd+Enter

**Expected:** All selections run in order

#### Partial line selection
1. Select part of a line (e.g., just the function name)
2. Press Cmd+Enter

**Expected:** Only selected text runs

#### No active console (from PR review)
1. Close all console sessions
2. Select code and press Cmd+Enter

**Expected:** New console starts and code runs

### Regression Checks

- [ ] Run menu still works
- [ ] Right-click context menu still works
- [ ] Cmd+Enter behavior in console REPL unchanged (runs current command)
- [ ] Other keyboard shortcuts still work

## Testing Context

**Environment:**
- Python or R file editor
- Both Python and R should be tested

**Related PRs:**
- #3479 - Adds the same shortcut for notebooks

## References

- Issue: https://github.com/posit-dev/positron/issues/3456
- PR: https://github.com/posit-dev/positron/pull/3478
- Related: #3479 (notebooks implementation)
```

## Checklist for Complete Guides

Before finalizing a verification guide, ensure:

- [ ] Issue summary clearly explains the problem and impact
- [ ] Primary scenario includes exact repro steps
- [ ] Edge cases are specific and testable
- [ ] Regression checks cover related functionality
- [ ] Environment requirements are listed
- [ ] All comments from issue have been reviewed
- [ ] PR description has been analyzed
- [ ] Related issues are referenced
- [ ] Each scenario has clear expected vs actual behavior
- [ ] No vague instructions like "test it works"
- [ ] Root cause included only if helpful for testing
- [ ] Links to issue, PR, and related issues are present

## Success Metrics

A good verification guide should enable a QA tester to:
1. Understand what was broken and why it matters (< 30 seconds)
2. Execute the primary test scenario (< 5 minutes)
3. Identify and test edge cases (< 15 minutes)
4. Verify no regressions occurred (< 10 minutes)

Total time investment: ~30 minutes to generate a thorough verification guide that saves hours of back-and-forth clarification.

## Verification Comment Templates

After completing manual verification, QA testers typically post a standardized comment on the issue to confirm the fix. The skill can help generate this comment template.

### Standard Format

For single scenario tests (only 1 test total, no edge cases or regressions), use a simple format:

```markdown
### Verified Fixed
Positron Version(s): [version]
OS Version(s): [OS]

### Test scenario(s)
- [Single scenario description]

### Link(s) to test cases run or created:
[links or paths to e2e tests, or n/a]
```

For everything else (2+ scenarios, or has edge cases/regressions), use grouped format for better readability:

```markdown
### Verified Fixed
Positron Version(s): [version]
OS Version(s): [OS]

### Test scenario(s)

**Primary scenario:**
- [Main test scenario]

**Edge cases:**
- [Edge case 1]
- [Edge case 2]
- [Edge case 3]

**Regression checks:**
- [Regression 1]
- [Regression 2]

### Link(s) to test cases run or created:
[links or paths to e2e tests, or n/a]
```

**Important distinction:**
- **Verification guide** (`.md` file for testing): Uses checkboxes `- [ ]` so QA can track progress
- **Verification comment** (posted to GitHub): Uses plain bullets `-` for the final report

### Generating the Template

The skill should:
1. Extract test scenarios from the verification guide
2. **Use grouped format by default** unless there's only 1 scenario total
3. Condense verbose scenario descriptions into concise bullets
4. **Auto-detect Positron version** from installed application
5. **Auto-detect OS version** from the system
6. Pre-fill with "n/a" for test case links unless e2e tests were mentioned

**Format decision rule:**
- Only 1 scenario (no edge cases, no regressions) → Simple format
- Everything else → Grouped format

**Positron Version Detection:**
- Look for `product.json` in standard installation paths
- Extract `positronVersion` and `positronBuildNumber` fields
- Format as: `{version} build {buildNumber}` (e.g., "2026.02.0 build 10")
- If detection fails, leave blank for manual entry

**OS Version Detection:**
- macOS: Use `sw_vers -productVersion` (e.g., "macOS 14.5")
- Linux: Parse `/etc/os-release` for distribution name and version
- Windows: Use `ver` command output
- Fallback: Use `uname` output if above methods fail

### Example 1: Single Scenario (Simple Format)

For issue #2345 (Fix typo in help text):

```markdown
### Verified Fixed
Positron Version(s): 2026.01.0 build 123
OS Version(s): macOS 14.5

### Test scenario(s)
- Verify typo is corrected in Help pane

### Link(s) to test cases run or created:
n/a
```

Note: This uses simple format because there's truly only one thing to test. Most issues will have edge cases or regressions and should use grouped format.

### Example 2: Longer Bug Fix (Grouped Format)

For issue #4567 (Console crashes when printing None):

```markdown
### Verified Fixed
Positron Version(s): 2026.01.0 build 123
OS Version(s): macOS 14.5

### Test scenario(s)

**Primary scenario:**
- Print None directly in console

**Edge cases:**
- Print None stored in variable
- Print None in lists
- Print multiple None values

**Regression checks:**
- Other falsy values still work (0, False, "", [])
- Normal printing still works
- Console error handling works for real errors

### Link(s) to test cases run or created:
n/a
```

### Example 3: Feature with Platform Testing (Grouped Format)

For issue #3456 (Keyboard shortcut for running code):

```markdown
### Verified Fixed
Positron Version(s): 2026.01.0 build 123
OS Version(s): macOS 14.5, Windows 11

### Test scenario(s)

**Primary scenario:**
- Run selected code with Cmd/Ctrl+Enter in Python and R files

**Edge cases:**
- Run single line with cursor only (no selection)
- Run multiple selections
- Run partial line selection
- Run code when no console is active (creates new console)

**Regression checks:**
- Run menu still works
- Right-click context menu still works
- Cmd+Enter in console REPL unchanged

### Link(s) to test cases run or created:
n/a
```

### Example 4: With E2E Tests (Grouped Format)

For issue #8930 (Safari scrollbar fix):

```markdown
### Verified Fixed
Positron Version(s): 2026.01.0 build 123
OS Version(s): macOS 14.5 (Safari 17.2)

### Test scenario(s)

**Primary scenario:**
- Drag vertical scrollbar in Data Explorer on Safari, verify no snap-back to position 0

**Edge cases:**
- Drag horizontal scrollbar
- Rapid scrolling multiple times
- Scroll then switch tabs and return

**Regression checks:**
- Scrollbar works on Chrome and Firefox
- Keyboard navigation still works
- Mouse wheel scrolling still works

### Link(s) to test cases run or created:
test/e2e/tests/data-explorer/scrolling.test.ts
```

### Tips for Generating Comments

**Choose the right format:**
- **Default to grouped format** - it's clearer and more scannable
- Only use simple format for truly single-scenario tests (no edge cases, no regressions)
- Group by: Primary scenario → Edge cases → Regression checks

**Extract scenarios systematically:**
- Start with primary scenario (the main test from the issue)
- Add each edge case as a bullet under "Edge cases"
- Include regression checks as bullets under "Regression checks"
- Combine very similar scenarios into one bullet

**Format consistently:**
- Use action verbs ("Verify", "Test", "Check")
- Keep bullets concise but specific
- Each bullet should be one clear test action
- For edge cases: Place "Why test:" explanation immediately after the title, before the steps

**Handle version/OS fields:**
- **Positron Version(s)**: Auto-detect from installed application using `product.json` file
  - macOS: `/Applications/Positron.app/Contents/Resources/app/product.json`
  - Linux: Common paths like `/usr/share/positron/resources/app/product.json` or `~/.local/share/positron/`
  - Windows: `C:\Program Files\Positron\resources\app\product.json`
  - Format: `{positronVersion} build {positronBuildNumber}` (e.g., "2026.02.0 build 10")
- **OS Version(s)**: Auto-detect from system using `sw_vers` (macOS), `/etc/os-release` (Linux), or `ver` (Windows)
- User can adjust values if testing on multiple systems or if auto-detection fails
- For multi-platform testing, user can add additional versions (comma-separated)

**Test case links:**
- Default to "n/a" unless e2e tests mentioned in PR
- If PR added/modified test files, include those paths
- If tester created new e2e tests, they'll fill this in

### Anti-Patterns

**Don't:**
- Include setup steps in scenarios (those aren't test scenarios)
- List expected/actual behavior (comment format is just scenario list)
- Include references or links (those are in the issue already)
- Add QA notes or explanations (just the scenario bullets)

**Example of what NOT to do:**

```markdown
### Test scenario(s)
- Setup: Create two environments, one with pandas and one without
- Expected: Diagnostics should toggle
- See issue #6936 for more details
- This was fixed in Pyrefly 0.45.0
```

**Correct version (grouped format):**

```markdown
### Test scenario(s)

**Primary scenario:**
- Switch between sessions with/without pandas, verify diagnostics toggle

**Edge cases:**
- Rapid switching between multiple sessions
- Different import patterns (full, specific, aliased)
- Semantic highlighting also updates
```

### Workflow Integration

After generating the verification guide:

1. User performs manual testing following the guide
2. User asks for verification comment
3. Skill generates comment template with **auto-detected Positron and OS versions** and **copies it to clipboard**
4. User pastes into GitHub issue comment box (versions already filled in!)
5. User adjusts versions if testing was done on multiple systems
6. User adds e2e test links if applicable (usually pre-filled with "n/a" or detected test paths)
7. User posts comment and updates issue status

This completes the QA verification workflow.

**Note:** Testing notes (like "pay attention to X") should be included in the verification guide for manual testing, but should NOT be included in the verification comment template.

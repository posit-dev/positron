---
name: positron-qa-verify
description: Generates clear, actionable verification guides for QA testing of Positron bug fixes and features
---

# Positron QA Verify

This skill analyzes GitHub issues and their associated PRs to generate comprehensive verification guides for manual QA testing. It extracts the essential information from issues, comments, linked PRs, and code changes to produce clear test scenarios.

## When to Use This Skill

Use this skill when:
- You're assigned a ticket from the QA verification board (https://github.com/orgs/posit-dev/projects/2/views/8)
- You need to understand what to test for a specific bug fix or feature
- You want to extract test scenarios from an issue and its related PRs
- You need to identify all edge cases and related scenarios mentioned in comments

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- Working in the Positron repository
- Access to the posit-dev/positron repository

## Execution Mode

**CRITICAL: This skill MUST run non-interactively without ANY prompts.**

- **NEVER use `AskUserQuestion`** - The skill always writes to a safe output directory (`.claude/skills/positron-qa-verify/output/`)
- **Version auto-detection is best-effort** - If it fails, silently use empty values. The user can fill them in manually.
- **All operations must complete quickly** - Fail fast if data cannot be retrieved within reasonable timeouts
- **No permission requests** - Reading issue data, writing markdown files, and running version detection do not require special permissions

**Performance requirements:**
- Version detection must complete in ≤4 seconds total (enforced by script timeouts)
- If version detection times out or fails, continue without error messages
- Never attempt interactive detection methods (no manual path prompts, no user input)

**Windows compatibility:**
- The `detect_versions.sh` script handles Windows paths via Git Bash/MSYS/PowerShell
- Falls back gracefully if Positron installation path cannot be found
- Uses multiple detection methods to maximize success rate across platforms

## Input

Provide an issue number or URL. Examples:
- `4567`
- `#4567`
- `https://github.com/posit-dev/positron/issues/4567`

## Workflow

I'll analyze the issue and generate a verification guide following these steps:

### Performance Optimization Strategy

**CRITICAL: Use parallel execution wherever possible to minimize latency.**

- **Step 1 & 2 run in parallel** - Issue details and PR search are independent
- **Step 3 fetches run in parallel** - Related PRs/issues are fetched concurrently
- **Step 4 checks size first** - Only fetch diff for small PRs (<500 lines)

Total time savings: ~40-50% faster than sequential execution (5-8s vs 10-15s typical)

### Step 1: Fetch Issue Details (Parallel with Step 2)

**MUST RUN IN PARALLEL** with Step 2 using a single message with multiple Bash tool calls.

Using `gh issue view`, I'll retrieve:
- Issue title and description
- Reporter's repro steps
- All comments (which often contain additional test scenarios)
- Labels and metadata
- Linked issues

### Step 2: Identify Related PR(s) (Parallel with Step 1)

**MUST RUN IN PARALLEL** with Step 1 using a single message with multiple Bash tool calls.

I'll automatically detect the PR that fixes this issue by:
1. Looking for PR references in issue comments (e.g., "Fixed in #1234")
2. Checking for timeline events linking PRs
3. Using `gh pr list` with issue filter if needed

If multiple PRs are found, I'll analyze all of them.

### Step 3: Analyze PR Context

**OPTIMIZATION:** Fetch primary PR details first, then fetch all related PRs/issues in parallel.

For the primary PR, I'll fetch:
- PR description and summary
- All PR comments (often contain testing notes)
- **Additions and deletions counts** (needed for Step 4 size check)
- Related PRs/issues mentioned in the body

Then, for all related PRs/issues referenced, I'll fetch them **in parallel using multiple Bash tool calls in a single message**.

### Step 4: Review Code Changes (Conditionally)

**OPTIMIZATION:** Check PR size from Step 3 data (additions + deletions) BEFORE fetching diff.

**For small PRs (< 500 lines changed):**
- I'll use `gh pr diff` to review actual code changes
- This helps identify:
  - Edge cases to test
  - Related functionality that might be affected
  - Whether the fix is focused or touches multiple areas

**For large PRs (>= 500 lines):**
- I'll skip detailed code review (don't fetch diff at all)
- Focus on PR description and comments instead
- Saves 1-5 seconds by avoiding large diff download

### Step 5: Extract Linked Issues and Scenarios

I'll search comments for:
- References to other issues (`#1234`)
- Additional test scenarios mentioned by team members
- Edge cases discovered during PR review
- Platform-specific considerations (macOS, Windows, Linux)

### Step 6: Generate Verification Guide

I'll create a markdown file in `.claude/skills/positron-qa-verify/output/` with:

1. **Ticket Type** (Bug, Feature, Documentation, Maintenance)
   - Helps set testing expectations
   - Determines whether Root Cause section is included

2. **Issue Summary**
   - What changed or what was broken
   - User impact (why this matters)
   - Uses H4 subsections for readability

3. **Root Cause** (Bugs only)
   - What was causing the issue
   - Only included for bug fixes when clearly stated in PR
   - Helps understand what might break again

4. **Test Scenarios**
   - Scenario titles use checkmarks (✓) for visual organization
   - Test steps within scenarios use checkboxes (- [ ]) for tracking progress
   - Primary scenario (the main repro steps from the issue)
   - Edge cases (from comments, PR review, code analysis) with "Why test:" rationale
   - Regression checks (related functionality to verify still works)
   - Platform-specific scenarios if mentioned

5. **Testing Context**
   - Environment requirements (Python/R version, specific packages, etc.)
   - Setup steps (if any)
   - Expected vs actual behavior
   - Related PRs to be aware of

6. **References**
   - Link to original issue
   - Link to PR(s)
   - Links to related issues

### Step 7: Offer Verification Comment Template (User-Triggered)

After generating the guide, I'll offer to create a verification comment template. **Only if you accept** will I run the version detection script and generate the template.

**Workflow:**
1. Generate verification guide
2. Offer: "Would you like me to generate a verification comment template?"
3. If yes → Run `detect_versions.sh` to auto-detect versions
4. Generate template and copy to clipboard

For single scenario tests (only 1 test, no edge cases or regressions), I'll use a simple format:

```markdown
### Verified Fixed
Positron Version(s): [version]
OS Version(s): [OS]

### Test scenario(s)
- [Single scenario]

### Link(s) to test cases run or created:
[links or paths to e2e tests, or n/a]
```

For everything else (2+ scenarios, or any edge cases/regressions), I'll use a grouped format for better readability:

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

**Regression checks:**
- [Regression check 1]
- [Regression check 2]

### Link(s) to test cases run or created:
[links or paths to e2e tests, or n/a]
```

**Note:** The verification comment uses plain bullets. Checkmarks (✓) and checkboxes (- [ ]) are only in the verification guide for visual organization and progress tracking during testing.

The template will be pre-filled with:
- Test scenarios extracted and condensed from the verification guide
- Grouped format used by default for better readability (unless only 1 scenario)
- **Positron Version automatically detected** from installed application (using `scripts/detect_versions.sh`)
- **OS Version automatically detected** from your system (using `scripts/detect_versions.sh`)
- Ready to paste - you can adjust versions if you tested on multiple systems

**Version detection is best-effort and silent:**
- **Only runs when you request the comment template** (not during initial guide generation)
- Uses the `detect_versions.sh` script with 3-second timeouts per detection
- If detection fails, empty values are used (you can fill them in manually)
- Never prompts or shows errors - fails fast and silent

**The template will be automatically copied to your clipboard** (on macOS/Linux using `pbcopy`/`xclip`, on Windows using `clip`) when you accept the offer, making it easy to paste directly into the GitHub issue after you complete testing.

## Output Format

The verification guide is saved as a markdown file:

```
.claude/skills/positron-qa-verify/output/verify-issue-{number}-{timestamp}.md
```

Example filename: `verify-issue-4567-20260108-153045.md`

## Example Usage

```
User: /qa-verify 4567
```

I'll respond with:
1. A summary of what I found
2. Path to the generated verification guide
3. Key highlights (number of scenarios, any blockers, etc.)

## Implementation Examples

### Example 1: Parallel Execution of Steps 1 & 2

**Do this (FAST - ~2 seconds):**

Single message with multiple Bash tool calls running in parallel:
- `gh issue view <number>` fetches issue details
- `gh pr list --search "<number>"` searches for related PRs

**Saves ~1-2 seconds** compared to sequential execution.

### Example 2: Parallel Fetch of Related PRs/Issues

**Do this (FAST - ~2 seconds):**

After identifying related PRs/issues from PR body (e.g., #10625, #10753), fetch them all in parallel with a single message containing multiple Bash tool calls.

**Don't do this (SLOW - ~6 seconds):**

Sequential fetches of each related PR/issue one at a time.

**Saves ~2-4 seconds** depending on number of related items.

### Example 3: Check PR Size Before Fetching Diff

**Do this (FAST):**

1. Get PR with `--json additions,deletions` in Step 3
2. Calculate total: `additions + deletions`
3. Only fetch diff if `< 500 lines`

**Example:**
```bash
# Already have from Step 3:
# "additions": 9, "deletions": 3
# Total: 12 lines (< 500, so fetch diff)
gh pr diff 11251
```

**Don't do this (SLOW):**

Always fetch diff, then check size after.

**Saves ~1-5 seconds** on large PRs by avoiding unnecessary diff downloads.

## Helper Scripts

### `scripts/analyze_issue.sh`

This script orchestrates the data gathering:

```bash
# Usage:
./scripts/analyze_issue.sh <issue-number>
```

The script:
- Fetches issue and PR data using `gh` CLI
- Extracts linked issues from comments
- Calculates PR size to determine if code review is needed
- Outputs structured JSON for parsing

### `scripts/detect_versions.sh`

This script performs fast, silent version detection:

```bash
# Usage:
./scripts/detect_versions.sh

# With debug output:
DEBUG=1 ./scripts/detect_versions.sh
```

The script:
- Detects Positron version and build number from `product.json`
- Detects OS version using platform-specific commands
- Has 3-second timeout per detection (max 4 seconds total)
- **Never prompts or shows errors** - always outputs valid JSON
- Fails gracefully with empty values if detection fails

Output format:
```json
{
  "positronVersion": "2026.02.0",
  "positronBuild": "10",
  "osVersion": "macOS 26.2",
  "detectionStatus": "success"
}
```

Detection status values:
- `"success"` - Both Positron and OS versions detected
- `"partial"` - Only one version detected
- `"failed"` - No versions detected

## Verification Guide Template

The generated guides follow this structure:

```markdown
# Verification Guide
### [Issue Title]<br>
**Issue:** [#number](https://github.com/posit-dev/positron/issues/[number])<br>
**Type:** Bug | Feature | Documentation | Maintenance<br>
**Primary PR:** [#number](https://github.com/posit-dev/positron/pull/[number])<br>
**Component:** [area label]<br>
**Generated:** [timestamp]<br>

---

## Issue Summary

[2-3 sentences explaining the problem and user impact]

## Root Cause

[1-2 sentences if identifiable, otherwise "See PR for technical details"]

## Test Scenarios

### Primary Scenario

✓ **[Scenario title]**

**Setup:** (if needed)
- [ ] Setup step one
- [ ] Setup step two

**Test Steps:**
- [ ] Step one
- [ ] Step two

**Expected:** [What should happen]
**Previously:** [What was broken]

### Edge Cases

✓ **[Edge case scenario title]**

**_Why test:_** [Brief explanation]

- [ ] Step one
- [ ] Step two

### Regression Checks

- [ ] [What to verify]
- [ ] [Another thing to verify]

## Testing Context

**Environment:**
- Positron version: [if specified]
- OS: [if relevant]
- Language: Python/R [version if specified]

**Setup:**
[Any required setup steps]

**Related PRs:**
- [Links to related PRs with brief description]

## References

- Issue: [link]
- PR: [link]
- Related: [links to other issues]

---
*Generated by positron-qa-verify skill*
```

## Tips for Effective Verification

- **Start with the primary scenario** - Always test the exact repro steps from the issue first
- **Check edge cases** - Comments often reveal additional scenarios discovered during development
- **Test on relevant platforms** - If issue mentions "macOS only", prioritize that platform
- **Verify related functionality** - Small fixes sometimes have unintended side effects
- **Look for performance notes** - PRs sometimes mention performance implications

## Advanced Features

### Multiple PRs

If an issue has multiple related PRs (e.g., backend + frontend changes):
- I'll analyze all of them
- The guide will note which scenarios relate to which PR
- Testing order may be suggested if one depends on another

### Linked Issues

When comments reference other issues:
- I'll fetch those issue titles
- Include relevant context in the verification guide
- Help you understand if they should be tested together

### Code Analysis Insights

For small PRs where I review the code:
- I'll note if changes are isolated or touch multiple areas
- Highlight any test files modified (what the developers tested)
- Identify configuration changes that might affect behavior

## Limitations

- Cannot automatically execute tests (manual verification only)
- Code analysis is limited to small PRs to save time
- Relies on quality of issue description and PR comments
- May miss verbal discussions not captured in GitHub

## Integration with QA Workflow

This skill integrates with the typical QA verification workflow:

1. **Sign up for ticket** on the QA board
2. **Run `/qa-verify [issue-number]`** to generate guide
3. **Review the generated markdown** to understand what to test
4. **Perform manual verification** following the scenarios
5. **Update ticket status** based on results

The generated guides serve as:
- A checklist during testing
- Documentation of what was verified
- Reference for future related issues

## Success Criteria

A successful verification guide should:
- Clearly explain the issue and its impact
- Provide specific, actionable test scenarios
- Include relevant edge cases from comments/analysis
- List required environment/setup details
- Reference all related issues and PRs
- Be concise but complete (no fluff, all substance)

---

Remember: This skill generates the testing plan. You still need to execute the manual verification yourself!

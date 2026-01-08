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

## Input

Provide an issue number or URL. Examples:
- `4567`
- `#4567`
- `https://github.com/posit-dev/positron/issues/4567`

## Workflow

I'll analyze the issue and generate a verification guide following these steps:

### Step 1: Fetch Issue Details

Using `gh issue view`, I'll retrieve:
- Issue title and description
- Reporter's repro steps
- All comments (which often contain additional test scenarios)
- Labels and metadata
- Linked issues

### Step 2: Identify Related PR(s)

I'll automatically detect the PR that fixes this issue by:
1. Looking for PR references in issue comments (e.g., "Fixed in #1234")
2. Checking for timeline events linking PRs
3. Using `gh pr list` with issue filter if needed

If multiple PRs are found, I'll analyze all of them.

### Step 3: Analyze PR Context

For each PR, I'll fetch:
- PR description and summary
- All PR comments (often contain testing notes)
- Related PRs mentioned (e.g., in ark or other repos)

### Step 4: Review Code Changes (Conditionally)

**For small PRs (< 500 lines changed):**
- I'll use `gh pr diff` to review actual code changes
- This helps identify:
  - Edge cases to test
  - Related functionality that might be affected
  - Whether the fix is focused or touches multiple areas

**For large PRs (>= 500 lines):**
- I'll skip detailed code review
- Focus on PR description and comments instead

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
   - Checkboxes for each scenario with nested bullets (not numbered steps)
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

### Step 7: Offer Verification Comment Template (Optional)

After generating the guide, I'll ask if you want help creating a verification comment to post on the issue after testing.

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

**Note:** The verification comment uses plain bullets. Checkboxes are only in the verification guide for tracking during testing.

The template will be pre-filled with:
- Test scenarios extracted and condensed from the verification guide
- Grouped format used by default for better readability (unless only 1 scenario)
- **Positron Version automatically detected** from installed application
- **OS Version automatically detected** from your system
- Ready to paste - you can adjust versions if you tested on multiple systems

**The template will be automatically copied to your clipboard** (on macOS/Linux using `pbcopy`/`xclip`, on Windows using `clip`), making it easy to paste directly into the GitHub issue after you complete testing.

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

## Helper Script

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

## Verification Guide Template

The generated guides follow this structure:

```markdown
# Verification Guide: [Issue Title]

**Issue:** #[number]
**PR:** #[number]
**Component:** [area label]
**Generated:** [timestamp]

---

## Issue Summary

[2-3 sentences explaining the problem and user impact]

## Root Cause

[1-2 sentences if identifiable, otherwise "See PR for technical details"]

## Test Scenarios

### Primary Scenario
[Main repro steps from issue]

**Expected:** [What should happen]
**Previously:** [What was broken]

### Edge Cases
[Additional scenarios from comments/analysis]

### Regression Checks
[Related functionality to verify]

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

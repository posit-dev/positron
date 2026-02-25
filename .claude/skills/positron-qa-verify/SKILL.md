---
name: positron-qa-verify
description: Generates clear, actionable verification guides for QA testing of Positron bug fixes and features
---

# Positron QA Verify

Analyzes GitHub issues and PRs to generate verification guides for manual QA testing.

## When to Use

- Assigned a ticket from the QA verification board (https://github.com/orgs/posit-dev/projects/2/views/8)
- Need test scenarios for a bug fix or feature
- Want to extract edge cases from issue comments and PR discussions

## Prerequisites

- GitHub CLI (`gh`) authenticated
- Working in the Positron repository

## Execution Mode

**CRITICAL: Run non-interactively without prompts.**

- **Never use `AskUserQuestion`** - Always write to `.claude/skills/positron-qa-verify/output/`
- **Version detection is best-effort** - If it fails, use empty values silently
- **Fail fast** - Don't block on timeouts or missing data

## Input

Issue number or URL:
- `4567`
- `#4567`
- `https://github.com/posit-dev/positron/issues/4567`

## Workflow

### Steps 1 & 2: Fetch Issue and Find PRs (Parallel)

Run these in parallel with a single message containing multiple Bash tool calls:
- `gh issue view <number> --repo posit-dev/positron --json title,body,comments,url,labels,author`
- `gh pr list --repo posit-dev/positron --search "<number>" --state all --json number,title`

### Step 3: Analyze PR Context

Fetch primary PR details:
- `gh pr view <pr-number> --repo posit-dev/positron --json title,body,comments,additions,deletions,url`

Fetch all related PRs/issues mentioned in the body **in parallel**.

### Step 4: Review Code Changes (Conditional)

**Only for PRs < 500 lines** (additions + deletions from Step 3):
- `gh pr diff <pr-number> --repo posit-dev/positron`

Skip diff for large PRs - use PR description and comments instead.

### Step 5: Extract Linked Issues

Search comments for `#1234` references, additional test scenarios, edge cases, and platform-specific notes.

### Step 6: Generate Verification Guide

Create markdown file in `.claude/skills/positron-qa-verify/output/verify-issue-{number}-{timestamp}.md`

See `references/verification_guide.md` for format and examples.

### Step 7: Offer Verification Comment Template

After generating the guide, offer to create a verification comment template.

**Only when user accepts:**
1. Run `scripts/detect_versions.sh` to auto-detect Positron and OS versions
2. Generate comment template with scenarios from the guide
3. Copy to clipboard

**Comment format:**
- **Single scenario** (no edge cases/regressions): Simple bullet format
- **Multiple scenarios**: Grouped format with Primary/Edge cases/Regression checks sections

## Output

```
.claude/skills/positron-qa-verify/output/verify-issue-{number}-{timestamp}.md
```

## Helper Scripts

### `scripts/detect_versions.sh`

Fast, silent version detection (max 4 seconds):

```bash
./scripts/detect_versions.sh
```

Output:
```json
{
  "positronVersion": "2026.02.0",
  "positronBuild": "10",
  "osVersion": "macOS 26.2",
  "detectionStatus": "success"
}
```

Never prompts or shows errors - returns empty values on failure.

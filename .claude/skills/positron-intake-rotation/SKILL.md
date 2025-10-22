---
name: positron-intake-rotation
description: This skill should be used when handling issue intake rotation duties for the Positron repository. It provides workflows for reviewing and organizing new issues, responding to discussions, handling support tickets, and searching for related content. Use this skill when on intake rotation duty, when helping someone with intake tasks, or when learning the intake rotation process.
---

# Positron Intake Rotation

## Overview

This skill provides comprehensive guidance for handling issue intake rotation for the Positron IDE repository. Intake rotation is a weekly assignment (Monday-Friday) where team members review and respond to new issues, discussion posts, and support tickets to ensure timely responses and actionable issue tracking.

The goal is to respond to new items within approximately one business day and ensure all issues have the details required to be actionable.

## When to Use This Skill

Use this skill when:
- Currently on intake rotation duty
- Helping another team member with intake tasks
- Learning the intake rotation process
- Reviewing backlog items without status
- Responding to GitHub discussions
- Handling customer support tickets
- Searching for duplicate or related issues

## Quick Start

### Essential Scripts

Four shell scripts are provided to streamline intake tasks:

1. **`scripts/fetch_intake_issues.sh`** - List open issues without status (the intake queue)
2. **`scripts/fetch_discussions.sh`** - List recent open discussions needing attention
3. **`scripts/fetch_labels.sh`** - Show all available repository labels for categorization
4. **`scripts/search_related.sh <query>`** - Search for related issues and discussions

All scripts support `--json` flag for programmatic use. Run scripts from the skill directory.

### Essential References

Two comprehensive reference documents provide detailed workflows:

1. **`references/intake_workflow.md`** - Complete workflows for handling issues, discussions, and support tickets
2. **`references/response_examples.md`** - Response patterns and examples from experienced team members

Load these references when drafting responses or handling complex scenarios.

## Core Workflow

### Daily Intake Process

Follow this process each day during rotation:

1. **Check for new items**
   - Run `scripts/fetch_intake_issues.sh` to see issues without status
   - Run `scripts/fetch_discussions.sh` to see recent discussions
   - Check [Support Tickets in Jira](https://positpbc.atlassian.net/jira/core/projects/IDEESC/board/UtafxcH?filter=labels%20%3D%20%22Positron%22&groupBy=status)

2. **Review each item systematically**
   - Read the full description and context
   - Assess completeness (are system details, reproduction steps, etc. provided?)
   - Determine item type (bug, feature request, question, duplicate)

3. **Search for related content**
   - Use `scripts/search_related.sh "<keywords>"` to find similar issues
   - Check documentation at https://positron.posit.co/welcome.html
   - Look for existing discussions on the topic

4. **Categorize and organize**
   - Run `scripts/fetch_labels.sh` to see available labels
   - Apply appropriate labels (area, type, priority)
   - Set status to "Triage" once organized
   - Add to "Positron Backlog" project if applicable

5. **Draft and post response**
   - Consult `references/response_examples.md` for patterns
   - Welcome the contributor and thank them
   - Ask clarifying questions if information is missing
   - Provide workarounds or links to related content when available
   - Set realistic expectations about next steps

6. **Follow through**
   - Tag relevant team members if specialized knowledge is needed
   - Close duplicates with reference to canonical issue
   - Convert discussions to issues when appropriate
   - Continue following up even after rotation ends, or explicitly hand off

### Using GitHub CLI

Prefer using GitHub CLI (`gh`) over other methods for consistency:

```bash
# View issue with all comments
gh issue view <number> --repo posit-dev/positron --comments

# Search issues
gh issue list --repo posit-dev/positron --search "<query>" --state all

# Add labels
gh issue edit <number> --repo posit-dev/positron --add-label "area: console,Bug"

# View discussion
gh api graphql -f query='...' # (see scripts for examples)

# Close as duplicate
gh issue close <number> --repo posit-dev/positron --comment "Closing as duplicate of #<canonical-number>"
```

## Handling Different Scenarios

### Bug Reports

For bug reports, assess completeness:

**Complete bug report:**
- System details (Positron version, OS, commit hash)
- Clear reproduction steps
- Expected vs. actual behavior
- Error messages or screenshots

If complete:
1. Search for duplicates using `scripts/search_related.sh`
2. Apply labels (area, "Bug" type)
3. Set status to "Triage"
4. Thank reporter and acknowledge the issue

If incomplete:
1. Thank the reporter
2. Ask specific questions about missing information
3. Reference the bug report template if helpful
4. Keep issue open until information is provided

**Refer to `references/intake_workflow.md` for detailed bug handling workflows.**

### Feature Requests

For feature requests:
1. Thank the user for the suggestion
2. Search for existing related feature requests
3. If duplicate, link to existing issue and close
4. If new, apply labels and add to backlog
5. Set realistic expectations about prioritization

### Discussions

For discussions:
1. Determine discussion type (question, idea, bug report, announcement)
2. Respond appropriately:
   - **Questions:** Answer or link to docs
   - **Ideas:** Acknowledge and link to related issues
   - **Bug reports:** Ask user to create formal issue
   - **Off-topic:** Politely redirect

**Convert discussions to issues** when they contain clear, actionable bug reports or feature requests.

### Support Tickets

Support tickets require special handling:

⚠️ **CRITICAL:** Never mention customer names in public issues or discussions

1. Review ticket context in Jira
2. Search for related public issues
3. Respond in Jira (not publicly)
4. Create sanitized public issue if needed
5. Link between ticket and issue

### Security Issues

If an issue describes a security vulnerability:
1. **Do NOT discuss details publicly**
2. Ask reporter to email security@posit.co
3. Close public issue with note about private reporting
4. Alert team privately

## Response Guidelines

### Tone and Style

**Be welcoming:** Thank contributors for their time and effort

**Be clear:** Use simple language, explain technical terms, provide examples

**Be helpful:** Offer workarounds, link to resources, provide next steps

**Be realistic:** Don't overpromise timelines or solutions

**Be professional:** Remain calm and constructive, even with frustrated reporters

### Learning from Examples

To see examples from experienced team members:

```bash
# Find issues commented on by key team members
gh search issues --repo posit-dev/positron --commenter juliasilge --limit 20
gh search issues --repo posit-dev/positron --commenter jmcphers --limit 20

# View specific issue with comments
gh issue view <number> --repo posit-dev/positron --comments
```

Pay special attention to responses by `juliasilge` and `jmcphers` for tone and approach guidance.

**Load `references/response_examples.md` for detailed response patterns and anti-patterns.**

## Important Reminders

### Team Collaboration

**Don't try to solve everything alone.** Reach out to team members when:
- The issue requires specialized domain knowledge
- You're unsure how to categorize or prioritize
- The issue describes complex technical problems
- You need help understanding the user's concern

### Handoff Protocol

If handling an item extends beyond your rotation week:
- **Typically:** Continue following up yourself to get to triage
- **If not possible:** Explicitly communicate handoff to next person on rotation
- **Don't drop items** without clear handoff

### Documentation

If recurring issues or common questions emerge:
- Consider creating FAQ entries
- Suggest documentation improvements
- Note patterns for team discussion

## Quick Reference Links

- [Issue Intake Board](https://github.com/orgs/posit-dev/projects/2/views/33) - Issues without status
- [Discussions](https://github.com/posit-dev/positron/discussions) - Community discussions
- [Support Tickets](https://positpbc.atlassian.net/jira/core/projects/IDEESC/board/UtafxcH?filter=labels%20%3D%20%22Positron%22&groupBy=status) - Customer support (Jira)
- [Rotation Schedule](https://docs.google.com/spreadsheets/d/1JtE6NpwCx7x9ni-I_KYwCba63wo6LeJ6Z2CyYx_3Qss/edit?usp=sharing) - Google Sheet
- [Documentation](https://positron.posit.co/welcome.html) - Official Positron docs
- [Positron Assistant](https://connect.posit.it/positron-wiki/dev-notes/gh-issues-positron-assistant.html) - GitHub issue assistant

## Workflow Summary

```
Daily Intake:
1. Fetch new items (scripts/fetch_intake_issues.sh, scripts/fetch_discussions.sh)
2. Review and assess each item
3. Search for related content (scripts/search_related.sh)
4. Categorize with labels (scripts/fetch_labels.sh)
5. Draft response (references/response_examples.md)
6. Set status to "Triage"
7. Follow through or hand off

Remember: The goal is timely response and actionable organization, not solving every issue.
```

---
name: positron-intake-rotation
description: This skill should be used when handling issue intake rotation duties for the Positron repository. It provides workflows for reviewing and organizing new issues, responding to discussions, handling support tickets, and searching for related content. Use this skill when on intake rotation duty, when helping someone with intake tasks, or when learning the intake rotation process.
---

# Positron Intake Rotation

## Overview

This skill provides comprehensive guidance for handling issue intake rotation for the Positron IDE repository. Intake rotation is a weekly assignment (Monday-Friday) where team members review and respond to new issues, discussion posts, and support tickets to ensure timely responses and actionable issue tracking.

The goal is to respond to new items within approximately one business day and ensure all issues have the details required to be actionable.

## 🚨 CRITICAL: Manual Action Protocol

**This skill assists with intake rotation but NEVER executes GitHub actions directly.**

All GitHub interactions must be performed manually by the user:
- ✅ Draft responses for review before posting
- ✅ Suggest labels and categorization
- ✅ Prepare commands for user to execute
- ✅ Search and analyze issues/discussions
- ❌ NEVER post comments or responses directly
- ❌ NEVER edit issues, add labels, or change status
- ❌ NEVER close issues or create new ones
- ❌ NEVER execute `gh` commands that modify GitHub state

**Workflow:** Analyze → Recommend → Draft → User executes manually

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

4. **Recommend categorization and organization**
   - Run `scripts/fetch_labels.sh` to see available labels
   - **Suggest** appropriate labels (area, type, priority) for user to apply
   - **Recommend** setting status to "Triage" once organized
   - **Suggest** adding to "Positron Backlog" project if applicable
   - **Prepare** `gh` commands for user to execute manually

5. **Draft response for user review**
   - Consult `references/response_examples.md` for patterns
   - Draft welcoming message thanking the contributor
   - Include clarifying questions if information is missing
   - Suggest workarounds or links to related content when available
   - Set realistic expectations about next steps
   - **Present draft to user for review before posting**

6. **Recommend follow-through actions**
   - **Suggest** tagging relevant team members if specialized knowledge is needed
   - **Draft** duplicate closure message with reference to canonical issue
   - **Recommend** converting discussions to issues when appropriate
   - **Advise** continuing follow-up even after rotation ends, or explicit handoff

### Using GitHub CLI

Prefer using GitHub CLI (`gh`) over other methods for consistency. **All commands below are for the USER to execute manually.**

**Read-only commands** (can be executed to gather information):
```bash
# View issue with all comments
gh issue view <number> --repo posit-dev/positron --comments

# Search issues
gh issue list --repo posit-dev/positron --search "<query>" --state all

# View discussion
gh api graphql -f query='...' # (see scripts for examples)
```

**Modification commands** (prepare for user, NEVER execute directly):
```bash
# Add labels - DRAFT THIS COMMAND for user to run
gh issue edit <number> --repo posit-dev/positron --add-label "area: console,Bug"

# Close as duplicate - DRAFT THIS COMMAND for user to run
gh issue close <number> --repo posit-dev/positron --comment "Closing as duplicate of #<canonical-number>"
```

**Important:** Present modification commands to the user in a code block with clear instructions to review and execute manually.

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
2. **Suggest** labels (area, "Bug" type) for user to apply
3. **Recommend** setting status to "Triage"
4. **Draft** response thanking reporter and acknowledging the issue

If incomplete:
1. **Draft** message thanking the reporter
2. **Include** specific questions about missing information
3. **Suggest** referencing the bug report template if helpful
4. **Advise** keeping issue open until information is provided

**Refer to `references/intake_workflow.md` for detailed bug handling workflows.**

### Feature Requests

For feature requests:
1. **Draft** message thanking the user for the suggestion
2. Search for existing related feature requests
3. If duplicate, **draft** message linking to existing issue (user closes manually)
4. If new, **suggest** labels and recommend adding to backlog
5. **Draft** message setting realistic expectations about prioritization

### Discussions

For discussions:
1. Determine discussion type (question, idea, bug report, announcement)
2. **Draft** appropriate response:
   - **Questions:** Provide answer or link to docs
   - **Ideas:** Acknowledge and link to related issues
   - **Bug reports:** Ask user to create formal issue
   - **Off-topic:** Politely redirect

**Recommend converting discussions to issues** when they contain clear, actionable bug reports or feature requests (user performs conversion manually).

### Support Tickets

Support tickets require special handling:

⚠️ **CRITICAL:** Never mention customer names in public issues or discussions

1. Review ticket context in Jira
2. Search for related public issues
3. **Draft** response in Jira (not publicly) for user to post
4. **Recommend** creating sanitized public issue if needed
5. **Suggest** linking between ticket and issue

### Security Issues

If an issue describes a security vulnerability:
1. **Do NOT discuss details publicly**
2. **Draft** message asking reporter to email security@posit.co
3. **Recommend** closing public issue with note about private reporting (user closes manually)
4. **Advise** alerting team privately

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
Daily Intake (Assistant Mode - Draft & Recommend):
1. Fetch new items (scripts/fetch_intake_issues.sh, scripts/fetch_discussions.sh)
2. Review and assess each item
3. Search for related content (scripts/search_related.sh)
4. SUGGEST labels and categorization (scripts/fetch_labels.sh)
5. DRAFT response (references/response_examples.md) for user review
6. PREPARE gh commands for user to execute
7. RECOMMEND setting status to "Triage" (user executes)
8. ADVISE on follow-through or handoff

Remember: The goal is to ASSIST the user with timely response and actionable
organization. NEVER execute GitHub modification commands directly - always
present drafts and recommendations for the user to review and execute manually.
```

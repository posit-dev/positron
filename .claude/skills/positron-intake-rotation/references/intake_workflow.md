# Issue Intake Workflow

This document provides detailed workflows for handling issues, discussions, and support tickets during intake rotation.

## Core Responsibilities

The person on intake rotation ensures that issues, discussions, and support tickets are not dropped or ignored. The goal is to respond within about a business day. Key responsibilities:

1. **Review and organize open issues without a status** - Check the [Issue Intake Board](https://github.com/orgs/posit-dev/projects/2/views/33)
2. **Respond to open discussions** - Check [Positron Discussions](https://github.com/posit-dev/positron/discussions)
3. **Handle support tickets** - Check [Jira Support Board](https://positpbc.atlassian.net/jira/core/projects/IDEESC/board/UtafxcH?filter=labels%20%3D%20%22Positron%22&groupBy=status)

**Important:** Reach out to other team members for input if it's not clear how to handle an issue.

**Handoff:** If handling an item bleeds into the next week, typically continue following up yourself. If that's not possible, explicitly communicate with the next person on rotation to hand it off.

## Issue Handling Workflow

### Step 1: Identify New Issues

Use the `fetch_intake_issues.sh` script or check the [Issue Intake Board](https://github.com/orgs/posit-dev/projects/2/views/33) for open issues without a status.

### Step 2: Review Issue Details

For each new issue, review:
- **Title and description** - Is the issue clear and actionable?
- **System details** - Are system details provided (Positron version, OS, etc.)?
- **Reproduction steps** - Can the issue be reproduced?
- **Related content** - Are there duplicate or related issues?

### Step 3: Search for Related Content

Before responding, search for:
- **Existing issues** - Use `search_related.sh` or `gh issue list --search`
- **Discussions** - Check if similar topics have been discussed
- **Documentation** - Check https://positron.posit.co/welcome.html for relevant docs

### Step 4: Categorize and Label

Based on the issue content:
1. **Fetch available labels** - Run `fetch_labels.sh` to see current labels
2. **Apply appropriate labels**:
   - **Area labels** (e.g., `area: assistant`, `area: console`, `area: data-explorer`)
   - **Type labels** (e.g., `Bug`, `Feature`, `Documentation`)
   - **Priority labels** if applicable
3. **Assign to project** - Add to "Positron Backlog" project if applicable

### Step 5: Set Status

Issues typically start with status "Triage" once they've been reviewed and organized. Other statuses may be available in the project board.

### Step 6: Draft Response

When drafting responses:
- **Be welcoming and professional** - Thank users for reporting issues
- **Ask clarifying questions** if details are missing
- **Provide workarounds** if available
- **Link to related issues or docs** when relevant
- **Set expectations** about timeline or next steps if known

**Look at past responses** by key team members (especially `juliasilge` and `jmcphers`) for tone and style guidance.

**Common response patterns:**
- For bugs: "Thank you for reporting this. Can you provide [specific details]? In the meantime, you might try [workaround]."
- For features: "Thanks for the suggestion! This is similar to #[related-issue]. We'll consider this during planning."
- For duplicates: "Thanks for reporting! This looks like a duplicate of #[issue-number]. I'll close this in favor of that one, but feel free to add any additional context there."
- For unclear issues: "Thanks for reaching out. To help us understand this better, could you provide [specific information]?"

### Step 7: Follow Through

- **Tag relevant team members** if their expertise is needed
- **Close duplicates** and reference the canonical issue
- **Move to triage** once the issue is organized and ready for team review

## Discussion Handling Workflow

### Step 1: Review New Discussions

Use `fetch_discussions.sh` or check [Discussions](https://github.com/posit-dev/positron/discussions) for recent activity.

### Step 2: Determine Discussion Type

Discussions typically fall into:
- **Questions** - Users seeking help or clarification
- **Ideas/Feature Requests** - Suggestions for new functionality
- **Bug Reports** - Issues that should be converted to formal issues
- **Announcements/Updates** - Team communications

### Step 3: Respond or Redirect

- **For questions**: Answer directly or link to docs/related discussions
- **For feature ideas**: Acknowledge and indicate if similar issues exist
- **For bugs**: Ask the user to create a formal issue with the bug template
- **For off-topic**: Politely redirect to appropriate channels

### Step 4: Convert to Issues When Appropriate

If a discussion describes a clear bug or feature request:
1. Ask the user to create a formal issue (preferred)
2. Or create an issue yourself and link to the discussion
3. Summarize key points in the issue description

## Support Ticket Workflow

Support tickets from customers require special handling:

1. **Never mention customer names** in public issues or discussions
2. **Review the ticket** in Jira for context
3. **Search for related issues** that might already address the problem
4. **Create a new issue if needed** - Sanitize any customer-specific information
5. **Update the support ticket** with links to relevant issues or workarounds
6. **Coordinate with support team** if specialized knowledge is needed

## Other Scenarios

### Incomplete Bug Reports

If a bug report lacks critical information:
- Ask for specific details: system info, reproduction steps, error messages
- Use the bug report template as a guide for what's needed
- Be patient and helpful - not everyone knows what information is useful

### Feature Requests

- Thank the user for the suggestion
- Search for existing feature requests
- If duplicate, link to the existing issue
- If new, apply appropriate labels and add to backlog for triage

### Security Issues

If an issue describes a security vulnerability:
- **Do not discuss details publicly**
- Ask the reporter to email security@posit.co
- Close the public issue with a note about the private reporting process
- Alert the team privately

### Spam or Abusive Content

- Report to GitHub if needed
- Lock and hide conversations if appropriate
- Escalate to team leads if necessary

## Tips for Effective Intake

1. **Don't try to solve everything** - Your job is to organize and respond, not to fix every bug
2. **It's okay to say "I don't know"** - Tag subject matter experts when needed
3. **Be kind and welcoming** - Many reporters are new to open source
4. **Use templates** - Look at past responses for common patterns
5. **Keep it simple** - Clear, concise responses are better than long explanations
6. **Document patterns** - If you notice recurring issues, consider creating docs or FAQ entries

## Quick Reference Links

- [Issue Intake Board](https://github.com/orgs/posit-dev/projects/2/views/33)
- [Discussions](https://github.com/posit-dev/positron/discussions)
- [Support Tickets (Jira)](https://positpbc.atlassian.net/jira/core/projects/IDEESC/board/UtafxcH?filter=labels%20%3D%20%22Positron%22&groupBy=status)
- [Rotation Schedule (Google Sheet)](https://docs.google.com/spreadsheets/d/1JtE6NpwCx7x9ni-I_KYwCba63wo6LeJ6Z2CyYx_3Qss/edit?usp=sharing)
- [Documentation](https://positron.posit.co/welcome.html)
- [Positron Assistant for GitHub](https://connect.posit.it/positron-wiki/dev-notes/gh-issues-positron-assistant.html)

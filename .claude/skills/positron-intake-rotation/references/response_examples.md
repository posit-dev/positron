# Response Examples

This document contains examples of effective responses to issues and discussions. Look for patterns in tone, structure, and helpful elements.

## How to Use This Reference

When drafting responses:
1. Review examples similar to your situation
2. Note the welcoming tone and professional language
3. Observe how questions are asked clearly
4. See how workarounds and next steps are communicated
5. Adapt the patterns to your specific case

## Finding More Examples

To find real examples from key team members:

```bash
# Search for issues/PRs commented on by juliasilge
gh search issues --repo posit-dev/positron --commenter juliasilge --limit 20

# Search for issues/PRs commented on by jmcphers
gh search issues --repo posit-dev/positron --commenter jmcphers --limit 20

# View a specific issue with comments
gh issue view <number> --repo posit-dev/positron --comments
```

## Common Response Patterns

### Pattern: Bug Report - Initial Response

**Situation:** User reports a bug with good details

**Response Structure:**
1. Thank them for reporting
2. Confirm you understand the issue
3. Ask any clarifying questions
4. Provide workaround if available
5. Set expectations

**Example:**
```
Thank you for reporting this! I can reproduce the issue with Copilot models not having access to certain tools like getProjectTree and executeCode.

A few questions to help us debug:
- Does this happen with all Copilot models or specific ones?
- Do you see any errors in the Developer Tools console (Help > Toggle Developer Tools)?

In the meantime, you might try using Claude Sonnet models directly, which should have full tool access.

I'll add this to our backlog for investigation.
```

### Pattern: Bug Report - Missing Information

**Situation:** User reports a bug but lacks critical details

**Response Structure:**
1. Thank them for reporting
2. Explain what information is needed and why
3. Provide easy ways to get that information
4. Remain helpful and encouraging

**Example:**
```
Thanks for reporting this issue! To help us investigate, could you provide:

1. Your Positron version (Help > About)
2. Your operating system and version
3. Steps to reproduce the issue
4. Any error messages you see

You can get much of this info automatically by running "Help > Report Issue" in Positron.

Looking forward to getting this resolved!
```

### Pattern: Feature Request

**Situation:** User suggests a new feature

**Response Structure:**
1. Thank them for the suggestion
2. Acknowledge the use case
3. Link to related issues if they exist
4. Set expectations about prioritization
5. Invite further discussion

**Example:**
```
Thanks for this suggestion! Better terminal integration with R workflows would definitely
be valuable.

This relates to some of our ongoing work in #<related-issue>. We're considering several
approaches for improving the terminal experience.

I've added this to our backlog for consideration. Feel free to add any additional context
about your specific use case - that helps us prioritize.
```

### Pattern: Duplicate Issue

**Situation:** Issue is a duplicate of an existing one

**Response Structure:**
1. Thank them for reporting
2. Link to the canonical issue
3. Explain why you're closing as duplicate
4. Invite them to continue discussion on the canonical issue

**Example:**
```
Thank you for reporting this! This appears to be a duplicate of #<issue-number>, where
we're tracking the same behavior.

I'm going to close this issue in favor of that one to keep the discussion in one place.
Please feel free to add any additional details or context to #<issue-number> - every
data point helps!
```

### Pattern: Unclear Issue

**Situation:** Issue is vague or unclear

**Response Structure:**
1. Thank them for reaching out
2. Acknowledge what you understand
3. Ask specific questions to clarify
4. Provide examples of what would be helpful

**Example:**
```
Thanks for reaching out! I want to make sure I understand the issue correctly.

When you say "the console isn't working", do you mean:
- The console doesn't start at all?
- Commands don't execute?
- Output isn't displayed?
- Something else?

Also helpful would be:
- Your Positron version (Help > About)
- Which language you're using (Python/R)
- Any error messages you see

A screenshot or screen recording would be really helpful too!
```

### Pattern: Converting Discussion to Issue

**Situation:** Discussion contains a clear bug or feature request

**Response Structure:**
1. Acknowledge the discussion
2. Explain why it should be an issue
3. Ask them to create an issue or offer to create one
4. Summarize what should be included

**Example:**
```
This is a great discussion! It sounds like you've identified a specific bug with data frame rendering in the Variables pane.

Would you mind creating a formal issue for this? That helps us track and prioritize the fix.
Please include:
- Your system details (Positron version, OS)
- Steps to reproduce
- Expected vs actual behavior

I'll link back to this discussion from the issue so we don't lose this context.
```

### Pattern: Support Ticket Response

**Situation:** Internal support ticket needs response

**Response Structure:**
1. Review ticket context privately
2. Search for related public issues
3. Respond in support system (not public)
4. Create sanitized public issue if needed

**Internal Response:**
```
I found a related issue at posit-dev/positron#<number> that describes the same Python
extension loading behavior.

The workaround is to disable and re-enable the Python extension after startup. We're
working on a permanent fix tracked in that issue.

I've added a note to the public issue mentioning this affects some enterprise configurations.
```

## Anti-Patterns to Avoid

### Don't: Be Dismissive

❌ "This is already documented. Please read the docs."

✅ "Thanks for asking! This is documented at [link]. Specifically, the section on [topic]
should help. Let me know if you have questions after reading that!"

### Don't: Promise Timelines

❌ "We'll fix this in the next release."

✅ "We've added this to our backlog. I can't promise a specific timeline, but we'll prioritize based on impact and complexity."

### Don't: Blame the User

❌ "You're doing it wrong. You should..."

✅ "I see what's happening. Here's how to [correct approach]. Does that work for you?"

### Don't: Leave Them Hanging

❌ [No response or closing without explanation]

✅ "I'm going to close this issue as [reason]. If you have additional concerns, please
feel free to reopen or comment. Thanks!"

## Response Tone Guidelines

**Be welcoming:** Remember that reporting issues takes time and effort. Thank contributors.

**Be clear:** Use simple language. Avoid jargon when possible. Explain technical terms.

**Be helpful:** Provide workarounds, links, and next steps. Don't just acknowledge problems.

**Be realistic:** Don't overpromise. It's okay to say you don't know or need to check with the team.

**Be professional:** Even if the reporter is frustrated, remain calm and constructive.

## Using This Guide

1. **Before responding:** Read through relevant patterns
2. **Draft your response:** Adapt patterns to your specific situation
3. **Review:** Check tone, clarity, completeness
4. **Send:** Post your response
5. **Follow up:** Continue the conversation as needed

Remember: The goal is to make contributors feel heard and helped, while gathering the information needed to address their concerns.

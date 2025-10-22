---
name: positron-issue-creator
description: This skill should be used when creating new GitHub issues for the Positron repository. It provides workflows for searching duplicates, selecting appropriate labels, gathering complete context through questioning, and writing terse, fluff-free issues that precisely describe what is needed or wrong. Use this skill when the user asks to file or create an issue for Positron.
---

# Positron Issue Creator

## Purpose

This skill guides the creation of high-quality GitHub issues for the Positron IDE repository. It ensures issues are:
- Thoroughly checked for duplicates before creation
- Properly labeled for efficient triage
- Written with complete, specific information
- Free of unnecessary fluff and filler
- Actionable by the development team

## When to Use This Skill

Use this skill when:
- User explicitly asks to create, file, or report an issue
- User describes a bug or feature request that should be tracked
- Creating documentation or improvement requests
- User says "can you file an issue for..." or similar

Do NOT use this skill for:
- Intake rotation duties (use `positron-intake-rotation` instead)
- Responding to existing issues
- General Positron development tasks

## Core Workflow

Follow this workflow for every issue creation request:

### 1. Gather Complete Context

Before drafting anything, ensure all necessary information is available. Use iterative questioning if needed.

**For Bug Reports, obtain:**
- Positron version (Help > About or specific build number)
- Operating system and version
- Session details (R/Python version)
- Exact steps to reproduce
- Expected vs. actual behavior
- Error messages (from UI, Output panel, or Developer Console)
- Screenshots if relevant

**For Feature Requests, obtain:**
- Clear description of the desired feature
- Use case (why it's needed, what problem it solves)
- Proposed behavior (how it should work)
- Any related issues or examples from other tools

**Ask specific questions** when information is missing:
- "What Positron version are you using? Check Help > About"
- "What's the exact error message displayed?"
- "What did you expect to happen vs. what actually happened?"
- "Can you provide the specific steps to reproduce this?"

**Never make assumptions.** If unclear, ask rather than guess.

### 2. Search for Duplicates

Use `scripts/search_duplicates.sh` to search for existing issues and discussions:

```bash
cd /path/to/positron/.claude/skills/positron-issue-creator
./scripts/search_duplicates.sh "keywords from issue"
```

**Review results carefully:**
- Check both open and closed issues
- Look at discussions as well
- Consider variations of the search terms

**Present findings to user:**
- Show all potentially related issues
- Highlight any that seem very similar
- Ask user to confirm whether these are duplicates
- For uncertain matches, explicitly ask: "Is this the same issue as #1234?"

**If duplicate found:**
- Inform user that issue already exists
- Provide link to existing issue
- Suggest they add a comment or 👍 reaction if they want to track it
- Do NOT create new issue

**If no duplicates:**
- Proceed to drafting the issue
- Reference any related issues in the draft

### 3. Select Appropriate Labels

Use `scripts/fetch_labels.sh` to retrieve current repository labels:

```bash
cd /path/to/positron/.claude/skills/positron-issue-creator
./scripts/fetch_labels.sh
```

**Choose labels based on:**

**Area labels** (select 1-2):
- `area: console` - Console/REPL functionality
- `area: notebook` - Jupyter notebook integration
- `area: editor` - Text editor functionality
- `area: plots` - Plot viewer and visualization
- `area: data-explorer` - Data viewer and explorer
- `area: connections` - Database connections
- `area: help` - Help pane and documentation
- `area: ui` - General UI/UX issues
- Review full list from `fetch_labels.sh` for complete options

**Type label** (select 1):
- `Bug` - Something doesn't work as intended
- `Feature Request` - New capability or enhancement
- `Documentation` - Documentation improvements
- `Performance` - Works but too slowly

**Other considerations:**
- Avoid adding priority labels (set during triage)
- Don't add status labels (will be set by team)
- Multiple area labels are acceptable if issue spans components

### 4. Draft the Issue

Use the templates in `references/issue_templates.md` as starting points, but adapt to the specific issue.

**Load templates when needed:**
- Bug reports: Reference bug report structure
- Feature requests: Reference feature request structure
- Hybrid cases: Adapt as appropriate

**Follow writing guidelines from `references/writing_guidelines.md`:**

**Core principles:**
1. **Be terse** - Every word serves a purpose
2. **Be fluff-free** - No apologies, preambles, or unnecessary politeness
3. **Be specific** - Exact versions, precise steps, concrete details
4. **Be direct** - Get to the point immediately

**Title guidelines:**
- Bug: `[Component] fails when [condition]`
- Feature: `Add [feature] to [component]`
- Complete sentence that tells the full story
- Scannable and searchable

**Body structure:**
1. **What** - The issue itself (1 sentence)
2. **Why** - Impact/context (1-2 sentences if not obvious)
3. **How** - Steps or proposed solution (bullet points)
4. **Details** - System info, errors, screenshots (as needed)

**Example bug report:**
```markdown
Title: Console freezes when printing dataframes with 100k+ rows

The console becomes unresponsive when printing large dataframes.

## Steps to reproduce

1. Create dataframe: `df = pd.DataFrame({'a': range(100000)})`
2. Print it: `print(df)`
3. Console freezes, UI becomes unresponsive

## System details

- Positron 2024.10.0 Build 123
- macOS 14.5
- Python 3.11.6

## Error messages

Developer Console shows: "Maximum call stack size exceeded"
```

**Example feature request:**
```markdown
Title: Add keyboard shortcut to insert markdown cell in notebooks

Currently inserting markdown cells requires clicking the dropdown menu.
Keyboard shortcut would improve notebook authoring workflow.

## Proposed behavior

- Add keyboard shortcut (e.g., Cmd+M or Ctrl+M)
- Should work when focus is in notebook
- Should insert cell below current cell

## Context

Similar to Jupyter's 'M' key in command mode. Notebook workflows
frequently alternate between code and markdown cells.
```

**Common anti-patterns to avoid:**
- Unnecessary background or preambles
- Vague descriptions ("it doesn't work", "sometimes crashes")
- Combining multiple unrelated issues
- Apologetic or overly polite language
- Missing concrete details (exact versions, error messages)
- Long-winded explanations when concise ones suffice

**Review checklist before presenting:**
- [ ] Title is complete and specific
- [ ] Body starts with the core issue
- [ ] Reproduction steps are clear (for bugs)
- [ ] System details included (for bugs)
- [ ] Error messages are exact quotes
- [ ] No unnecessary fluff
- [ ] Each sentence adds value
- [ ] Single, focused topic
- [ ] Appropriate labels selected

### 5. Present Draft to User

Show the complete drafted issue including:
- Title
- Full body text
- Proposed labels

Ask user: "Does this accurately capture the issue? Would you like any changes before I create it?"

**Allow for iteration:**
- User may want to adjust wording
- May remember additional details
- May want to emphasize different aspects

Make requested changes and show updated draft.

### 6. Create the Issue

Once user approves, create the issue using GitHub CLI:

```bash
# Create the issue with title, body, and labels
gh issue create \
  --repo posit-dev/positron \
  --title "Issue title here" \
  --body "$(cat <<'EOF'
Full issue body here
with multiple lines
EOF
)" \
  --label "area: console,Bug"
```

**After creation:**
- Show the user the issue URL
- Confirm issue was created successfully
- Offer to add any additional comments or screenshots if needed

## Important Guidelines

### Duplicate Detection

**Be thorough but not pedantic:**
- Search with multiple keyword combinations
- Check both issues and discussions
- Look at closed items too (might be fixed or wontfix)

**When uncertain:**
- Show user the potentially similar issues
- Ask explicitly: "Is this the same as what you're reporting?"
- Err on the side of creating new issues rather than incorrectly marking as duplicate

### Context Gathering

**Never guess or assume:**
- If version is unclear, ask specifically
- If steps are vague, request clarification
- If error message is paraphrased, ask for exact text

**Be patient with iteration:**
- Users may not have all information immediately
- May need to reproduce issue to get details
- It's better to ask multiple questions than create incomplete issue

### Writing Style

**Optimize for scanability:**
- Busy developers need to quickly understand the issue
- Put most important information first
- Use formatting (headings, lists, code blocks) appropriately

**Respect reader's time:**
- No unnecessary pleasantries beyond "Thanks for reporting"
- No apologetic language
- No marketing-speak or enthusiasm
- Just clear, factual information

**Be precise:**
- Use exact versions, not "latest" or "recent"
- Quote error messages exactly
- Number steps clearly
- State actual behavior, not interpretations

## Special Cases

### Security Issues

If user describes a security vulnerability:
1. **Do NOT create public issue**
2. Inform user: "This appears to be a security issue. Please report it privately to security@posit.co instead of creating a public issue"
3. Do NOT proceed with issue creation

### Documentation Issues

Treat as feature requests but focus on:
- What documentation is missing or incorrect
- Where users would look for this information
- Suggested improvements

Label with `Documentation` type.

### Performance Issues

Use bug report template but emphasize:
- What operation is slow
- How long it takes vs. expected time
- System details including hardware
- Data size or complexity

Label with `Performance` type.

### Multiple Related Issues

If user describes several related but distinct issues:
1. Identify each separate issue
2. Explain to user: "This sounds like 3 separate issues. I'll help create each one individually."
3. Create issues one at a time
4. Cross-reference in issue bodies if related

## Scripts Reference

### `scripts/fetch_labels.sh`

Retrieves all repository labels for categorization.

**Usage:**
```bash
./scripts/fetch_labels.sh          # Human-readable output
./scripts/fetch_labels.sh --json   # JSON output for parsing
```

### `scripts/search_duplicates.sh`

Searches for potential duplicate issues and discussions.

**Usage:**
```bash
./scripts/search_duplicates.sh "search terms"
./scripts/search_duplicates.sh "search terms" --limit 30
```

Returns:
- Matching issues (open and closed)
- Related discussions
- Direct links to review

## References

Load these reference documents when drafting issues:

- **`references/issue_templates.md`** - Templates for bugs, features, and hybrid issues
- **`references/writing_guidelines.md`** - Detailed writing guidance, anti-patterns, examples

## Common Mistakes to Avoid

1. **Creating duplicate issues** - Always search first, show results to user
2. **Incomplete information** - Ask questions until all details are gathered
3. **Verbose writing** - Cut all fluff, be direct and specific
4. **Vague titles** - Titles should tell the complete story
5. **Multiple issues in one** - Split into separate, focused issues
6. **Assuming context** - Ask user to confirm unclear details
7. **Skipping labels** - Always fetch and apply appropriate labels
8. **Creating without user approval** - Always show draft and get confirmation

## Success Criteria

A successful issue creation means:
- No duplicates exist (or user confirmed it's distinct)
- All necessary information is included
- Issue is terse and free of fluff
- Title accurately summarizes the issue
- Appropriate labels applied
- User approved the draft
- Issue was successfully created on GitHub

## Workflow Summary

```
1. Gather Context
   ↓
   Ask specific questions until all info available
   ↓
2. Search Duplicates
   ↓
   Run scripts/search_duplicates.sh
   ↓
   Show results to user, confirm not duplicate
   ↓
3. Select Labels
   ↓
   Run scripts/fetch_labels.sh
   ↓
   Choose appropriate area and type labels
   ↓
4. Draft Issue
   ↓
   Use templates from references/
   ↓
   Follow writing guidelines (terse, specific, direct)
   ↓
5. Present Draft
   ↓
   Show complete draft to user
   ↓
   Iterate based on feedback
   ↓
6. Create Issue
   ↓
   Use gh issue create with approved content
   ↓
   Provide issue URL to user
```

Remember: The goal is to create clear, actionable issues that respect both the reporter's intent and the development team's time.

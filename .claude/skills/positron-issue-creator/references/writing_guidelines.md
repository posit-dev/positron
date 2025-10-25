# Writing Guidelines for Positron Issues

This document provides guidance for writing clear, concise, and actionable issues for the Positron repository.

## Core Principles

### 1. Be Terse

Every word should serve a purpose. Remove:
- Unnecessary adjectives and adverbs
- Redundant phrases
- Obvious statements
- Filler words

**Bad:** "I was just wondering if it might be possible to perhaps add a feature..."
**Good:** "Add feature to..."

### 2. Be Fluff-Free

Avoid:
- Apologies ("Sorry to bother you...")
- Over-politeness ("I hate to ask, but...")
- Unnecessary context ("As a long-time user...")
- Marketing language ("This amazing feature would...")

**Bad:** "First of all, I'd like to thank you for this amazing IDE. I've been using it for weeks and love it. However, I noticed a small issue that's been bothering me..."
**Good:** "The console crashes when..."

### 3. Be Specific

Use concrete details:
- Exact version numbers, not "latest"
- Specific error messages, not "it doesn't work"
- Precise steps, not vague descriptions
- Actual behavior, not interpretations

**Bad:** "It sometimes crashes"
**Good:** "Positron crashes when opening files >100MB"

### 4. Be Direct

Get to the point immediately:
- Start with the issue, not background
- Put the most important information first
- Use active voice
- State what's needed clearly

**Bad:** "There seems to be a situation where, under certain circumstances, users might experience..."
**Good:** "Console freezes when printing large dataframes"

## Structure Guidelines

### Title

The title should be a complete, scannable sentence that tells the full story:

**Bug Report Titles:**
- Pattern: `[Component] fails when [condition]`
- Examples:
  - "Console crashes when printing 100k+ row dataframe"
  - "Notebook cells fail to execute after kernel restart"
  - "Plot viewer doesn't refresh when re-running code"

**Feature Request Titles:**
- Pattern: `Add [feature] to [component]` or `Support [capability]`
- Examples:
  - "Add export to SVG in plot viewer"
  - "Support custom keybindings for notebook cells"
  - "Add syntax highlighting for Julia"

**Avoid:**
- Vague titles: "Problem with console"
- Questions: "Can we add feature X?"
- Incomplete: "Crash" (crashes when? where?)

### Body

Follow this hierarchy:

1. **What** - The issue itself (1 sentence)
2. **Why** - Impact or context (1-2 sentences, if not obvious)
3. **How** - Steps to reproduce or proposed solution (bullet points)
4. **Details** - System info, errors, screenshots (as needed)

### Example Issue

**Title:** Console freezes when printing dataframes with 100k+ rows

**Body:**
```markdown
The console becomes unresponsive when printing large dataframes.

## Steps to reproduce

1. Create dataframe with 100k rows: `df = pd.DataFrame({'a': range(100000)})`
2. Print it: `print(df)`
3. Console freezes, UI becomes unresponsive

## System details

- Positron 2024.10.0 Build 123
- macOS 14.5
- Python 3.11.6

## Error messages

Developer Console shows: "Maximum call stack size exceeded"
```

**What makes this good:**
- Title explains the full issue
- Body starts with impact
- Clear reproduction steps
- Relevant system details
- Actual error message included
- No fluff or unnecessary context

## Question Protocol

When drafting issues, if the user hasn't provided enough information:

### Ask Specific Questions

**Bad questions:**
- "Can you provide more details?"
- "What happened?"
- "Tell me about your setup"

**Good questions:**
- "What Positron version are you using? (Check Help > About)"
- "What's the exact error message shown?"
- "Does this happen with all files or specific ones?"
- "What Python/R version is running?"

### Iterative Refinement

1. Draft initial issue with available information
2. Mark missing information with `[NEEDED: specific detail]`
3. Ask user specific questions to fill gaps
4. Update draft with answers
5. Present final version for approval

## Common Pitfalls

### 1. Combining Multiple Issues

**Bad:**
```markdown
Title: Several problems with notebooks

I've noticed that notebooks crash sometimes, and also the
syntax highlighting doesn't work for R, and I think we
should add a feature to export notebooks...
```

**Good:** Create separate issues:
- "Notebook crashes when [specific condition]"
- "R syntax highlighting missing in notebook cells"
- "Add export to PDF for notebooks"

### 2. Vague Reproduction Steps

**Bad:**
```markdown
Steps:
1. Open a file
2. Do some stuff
3. It crashes
```

**Good:**
```markdown
Steps:
1. Open Python file with >1000 lines
2. Place cursor on line 500
3. Press Cmd+F to open find dialog
4. Type search term
5. Press Enter
6. Positron crashes
```

### 3. Missing Error Messages

**Bad:** "I got an error"

**Good:**
```markdown
Error in Developer Console:
TypeError: Cannot read property 'length' of undefined
  at Object.render (notebook.js:425)
```

### 4. Unnecessary Background

**Bad:**
```markdown
I've been a data scientist for 15 years and have used
many IDEs. Recently I switched to Positron because I
heard great things about it. After using it for a few
weeks, I noticed that...
```

**Good:**
```markdown
The plot viewer doesn't refresh when re-running code.
```

### 5. Feature Requests Without Use Cases

**Bad:** "Add dark mode"

**Good:**
```markdown
Add dark theme for plot viewer

Currently plots are shown on a white background. When
working in dark mode, this creates harsh contrast. A
dark background option would reduce eye strain during
long sessions.
```

## Label Selection

After writing the issue, select appropriate labels:

### Area Labels

Choose the component affected:
- `area: console` - Console/REPL issues
- `area: notebook` - Notebook issues
- `area: editor` - Editor issues
- `area: plots` - Plot viewer issues
- `area: data-explorer` - Data explorer issues
- `area: ui` - General UI issues

Use `scripts/fetch_labels.sh` to see all available labels.

### Type Labels

- `Bug` - Something doesn't work as expected
- `Feature Request` - New capability or enhancement
- `Documentation` - Docs need improvement
- `Performance` - Works but too slowly

### Priority Labels (optional)

Usually set during triage, but obvious critical issues can be labeled:
- `critical` - Data loss, crashes, security issues
- `high` - Major functionality broken
- `medium` - Noticeable but not blocking
- `low` - Minor issues, nice-to-haves

## Review Checklist

Before finalizing an issue, verify:

- [ ] Title is complete and specific
- [ ] Body starts with the core issue
- [ ] Reproduction steps are clear and numbered (for bugs)
- [ ] System details are included (for bugs)
- [ ] Error messages are exact quotes
- [ ] No unnecessary background or fluff
- [ ] No apologies or hedging language
- [ ] Each sentence adds value
- [ ] Appropriate labels selected
- [ ] Issue is a single, focused topic

## Examples

### Excellent Bug Report

```markdown
Title: Data Explorer crashes when sorting column with null values

Data Explorer becomes unresponsive when sorting any column containing
null values.

## Steps to reproduce

1. Create dataframe: `df = pd.DataFrame({'a': [1, None, 3]})`
2. Open in Data Explorer (View > Data Explorer)
3. Click column 'a' header to sort
4. Data Explorer freezes

## System details

- Positron 2024.10.0 Build 123
- Windows 11
- Python 3.11.6

## Error

Developer Console: "TypeError: Cannot compare null value"

Labels: area: data-explorer, Bug, high
```

### Excellent Feature Request

```markdown
Title: Add keyboard shortcut to insert markdown cell in notebooks

Currently inserting markdown cells requires clicking the dropdown menu.
Keyboard shortcut would improve notebook authoring workflow.

## Proposed behavior

- Add keyboard shortcut (e.g., Cmd+M or Ctrl+M) to insert markdown cell
- Shortcut should work when focus is in notebook
- Should insert cell below current cell

## Context

Similar to Jupyter's 'M' key in command mode. Most notebook workflows
alternate between code and markdown cells frequently.

Labels: area: notebook, Feature Request
```

## Anti-Pattern Examples

### Too Verbose

```markdown
Hello! First of all, I want to say how much I appreciate all the hard
work you've put into Positron. I've been a data scientist for many years
and have tried numerous IDEs, and I must say that Positron is really
impressive. The UI is beautiful and the performance is generally quite
good.

However, I have noticed a small issue that I thought I should bring to
your attention. It's not a huge deal, but it has been bothering me a bit...

[Finally gets to the actual issue after 5 paragraphs]
```

**Fix:** Delete everything before the actual issue description.

### Too Vague

```markdown
Title: Console problem

The console doesn't work right sometimes. It's really annoying and
happens occasionally when I'm doing stuff.
```

**Fix:** Be specific about what doesn't work, when, and what "work right" means.

### Combining Issues

```markdown
Title: Various notebook issues

1. Sometimes cells don't execute
2. Syntax highlighting is weird
3. We should add an export feature
4. The keyboard shortcuts are confusing
```

**Fix:** Create four separate, specific issues.

## Final Notes

Remember: The goal is to create issues that:
1. Can be quickly understood by anyone on the team
2. Contain all information needed to act
3. Are searchable by others with similar issues
4. Respect the reader's time

When in doubt, **be more concise** rather than more verbose.

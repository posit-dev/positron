# Issue Templates

This document provides templates for creating Positron issues. Use these as starting points, adapting them to the specific issue being reported.

## Bug Report Template

Use this template for bugs. The user may not provide all information upfront - ask clarifying questions to fill in missing sections.

```markdown
## System details

**Positron Version:** [e.g., 2024.10.0 Build 123]
**OS:** [e.g., macOS 14.5, Windows 11, Ubuntu 22.04]
**Session:** [e.g., R 4.4.1, Python 3.11.6]

## Describe the issue

[Clear, concise description of what's wrong]

## Steps to reproduce

1. [First step]
2. [Second step]
3. [And so on...]

## Expected behavior

[What should happen]

## Actual behavior

[What actually happens]

## Error messages

[Any error messages from the UI, Output panel, or Developer Tools console]

[Screenshots if helpful]
```

### Required Information for Bug Reports

Before creating a bug report, ensure these details are available:

1. **System details** - Version, OS, session type
2. **Reproduction steps** - Clear, numbered steps
3. **Expected vs. actual behavior** - What should happen vs. what does happen
4. **Error messages** - From any source (UI, console, logs)

If the user hasn't provided all information, **ask specific questions** before drafting the issue.

## Feature Request Template

Feature requests are more flexible and don't require the strict structure of bug reports. Focus on clarity and value.

```markdown
## Feature description

[Clear description of the proposed feature]

## Use case

[Why is this feature needed? What problem does it solve?]

## Proposed behavior

[How should the feature work? What should users see/experience?]

## Additional context

[Any related issues, examples from other tools, mockups, etc.]
```

### Key Elements for Feature Requests

1. **Clear description** - What the feature is
2. **Use case** - Why it's needed
3. **Proposed behavior** - How it should work
4. **Context** - Related issues, examples, alternatives considered

## Hybrid Template

Some issues combine aspects of bugs and feature requests (e.g., "X doesn't work, and it should work like Y"). Adapt the template accordingly:

```markdown
## Current behavior

[What currently happens that's problematic]

## Desired behavior

[How it should work instead]

## Context

**System:** [If relevant for reproduction]
**Use case:** [Why this matters]

## Steps to reproduce (if applicable)

1. [Steps if needed]

## Additional context

[Related issues, examples, etc.]
```

## Template Selection Guide

Choose the appropriate template based on issue type:

| Issue Type | Template | Key Characteristics |
|------------|----------|---------------------|
| Clear bug with reproduction | Bug Report | Known steps to reproduce, clear error |
| Feature request | Feature Request | New capability or enhancement |
| Missing/broken functionality | Hybrid | Something should work but doesn't |
| Documentation issue | Feature Request (adapted) | Docs need improvement |
| Performance issue | Bug Report (adapted) | Something works but too slowly |

## Special Cases

### Documentation Issues

Treat as feature requests but focus on:
- What documentation is missing or incorrect
- Where users would look for this information
- Suggested improvements or additions

### Performance Issues

Use bug report template but emphasize:
- What operation is slow
- How long it takes vs. expected time
- System details (hardware, data size)

### Security Issues

**Never create public issues for security vulnerabilities.** Instead:
1. Ask reporter to email security@posit.co
2. Do not create a public issue
3. Alert team privately

## Anti-Patterns to Avoid

Don't create issues that:
- Lack concrete details ("it doesn't work")
- Combine multiple unrelated issues (split them)
- Use vague language ("sometimes", "occasionally" without specifics)
- Include long preambles or unnecessary context
- Repeat information already clear from the title

See [references/writing_guidelines.md](./writing_guidelines.md) for detailed writing guidance.

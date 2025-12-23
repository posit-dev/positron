# PR Body Templates Reference

This document contains templates and examples for different types of PRs in the Positron repository.

## Template Components

### Opening Line Patterns

**With Issue:**
```
Addresses #[issue_number].
```

**Without Issue:**
```
[Brief statement of what the PR does].
```

**Multiple Issues:**
```
Addresses #[issue1], #[issue2], and #[issue3].
```

### Description Patterns

**Simple (2-3 sentences):**
```
This PR [what it does]. The [root cause/reason]. [Any important implementation detail].
```

**Complex (with header):**
```
### Summary

[Paragraph explaining the changes]

[Technical context paragraph if needed]

Related PRs:
- posit-dev/ark#[number] - [description]
- posit-dev/positron-python#[number] - [description]
```

## PR Type Templates

### 1. Bug Fix

```markdown
Addresses #[issue].

This PR fixes [the problem]. The issue was caused by [root cause]. [Implementation approach if non-obvious].

### Release Notes

#### New Features
- N/A

#### Bug Fixes
- [User-facing description of fix] (#[issue])

### QA Notes

[relevant tags]

[Simple reproduction steps and verification]
```

### 2. New Feature

```markdown
Addresses #[issue].

### Summary

This PR adds [feature description]. Users can now [what they can do].

[Technical implementation paragraph]

[Related PRs if any]

### Release Notes

#### New Features
- [User-facing feature description] (#[issue])

#### Bug Fixes
- N/A

### QA Notes

[relevant tags]

[Numbered steps for testing]:
1. [Setup step]
2. [Action step]
3. [Verification step]

```[language]
[Code example if helpful]
```
```

### 3. UI/UX Change

```markdown
Addresses #[issue].

This PR [describes the UI change]. The change improves [what it improves].

[Screenshot: Description of what the screenshot shows]

### Release Notes

#### New Features
- [User-visible UI change] (#[issue])

#### Bug Fixes
- N/A

### QA Notes

[relevant tags including UI-specific ones]

1. [Navigate to the UI element]
2. [Perform the action]
3. [Verify the new behavior]
```

### 4. Performance Improvement

```markdown
Addresses #[issue].

### Summary

This PR optimizes [what was optimized]. Performance improves by [metrics/percentage] for [use case].

**Before:** [performance characteristic]
**After:** [improved characteristic]

### Release Notes

#### New Features
- N/A

#### Bug Fixes
- N/A

#### Performance
- [User-facing performance improvement] (#[issue])

### QA Notes

@:performance [other relevant tags]

[Steps to verify performance improvement]
```

### 5. Maintenance/Refactoring

```markdown
[Brief description of maintenance work].

### Summary

This PR [refactoring description]. No user-facing changes.

[Technical justification]

### Release Notes

#### New Features
- N/A

#### Bug Fixes
- N/A

### QA Notes

[relevant tags]

Verify existing functionality still works:
1. [Test area 1]
2. [Test area 2]
```

### 6. E2E Test Addition

```markdown
Adds e2e tests for [feature/area].

This PR adds comprehensive test coverage for [what's being tested]. The tests verify [key behaviors].

### QA Notes

[tags for the areas being tested]

Run the new tests:
```bash
npx playwright test [test-file-name] --project e2e-electron
```
```

## Release Notes Guidelines

### Good Examples

**Features:**
- ✅ "Added support for Python 3.12 virtual environments"
- ✅ "Jupyter notebooks now support collapsible cell outputs"
- ✅ "New keyboard shortcut <kbd>Cmd+Shift+P</kbd> opens command palette"

**Bug Fixes:**
- ✅ "Fixed Data Explorer scrolling on Safari"
- ✅ "Resolved console output truncation for long lines"
- ✅ "Connections pane now correctly displays schema names with spaces"

### Bad Examples

**Too Technical:**
- ❌ "Refactored AbstractKernelManager to use dependency injection"
- ❌ "Fixed race condition in async state machine"

**Too Vague:**
- ❌ "Improved performance"
- ❌ "Fixed various bugs"
- ❌ "Updated UI"

## QA Notes Best Practices

### Tag Selection

Choose tags based on the primary area affected:
- Use feature tags for functionality changes
- Add platform tags if platform-specific testing needed
- Include `@:critical` only for critical path features
- Don't over-tag - focus on primary areas

### Testing Instructions

**Simple Fix:**
```
@:console

Run any Python code in the console and verify output appears correctly.
```

**Complex Feature:**
```
@:connections @:duck-db

1. Install DuckDB: `pip install duckdb`
2. Create connection via File > New Connection > DuckDB
3. Select "In-memory database" option
4. Run the test script:

```python
import duckdb
conn = duckdb.connect()
conn.execute("CREATE TABLE test (id INT, name VARCHAR)")
conn.execute("INSERT INTO test VALUES (1, 'test')")
```

5. Verify table appears in Connections pane
6. Double-click table to preview data
```

## Common Patterns

### Paired PRs

When PRs depend on changes in other repos:
```
Related PRs (merge in order):
1. posit-dev/ark#123 - Kernel support (merge first)
2. This PR - UI integration
3. posit-dev/positron-python#456 - Language server support (optional)
```

### Breaking Changes

Include migration notes:
```
### ⚠️ Breaking Changes

This PR changes [what changes]. Users will need to [migration steps].

**Before:** `old_api_call()`
**After:** `new_api_call(param)`
```

### Documentation Updates

Reference documentation PRs:
```
Documentation: posit-dev/positron-docs#789
```

## Style Guidelines

### Language

- **Present tense** for descriptions: "Fixes", "Adds", "Enables"
- **Active voice**: "This PR fixes..." not "The bug is fixed by..."
- **Concise**: Remove unnecessary words
- **User-facing**: Focus on impact, not implementation

### Formatting

- Use `backticks` for code, commands, file names
- Use **bold** for emphasis sparingly
- Use `<kbd>` tags for keyboard shortcuts
- Link issues with `#[number]` format
- Use code blocks with language hints

### What to Avoid

- 🚫 Flowery language or unnecessary context
- 🚫 Implementation details in release notes
- 🚫 Apologizing or self-deprecation
- 🚫 Commit message lists (PR body should summarize)
- 🚫 TODO items (these belong in issues)
- 🚫 Questions (resolve before creating PR)
---
name: positron-pr-helper
description: Generates well-structured PR bodies with dynamically fetched e2e test tags
---

# Positron PR Helper

This skill helps you create comprehensive PR bodies for the posit-dev/positron repository with up-to-date e2e test tags fetched directly from the source of truth.

## When to Use This Skill

Use this skill when:
- Creating a new PR and need a well-structured body
- Updating an existing PR body with the correct format
- You need the current list of e2e test tags for QA notes
- You want to ensure your PR body follows Positron conventions

## Prerequisites

- GitHub CLI (`gh`) installed and authenticated
- Working in the Positron repository
- Access to the repository's test-tags.ts file

## Workflow

I'll guide you through creating a comprehensive PR body:

### Step 1: Gather Context

First, I'll ask you:
1. **Issue number** (if this PR addresses a specific issue)
2. **PR type** (bug fix, feature, UI change, maintenance, etc.)
3. **Summary** of what the PR does
4. **Screenshots needed?** (for UI changes)
5. **Related PRs** (e.g., in ark repository)

If you provide an issue number, I'll use `gh issue view` to fetch details and understand the context better.

### Step 2: Fetch Current Test Tags

I'll dynamically fetch the current e2e test tags from `test/e2e/infra/test-runner/test-tags.ts` using our extraction script. This ensures we always have the complete, up-to-date list of tags including:
- Feature tags (functionality-specific)
- Platform tags (OS/environment control)
- Performance tags
- Special tags (critical, soft-fail)

### Step 3: Generate PR Body

Based on the PR type and context, I'll create a structured PR body with:

1. **Opening Line**
   - "Addresses #[issue]." if applicable
   - Brief statement of what the PR does otherwise

2. **Description/Summary**
   - Concise explanation of changes
   - Technical context if needed
   - Related PRs referenced

3. **Screenshots** (for UI changes only)
   - Placeholder text or actual URLs if provided

4. **Release Notes**
   - New Features (if applicable)
   - Bug Fixes (if applicable)
   - User-facing descriptions

5. **QA Notes**
   - Relevant e2e test tags based on affected areas
   - Testing instructions
   - Code examples if helpful

### Step 4: Output Options

Once the PR body is ready, you can choose:
1. **Copy to clipboard** (Mac only) - I'll use `pbcopy`
2. **Update existing PR** - I'll use `gh pr edit`
3. **Save to file** - I'll write to a file of your choice
4. **Display only** - I'll show it for manual copying

## Helper Scripts

### fetch-test-tags.sh

This script extracts and categorizes all test tags from the TypeScript enum:
```bash
# Usage:
./scripts/fetch-test-tags.sh [format]
# format: markdown (default), json, or list
```

The script:
- Parses `test-tags.ts` without needing TypeScript compilation
- Categorizes tags automatically (feature, platform, performance, special)
- Outputs in multiple formats for different use cases
- Runs quickly (<1 second)

## PR Body Templates

I use different templates based on PR type:

### Bug Fix Template
```markdown
Addresses #[issue].

[2-3 sentences explaining the fix]

### Release Notes

#### New Features
- N/A

#### Bug Fixes
- [User-facing description] (#[issue])

### QA Notes

[relevant tags]

[Simple test instructions]
```

### New Feature Template
```markdown
Addresses #[issue].

### Summary
[1-2 paragraphs explaining the feature]
[Technical implementation notes if relevant]
[Related PRs if applicable]

### Release Notes

#### New Features
- [User-facing description] (#[issue])

#### Bug Fixes
- N/A

### QA Notes

[relevant tags]

[Detailed test steps with code examples]
```

## Examples

### Example 1: Bug Fix PR
```markdown
Addresses #8930.

This PR fixes the Data Explorer scrollbars snapping back to 0 on Safari. The issue was caused by incorrect event handling in the virtual scrolling implementation.

### Release Notes

#### New Features
- N/A

#### Bug Fixes
- Fix Data Explorer scrollbars snapping back to 0 on Safari (#8930)

### QA Notes

@:data-explorer

Open a large data frame in Data Explorer on Safari and verify scrollbars can be dragged without snapping back.
```

### Example 2: New Feature PR
```markdown
Addresses #8484.

### Summary
Adds support for native DuckDB connections in the Connections Pane. Users can now inspect DuckDB databases directly without needing external tools. This implementation uses the native DuckDB Python API for better performance.

Related PR: posit-dev/ark#456 (adds DuckDB kernel support)

### Release Notes

#### New Features
- Added support for inspecting native DuckDB connections in the Connections Pane (#8484)

#### Bug Fixes
- N/A

### QA Notes

@:connections @:duck-db

1. Install DuckDB: `pip install duckdb`
2. Create a new DuckDB connection using the modal
3. Run the following to create test data:

```python
conn.execute("""
    CREATE TABLE employees (
        id INTEGER,
        name VARCHAR,
        salary INTEGER
    )
""")
conn.execute("INSERT INTO employees VALUES (1, 'Alice', 75000)")
```

4. Verify tables appear in the Connections pane
```

## Tips

- Be concise but complete - no flowery language
- Use present tense ("fixes", "adds", "enables")
- Include issue references in parentheses in release notes
- Always include at least one e2e test tag in QA notes
- For complex changes, numbered test steps are better
- Keep release notes user-facing (avoid implementation details)
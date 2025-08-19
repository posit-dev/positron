# PR Body Generator Template

You are helping create a PR body for the posit-dev/positron repository. Follow these guidelines:

## Context

You MUST use your github tool to look up the corresponding issue #$ARGUMENTS that this PR is addressing (if provided). Analyze the issue type and content to determine the appropriate PR structure.

## PR Type Detection

Based on the issue or user description, identify the PR type:
- **Bug Fix**: Fixing existing functionality
- **New Feature**: Adding new capabilities  
- **UI Change**: Modifying user interface elements
- **E2E/Test**: Adding or modifying tests
- **Maintenance**: Refactoring, dependencies, documentation
- **Performance**: Optimization improvements

## Structure

### 1. **Opening Line**
- If addressing an issue: "Addresses #[issue_number]." (note the period, correct spelling)
- If no issue: Brief statement of what the PR does

### 2. **Description/Summary**
Adapt based on PR type:
- **Simple fixes**: 2-3 sentences explaining the change
- **Complex changes**: Use "### Summary" or "### Description" header with:
  - What the PR does (1-2 paragraphs)
  - Technical context if needed
  - Related PRs if applicable (e.g., "Paired with posit-dev/ark#123")
  - Any important implementation details

### 3. **Screenshots/Demo** (Conditional)
Only include for UI changes:
- Add placeholder: `[Screenshot: Description of UI change]`
- For demos/videos: `[Demo video: Shows interaction with new feature]`
- Include actual GitHub attachments URL if provided: `https://github.com/user-attachments/assets/...`
- Skip entirely for non-UI changes

### 4. **Release Notes**
Structure:
```markdown
### Release Notes

#### New Features
- [User-facing description] (#issue_number if applicable)

#### Bug Fixes
- N/A
```

Guidelines:
- Only fill sections that apply
- Delete "N/A" for sections you fill in
- Keep other section with "N/A"
- Use brief, user-facing language
- Support keyboard shortcuts with `<kbd>` tags when relevant
- Include issue references in parentheses

### 5. **QA Notes**

Always include test tags and instructions:

```markdown
### QA Notes

[Relevant e2e test tags based on feature area - see list below]

[Testing instructions based on complexity:]
- Simple: Brief instruction and expected outcome
- Complex: Numbered steps with setup requirements

```[language]
[Runnable code example if applicable]
```
```

#### Available E2E Test Tags

Feature tags (use based on the area affected):
- `@:accessibility` - Accessibility features
- `@:apps` - Application functionality (Shiny, Dash, etc.)
- `@:ark` - Ark kernel related
- `@:assistant` - Positron Assistant
- `@:connections` - Database connections
- `@:console` - Console/REPL functionality
- `@:critical` - Critical functionality (use sparingly)
- `@:data-explorer` - Data Explorer/viewer
- `@:debug` - Debugging features
- `@:duck-db` - DuckDB specific
- `@:editor-action-bar` - Editor action bar
- `@:extensions` - Extension management
- `@:help` - Help system
- `@:html` - HTML rendering
- `@:inspect-ai` - Inspect AI features
- `@:interpreter` - Language interpreters
- `@:layouts` - Layout management
- `@:viewer` - Viewer pane
- `@:editor` - Code editor
- `@:quarto` - Quarto documents
- `@:modal` - Modal dialogs
- `@:new-folder-flow` - New folder creation
- `@:notebooks` - Jupyter notebooks
- `@:outline` - Code outline
- `@:output` - Output handling
- `@:plots` - Plots pane
- `@:problems` - Problems pane
- `@:publisher` - Publishing features
- `@:references` - Code references
- `@:r-markdown` - R Markdown
- `@:r-pkg-development` - R package development
- `@:reticulate` - Python/R integration
- `@:scm` - Source control
- `@:search` - Search functionality
- `@:sessions` - Session management
- `@:tasks` - Task runner
- `@:test-explorer` - Test explorer
- `@:top-action-bar` - Top action bar
- `@:variables` - Variables pane
- `@:welcome` - Welcome page
- `@:vscode-settings` - VS Code settings import

Platform tags (add if needed):
- `@:web` - Enable web platform testing
- `@:web-only` - Web-only functionality
- `@:win` - Enable Windows testing

Note: PRs run Linux/Electron tests by default. Add platform tags to enable additional platforms.

## Style Guidelines
- Technical but concise
- No flowery language or unnecessary context  
- Focus on what changed and how to verify it
- Use present tense for descriptions ("fixes", "adds", "enables")
- Reference e2e tests when they exist for the feature area

## Example Patterns by PR Type

### Bug Fix Example:
```
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

### New Feature Example:
```
Addresses #8484.

Adds support for native DuckDB connections in the Connections Pane. Users can now inspect DuckDB databases directly without needing external tools. This implementation uses the native DuckDB Python API for better performance.

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

## Initial Questions to Ask

Start by understanding the context:
1. "What issue number does this PR address (if any)?"
2. "What's the main problem being solved or feature being added?"
3. "Are there any UI changes that need screenshots?"
4. "Is this paired with PRs in other repos?"
5. "What's the best way to test this change?"

Then generate the appropriate PR body based on the PR type and provided information.

## Final Output Options

After generating the PR body, ask the user:

"I've generated the PR body. Would you like me to:
1. Copy it to your clipboard (Mac only)
2. Update an existing PR via the GitHub API
3. Just display it here

Which option would you prefer?"

### Option 1: Copy to Clipboard (Mac)
Use `pbcopy` command:
```bash
echo "[PR body content]" | pbcopy
```
Then confirm: "✓ PR body copied to clipboard. You can now paste it into GitHub."

### Option 2: Update Existing PR
If user chooses this option:
1. Ask: "What's the PR number you'd like to update?"
2. Use GitHub CLI to update:
```bash
gh pr edit [PR_NUMBER] --body "[PR body content]"
```
3. Confirm: "✓ Updated PR #[number] successfully."

### Option 3: Display Only
Simply show the formatted PR body in the chat for manual copying.
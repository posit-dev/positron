---
name: positron-notebooks
description: This skill should be used when developing, debugging, or maintaining Positron Notebooks - the React-based feature-flagged notebook editor. Load this skill when tasks involve notebook cells, execution, selection state, context keys, or notebook editor features.
---

# Positron Notebooks Development

## Purpose

Provides specialized knowledge and workflows for developing Positron Notebooks, a feature-flagged React-based notebook editor that coexists with VS Code's standard notebook experience.

## When to Use This Skill

Load this skill when working on:
- Notebook cell behavior (execution, rendering, editing)
- Selection and focus management
- Context key system for notebooks
- Cell action commands and menus
- Notebook-kernel integration
- Output rendering and webviews
- E2E or unit tests for notebooks
- Debugging notebook issues

## Quick Start

### Validate Setup Before Starting

```bash
# Run validation script
./scripts/validate_setup.sh
```

Or manually check:
```bash
# Verify build daemons are running (required)
ps aux | grep -E "npm.*watch-(client|extensions)d" | grep -v grep
```

### Enable Positron Notebooks for Testing

Add to settings.json:
```json
{
	"positron.notebook.enabled": true,
	"workbench.editorAssociations": {
		"*.ipynb": "workbench.editor.positronNotebook"
	}
}
```

Restart Positron after changing feature flag.

## Development Workflows

### Adding a New Cell Command

1. Register command in `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`
2. Add context key conditions (when-clauses)
3. Optionally add to menu or keybinding registry
4. Implement handler to access notebook instance and cells

See `references/common-patterns.md` for code examples.

### Fixing a Cell Execution Bug

1. Start debugging task in VS Code (F5)
2. Set breakpoint in `PositronNotebookInstance.ts:executeCell()`
3. Open notebook and trigger execution
4. Check:
   - Is kernel selected?
   - Is previous execution cancelled?
   - Are execution events firing?
   - Does runtime session exist?

See `references/debugging-guide.md` for detailed strategies.

### Debugging Selection/Focus Issues

1. Inspect context keys: Command Palette → "Developer: Inspect Context Keys"
2. Check selection machine state in `selectionMachine.ts`
3. Verify DOM focus with browser DevTools (`document.activeElement`)
4. Add logging to selection events and state transitions

See `references/debugging-guide.md` for common issues and solutions.

### Running Tests

```bash
# Run all notebook E2E tests
./scripts/test_notebooks.sh

# Run specific test
./scripts/test_notebooks.sh "cell execution"

# Or use Playwright directly
npx playwright test test/e2e/tests/notebook/<test-name>.test.ts --project e2e-electron --reporter list
```

### Searching Notebook Code

```bash
# Find code patterns
./scripts/find_notebook_code.sh "executeCell"
./scripts/find_notebook_code.sh "selectionMachine"
```

## Core Files to Know

**Primary entry point:**
- `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts` - Command registration, editor resolver

**Central logic:**
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts` - Most non-UI logic, state management

**React UI:**
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor.tsx` - Root component
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/` - Cell components

**State systems:**
- `src/vs/workbench/contrib/positronNotebook/browser/selectionMachine.ts` - Selection FSM
- `src/vs/workbench/contrib/positronNotebook/browser/ContextKeysManager.ts` - Context keys

**Cell models:**
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/` - Cell implementations

## Key Architecture Principles

1. **Feature-flagged** - Coexists with VS Code notebooks, feature flag required
2. **Observable-based** - React UI driven by VS Code observables
3. **Shared infrastructure** - Reuses VS Code's notebook models, kernels, execution
4. **One webview per output** - Each output gets its own webview (vs single webview)
5. **Context key scoped** - Cell context keys scoped to cell DOM subtree

## Progressive Documentation

For detailed information, read the bundled reference docs:

- **`references/architecture.md`** - Component details, integration points, execution flow
- **`references/debugging-guide.md`** - Debugging strategies, common issues, testing workflows
- **`references/common-patterns.md`** - Code examples for commands, observables, React components

Full architecture document available at:
`src/vs/workbench/contrib/positronNotebook/docs/positron_notebooks_architecture.md`

## Helper Scripts

Located in `scripts/`:

- **`validate_setup.sh`** - Check build daemons and file paths
- **`test_notebooks.sh`** - Run notebook E2E tests with optional pattern
- **`find_notebook_code.sh`** - Search for code patterns in notebook files

## Common Tasks

### Task: Add execution status indicator to cell
**Steps:**
1. Read `references/common-patterns.md` for observable patterns
2. Add state observable to cell model
3. Create React component consuming observable
4. Integrate into cell component tree

### Task: Fix context keys not updating
**Steps:**
1. Read `references/debugging-guide.md` for context key issues
2. Check `ContextKeysManager.ts` for key setting logic
3. Verify scoping (cell-level keys scoped to cell DOM)
4. Use "Inspect Context Keys" to validate

### Task: Debug cell not executing
**Steps:**
1. Read `references/debugging-guide.md` for execution debugging
2. Use VS Code debug task (F5) with breakpoints
3. Check kernel selection, runtime session, execution service
4. Monitor execution state changes via log service

### Task: Understand selection state machine
**Steps:**
1. Read `references/architecture.md` for selection FSM overview
2. Check `selectionMachine.ts` for states and transitions
3. Add logging to transitions
4. Test selection events in debugger

## Important Constraints

- **Upstream compatibility**: Prefer new files over modifying existing VS Code files
- **Feature flag respect**: Check `usingPositronNotebooks()` when needed
- **No virtualization**: All cells render (performance consideration for large notebooks)
- **Webview lifecycle**: Each output has own webview, coordinate mounting carefully

## Self-Maintenance

### Update Triggers

Update this skill when encountering:
- File paths that don't exist → Search for new location, update paths
- New patterns discovered → Add to `references/common-patterns.md`
- Bug fixes revealing insights → Add to `references/debugging-guide.md`
- Architecture changes → Update `references/architecture.md` and main doc

### Update Process

1. Identify what changed (path, pattern, bug fix, architecture)
2. Update relevant file (SKILL.md or references/)
3. Verify all file paths still exist with `./scripts/validate_setup.sh`
4. If architecture-significant, also update:
   `src/vs/workbench/contrib/positronNotebook/docs/positron_notebooks_architecture.md`

### Path Validation

Before using any file path from this skill:
```bash
# Verify path exists
ls -la <path-from-skill>

# If wrong, search for correct location
find . -name "<filename>" | grep -v node_modules
```

Update skill with corrected path and add note about change.

## Getting Help

For deeper understanding:
1. Start with relevant reference doc (`references/`)
2. Check main architecture doc (`docs/positron_notebooks_architecture.md`)
3. Use helper scripts for validation and searching
4. Set breakpoints and use VS Code debugging

This skill maintains lean, procedural guidance. Detailed technical information lives in progressive disclosure layers (references/ and main architecture doc).

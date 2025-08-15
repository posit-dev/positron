# Positron Development Context

This is the main coordination file for Claude Code when working on Positron. Based on your specific task, include the appropriate modular context file(s) from `dev_prompts/`.

## Project Overview

Positron is a next-generation data science IDE built on VS Code, designed for Python and R development with enhanced data science workflows.

## Using Modular Prompts

To work effectively on specific areas of Positron, ask Claude to include relevant context files:

- **E2E Testing**: `Please read .claude/e2e-testing.md` - For working with Playwright end-to-end tests
- **Extensions**: `Please read .claude/extensions.md` - For Positron-specific extensions development  
- **Data Explorer**: `Please read .claude/data-explorer.md` - For data viewing and exploration features
- **DuckDB Extension**: `Please read .claude/positron-duckdb.md` - For positron-duckdb extension development
- **Console/REPL**: `Please read .claude/console.md` - For console and REPL functionality
- **Notebooks**: `Please read .claude/notebooks.md` - For Jupyter notebook integration
- **Language Support**: `Please read .claude/language-support.md` - For Python/R language features
- **UI Components**: `Please read .claude/ui-components.md` - For Positron-specific UI development
- **Backend Services**: `Please read .claude/backend.md` - For kernel and service integration
- **Build System**: `Please read .claude/build.md` - For build, packaging, and deployment

## Quick Start Commands

### Development
```bash
# Build the application
npm run compile

# Run in development mode  
npm run watch

# Run tests
npm test
```

### Code Formatting

**🚨 CRITICAL: DO NOT USE PRETTIER**

Positron uses VSCode's built-in TypeScript formatter, not Prettier. Using Prettier will create formatting conflicts that are very difficult to resolve.

**Correct way to format files:**
```bash
# Format specific TypeScript/JavaScript files using the project's formatter script
node scripts/format.js <file1> [file2] [file3] ...

# Examples:
node scripts/format.js src/vs/workbench/contrib/positronDataExplorer/browser/positronDataExplorer.tsx
node scripts/format.js src/vs/workbench/services/positronDataExplorer/common/tableSummaryCache.ts

# Format multiple files at once:
node scripts/format.js file1.ts file2.tsx file3.js
```

**This script uses TypeScript's built-in formatter - the exact same formatter used by the pre-commit hook.**

**Project formatting rules:**
- Uses **tabs** (not spaces)  
- Uses **single quotes**
- Inserts final newlines
- VSCode's TypeScript formatter handles all formatting
- ESLint with `@stylistic/eslint-plugin-ts` provides additional style rules

**Never use:**
- `prettier` or `npx prettier` commands
- `npm run eslint` (runs on entire codebase, too broad)
- Any other third-party formatters

When editing files, format them with `node scripts/format.js <file_path>` to match the project's formatting standards exactly.

### Testing
```bash
# Run specific e2e test
npx playwright test <test-name>.test.ts --project e2e-electron --reporter list

# Run all tests in a category
npx playwright test test/e2e/tests/<category>/

# Show test report
npx playwright show-report
```

## 🚨 CRITICAL: Code Organization for Upstream Compatibility

**This section is extremely important. Failure to follow these rules will cause significant merge conflicts and maintenance burden.**

Positron is a fork of VSCode that maintains compatibility with upstream changes. To facilitate clean merges and updates from the original VSCode repository, you MUST follow these strict code organization patterns.

### Core Principle
**Minimize merge conflicts** by isolating Positron-specific code from upstream VSCode code.

### Code Contribution Rules

#### 1. Always Prefer New Files
Create new files for Positron-specific functionality whenever possible:
- New features should live in separate files
- Use clear naming conventions (e.g., `feature.positron.ts`, `component.positron.tsx`)
- Import and integrate with existing code through minimal touchpoints

#### 2. Modify Existing Files Only When Absolutely Necessary
When you must modify upstream VSCode files:

```typescript
// --- Start Positron ---
// Your Positron-specific code here
// Keep all related changes together
// --- End Positron ---
```

**Requirements:**
- Use exact comment format: `// --- Start Positron ---` and `// --- End Positron ---`
- Keep modifications as contiguous as possible (no scattered changes)
- Add descriptive comments explaining why the modification is necessary
- Minimize the footprint of changes

**Remember:** Every line of code in an upstream file increases merge complexity. Always ask: "Can this live in a separate file instead?"

### Naming Conventions

#### Workbench Contributions
- **Prefix:** Always start with `positron`
- **Style:** camelCase after prefix
- **Examples:** `positronConsole`, `positronDataViewer`, `positronNotebook`

#### Extensions
- **Prefix:** Always start with `positron-`
- **Style:** kebab-case after prefix  
- **Examples:** `positron-python`, `positron-connections`, `positron-run-app`

#### Files and Components
- **TypeScript files:** camelCase (`dataExplorer.ts`)
- **React components:** PascalCase (`DataExplorerPanel.tsx`)
- **Test files:** Match source with `.test.ts` suffix

## GitHub Integration

### Working with Issues and PRs
When discussing or working with GitHub issues and pull requests, always use the `gh` CLI tool for interaction:

```bash
# View PR details
gh pr view 1234

# View PR with comments
gh pr view 1234 --comments

# View PR diff
gh pr diff 1234

# View issue details
gh issue view 1234

# List current PRs
gh pr list

# List current issues
gh issue list
```

This ensures consistent, scriptable access to GitHub data and integrates well with Claude Code workflows.

## Architecture Notes

- Built on VS Code architecture with Positron-specific enhancements
- Electron-based desktop application with web version support
- Extension-based architecture for language support and features
- WebView-based UI components for data science workflows
- Kernel-based execution for Python and R interpreters

## Directory Structure

- `src/` - Core VS Code source with Positron modifications
- `extensions/` - Built-in extensions including Positron-specific ones
- `test/e2e/` - End-to-end Playwright tests
- `positron/` - Positron-specific code and assets
- `build/` - Build configuration and scripts

Remember to read the appropriate modular prompt file(s) for your specific task area.
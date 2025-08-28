# Positron Development Context

This is the main coordination file for Claude Code when working on Positron. Based on your specific task, include the appropriate modular context file(s) from `dev_prompts/`.

## Project Overview

Positron is a next-generation data science IDE built on VS Code, designed for Python and R development with enhanced data science workflows.

## 🚨 CRITICAL: Development Startup

**ALWAYS read `.claude/build-system.md` before launching Positron!**
This file contains critical instructions for ensuring build daemons are running. Never skip this step.

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
- **Build System**: `Please read .claude/build-system.md` - For build, packaging, and deployment

## Quick Start Commands

### Development
```bash
# STEP 1: Check if daemons are already running
ps aux | grep -E "npm.*watch-(client|extensions|e2e)d" | grep -v grep

# STEP 2: If NOT running, start build daemons (CRITICAL: Wait for completion!)
npm run watch-clientd &     # Core compilation daemon
npm run watch-extensionsd & # Extensions compilation daemon
# Optional: npm run watch-e2ed & # E2E tests daemon (only if doing E2E testing)

# STEP 3: Wait for initial compilation (30-60 seconds)
sleep 30

# STEP 4: Launch Positron (ONLY after daemons are confirmed running)
# On macOS/Linux:
./scripts/code.sh &
# On Windows:
start ./scripts/code.bat

# STEP 5: Verify Positron launched successfully
# On macOS/Linux:
sleep 10 && ps aux | grep -i "positron\|code" | grep -v grep
# On Windows:
timeout /t 10 /nobreak >nul && tasklist | findstr /i "positron electron"

# Run tests (after Positron is running)
npm test

# Shutdown build daemons
# On macOS/Linux:
pkill -f "gulp watch-client" && pkill -f "gulp watch-extensions" && pkill -f "deemon" && pkill -f "npm run watch"
# On Windows:
taskkill /F /IM node.exe /FI "WINDOWTITLE eq *watch*"
```

### Code Formatting & Linting

**AUTOMATIC FORMATTING ENABLED**

This project has a Claude Code hook configured that automatically handles most code formatting after every file edit.

**Project formatting rules:**
- Uses **tabs** (not spaces)
- Uses **single quotes**
- Inserts final newlines

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

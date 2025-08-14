# Positron Development Context

This is the main coordination file for Claude Code when working on Positron. Based on your specific task, include the appropriate modular context file(s) from `dev_prompts/`.

## Project Overview

Positron is a next-generation data science IDE built on VS Code, designed for Python and R development with enhanced data science workflows.

## Using Modular Prompts

To work effectively on specific areas of Positron, ask Claude to include relevant context files:

- **E2E Testing**: `Please read dev_prompts/E2E_TESTS.md` - For working with Playwright end-to-end tests
- **Extensions**: `Please read dev_prompts/EXTENSIONS.md` - For Positron-specific extensions development  
- **Data Explorer**: `Please read dev_prompts/DATA_EXPLORER.md` - For data viewing and exploration features
- **Console/REPL**: `Please read dev_prompts/CONSOLE.md` - For console and REPL functionality
- **Notebooks**: `Please read dev_prompts/NOTEBOOKS.md` - For Jupyter notebook integration
- **Language Support**: `Please read dev_prompts/LANGUAGE_SUPPORT.md` - For Python/R language features
- **UI Components**: `Please read dev_prompts/UI_COMPONENTS.md` - For Positron-specific UI development
- **Backend Services**: `Please read dev_prompts/BACKEND.md` - For kernel and service integration
- **Build System**: `Please read dev_prompts/BUILD.md` - For build, packaging, and deployment

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

### Testing
```bash
# Run specific e2e test
npx playwright test <test-name>.test.ts --project e2e-electron --reporter list

# Run all tests in a category
npx playwright test test/e2e/tests/<category>/

# Show test report
npx playwright show-report
```

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
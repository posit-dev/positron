# Julia E2E Testing Backlog

This document tracks end-to-end tests needed for the Julia extension. These tests should be implemented as Playwright tests in `test/e2e/tests/`.

## Priority 1: Core Functionality

### Session Management
- [ ] **Start Julia session** - Start a Julia runtime from the interpreter picker
- [ ] **Session restart** - Restart Julia session via console action bar
- [ ] **Session shutdown** - Shutdown Julia session cleanly
- [ ] **Session reconnect after reload** - Julia session persists and reconnects after Command-R reload
  - Note: Similar test exists for Python/R but is currently skipped (issue #6843)
- [ ] **Multiple Julia sessions** - Start multiple Julia sessions simultaneously

### Console
- [ ] **Basic console input/output** - Execute code and verify output
- [ ] **Console history** - Up/down arrow navigation through history
- [ ] **Multi-line input** - Enter and execute multi-line code blocks
- [ ] **Console interrupt** - Ctrl+C interrupts running code
- [ ] **ANSI color output** - Colored output displays correctly

### Code Execution
- [ ] **Execute selection** - Run selected code from editor
- [ ] **Execute file** - Run entire Julia file
- [ ] **Execute cell** - Run code cell (## delimited)

## Priority 2: Language Features

### Tab Completion / IntelliSense
- [ ] **Function completion** - Tab completion for function names
- [ ] **Module completion** - Completion for module members (e.g., `Base.`)
- [ ] **Argument completion** - Function argument hints
- [ ] **Package completion** - Completion for installed packages

### Diagnostics
- [ ] **Syntax errors** - Red squiggles for syntax errors
- [ ] **Undefined variables** - Warnings for undefined references

### Help
- [ ] **F1 help** - F1 on symbol shows documentation
- [ ] **Help panel** - Help displays in help panel

## Priority 3: Data Science Features

### Variables Pane
- [ ] **Variable display** - Variables show in Variables pane
- [ ] **Variable types** - Correct type display for Julia types
- [ ] **Variable expansion** - Expand complex types (structs, arrays)
- [ ] **DataFrame display** - DataFrames show with preview

### Data Explorer
- [ ] **Open DataFrame** - Click DataFrame opens in Data Explorer
- [ ] **DataFrame operations** - Sort, filter, search columns
- [ ] **Large data** - Handle large DataFrames efficiently

### Plots
- [ ] **Basic plot** - Plots display in Plots pane
- [ ] **Plot history** - Multiple plots accessible in history
- [ ] **Plot export** - Export plot to file

## Priority 4: Advanced Features

### Debugging
- [ ] **Breakpoints** - Set and hit breakpoints
- [ ] **Step through** - Step over/into/out
- [ ] **Variable inspection** - Inspect variables during debug

### Notebooks
- [ ] **Julia notebook** - Create and run Julia notebook
- [ ] **Notebook kernel** - Julia kernel works in notebooks

### Connections
- [ ] **Database connections** - Connect to databases from Julia

## Implementation Notes

- Tests should be placed in `test/e2e/tests/julia/` directory
- Use existing page objects from `test/e2e/pages/` where possible
- Tag tests appropriately: `tags.JULIA`, `tags.CONSOLE`, etc.
- Consider creating Julia-specific fixtures for common setup

## Related Tests to Reference

- `test/e2e/tests/sessions/session-mgmt.test.ts` - Session management patterns
- `test/e2e/tests/console/console-python.test.ts` - Console testing patterns
- `test/e2e/tests/console/console-r.test.ts` - R console tests
- `test/e2e/tests/interpreters/` - Interpreter/runtime tests

## Current Status

Last updated: 2025-12-13

Features implemented but not yet E2E tested:
- Runtime discovery (juliaup, PATH, standard locations)
- Session start/stop/restart
- Session reconnection after reload
- Basic console execution via IJulia

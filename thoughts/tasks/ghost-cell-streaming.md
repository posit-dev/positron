# Task: Ghost Cell Streaming

**Status:** in-progress
**Last Updated:** 2026-02-02 (added pull mode)
**Branch:** positron-nb-ghost-suggestions

## Context for Claude

When working with this task, keep this file updated:
- **Current State**: Update when features/components are completed
- **Decisions Made**: Add when you choose between approaches (include why)
- **Key Files**: Add files you discover that are central but weren't listed
- **Gap detection**: If you had to look something up that should have been documented here, add it immediately

Keep updates concise--bullet points, not paragraphs.

## Overview
Wire up streaming infrastructure for ghost cell suggestions so code appears progressively during LLM generation instead of all at once after completion.

## Key Files
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts` - Workbench side: registers callback command and passes to extension
- `src/vs/workbench/contrib/positronNotebook/browser/IPositronNotebookInstance.ts` - GhostCellState type (includes 'streaming', 'opt-in-prompt', 'awaiting-request' status)
- `src/vs/workbench/contrib/positronNotebook/common/positronNotebookConfig.ts` - Settings definitions (ghostCellSuggestions, hasOptedIn, delay, mode)
- `src/vs/workbench/contrib/positronNotebook/common/notebookAssistantMetadata.ts` - Workbench-side per-notebook metadata (showDiff, autoFollow, ghostCellSuggestions, suggestionMode)
- `extensions/positron-assistant/src/extension.ts` - Extension side: accepts progressCallbackCommand parameter
- `extensions/positron-assistant/src/ghostCellSuggestions.ts` - Calls onProgress with partial code chunks
- `extensions/positron-assistant/src/notebookAssistantMetadata.ts` - Extension-side resolution of ghost cell settings
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/GhostCell.tsx` - UI component for ghost cell (includes opt-in prompt, awaiting-request)
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/GhostCell.css` - Ghost cell styling
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/GhostCellInfoModalDialog.tsx` - Info modal about ghost cells
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/GhostCellInfoModalDialog.css` - Info modal styling
- `src/vs/workbench/contrib/positronNotebook/browser/utilityComponents/SplitButton.tsx` - Reusable split button component
- `src/vs/workbench/contrib/positronNotebook/browser/ContextKeysManager.ts` - Context keys including POSITRON_NOTEBOOK_GHOST_CELL_AWAITING_REQUEST
- `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts` - Keybindings and actions registration

## Decisions Made
- Follow existing pattern from AssistantPanelActions.tsx (lines 140-186) for streaming
- Use CommandsRegistry.registerCommand with unique UUID for callback
- Dispose callback in both .then() and .catch() handlers
- State transitions: loading → streaming (partial content) → ready (final)
- "Accept and Run" is the default action (most common use case)
- "Don't suggest again" disables ghost cells globally via user settings
- **Opt-in flow:** Ghost cell suggestions are opt-in (not enabled by default) because they use LLM tokens without explicit consent
- Two settings: `ghostCellSuggestions` (enabled/disabled) and `hasOptedIn` (whether user has made a choice)
- Per-notebook override in metadata still takes precedence over global settings
- "Not now" dismissal is session-only (in-memory flag), resets on notebook reopen
- **Pull mode:** Added 'pull' mode as opt-in alternative to automatic 'push' suggestions
  - Default mode is 'push' (automatic) - pull is opt-in via settings
  - Button label: "Get Suggestion"
  - Keyboard shortcut: Cmd/Ctrl+Shift+G
  - Placeholder uses same delay as push mode (waits before showing awaiting-request state)

## Current State
**Done:**
- Added imports (CommandsRegistry, generateUuid) to PositronNotebookInstance.ts
- Implemented callback command registration in triggerGhostCellSuggestion()
- Pass callbackCommandId to extension instead of undefined
- Proper cleanup of callback disposable
- Only trigger ghost cells after successful executions (check `cell.lastRunSuccess.get() === true`)
- **Split button UI for Accept/Dismiss actions:**
  - Created reusable `SplitButton` component in `utilityComponents/SplitButton.tsx`
  - Accept button: Main action is "Accept and Run", dropdown shows "Accept" (insert without running)
  - Dismiss button: Main action is "Dismiss", dropdown shows "Don't suggest again" (disables globally)
  - Added `disableGhostCellSuggestions()` method to instance (updates `positron.assistant.notebook.ghostCellSuggestions` setting)
  - Refactored `NotebookCellQuickFix` to also use shared `SplitButton` component (code reuse)
- **Opt-in flow for ghost cell suggestions:**
  - Added `hasOptedIn` setting (default: false) to track whether user has made a choice
  - Changed `ghostCellSuggestions` default from true to false
  - Added `opt-in-prompt` state to GhostCellState type
  - Created `GhostCellOptInPrompt` component with Enable/Not now/Don't ask again buttons
  - Uses Positron `Button` component for consistent styling
  - "Learn more" link at end of prompt text opens ghost cell info modal (link-styled button for accessibility)
  - Added `_shouldShowOptInPrompt()` and `_optInDismissedThisOpen` for prompt logic
  - Added `enableGhostCellSuggestions()` and `dismissOptInPrompt()` methods
  - Updated extension-side `resolveGhostCellSuggestions()` to check hasOptedIn

- **Fixed opt-in "Enable" button not persisting settings:**
  - Root cause: async/await pattern broke config persistence (fire-and-forget works, await didn't)
  - Added `_enabledThisSession` session flag for immediate effect while config propagates
  - Reverted `enableGhostCellSuggestions()` to sync fire-and-forget (matches `disableGhostCellSuggestions`)
  - Session flag checked in `_isGhostCellEnabled()` and `_shouldShowOptInPrompt()`

- **Improved settings link UX in info modal:**
  - Made setting name an inline clickable link (following CellTextOutput.tsx pattern)
  - Removed separate gear icon button - setting name itself is now the link
  - Uses monospace font to indicate it's a setting identifier

- **Pull mode for ghost cell suggestions:**
  - Added `'awaiting-request'` status to GhostCellState type
  - Added `requestGhostCellSuggestion()` method to interface and instance
  - Added `POSITRON_NOTEBOOK_GHOST_CELL_MODE_KEY` setting with enum `['push', 'pull']`, default `'push'`
  - Added `SuggestionModeOverride` type for per-notebook override (`'push' | 'pull' | undefined`)
  - Added `suggestionMode` field to AssistantSettings in both workbench and extension metadata files
  - Added `_getSuggestionMode()` helper to check per-notebook override then global setting
  - Modified `_scheduleGhostCellSuggestion()` to set 'awaiting-request' state for pull mode
  - Created `GhostCellAwaitingRequest` component with "Get Suggestion" and "Dismiss" buttons
  - Added CSS for `.ghost-cell-awaiting-request` and related classes
  - Added `POSITRON_NOTEBOOK_GHOST_CELL_AWAITING_REQUEST` context key
  - Added keyboard shortcut Cmd/Ctrl+Shift+G for requesting suggestion (only active when awaiting-request)
  - Context key updates automatically via subscription to ghost cell state changes

**Next:**
- Test end-to-end streaming behavior
- Test opt-in flow (fresh user, enable, not now, don't ask again)
- Test pull mode flow:
  - Change setting to 'pull', execute cell, verify placeholder appears
  - Click "Get Suggestion" button, verify loading then suggestion
  - Test Cmd/Ctrl+Shift+G keyboard shortcut
  - Test per-notebook override via metadata
- Verify UI handles all states correctly
- Come up with a clear pattern for what model is being used and letting the user know what it is an how to configure it.
- Address issues as they emerge during testing

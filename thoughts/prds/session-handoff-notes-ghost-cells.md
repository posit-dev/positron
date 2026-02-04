# Handoff: Notebook Ghost Cell Suggestions Feature

## Overview
I just implemented a "ghost cell" feature for Positron Notebooks that suggests a logical next cell after successful code execution. The ghost cell appears with AI-generated code suggestions that users can Accept, Dismiss, or Regenerate.

## PRD Location
`thoughts/prds/notebook-ghost-cell-suggestions.md`

## Files Created/Modified

### New Files
- `extensions/positron-assistant/src/md/prompts/notebook/ghost-cell.md` - LLM prompt template
- `extensions/positron-assistant/src/ghostCellSuggestions.ts` - LLM suggestion generation with streaming
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/GhostCell.tsx` - React component
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/GhostCell.css` - Styling

### Modified Files
- `src/vs/workbench/contrib/positronNotebook/common/positronNotebookConfig.ts` - Added global setting
- `src/vs/workbench/contrib/positronNotebook/common/notebookAssistantMetadata.ts` - Added per-notebook override
- `extensions/positron-assistant/src/notebookAssistantMetadata.ts` - Added per-notebook override (extension side)
- `extensions/positron-assistant/src/extension.ts` - Registered command
- `src/vs/workbench/contrib/positronNotebook/browser/IPositronNotebookInstance.ts` - Added GhostCellState type and interface methods
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts` - Implemented ghost cell logic
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookComponent.tsx` - Integrated GhostCell component
- `src/vs/workbench/contrib/positronNotebook/browser/AssistantPanel/AssistantPanel.tsx` - Added settings toggle

## Architecture

### Flow
1. User executes a code cell successfully
2. `PositronNotebookInstance` listens to `notebookExecutionStateService.onDidChangeExecution`
3. On completion, `_scheduleGhostCellSuggestion()` starts a 3-second debounce timer
4. `triggerGhostCellSuggestion()` calls the extension command `positron-assistant.generateGhostCellSuggestion`
5. Extension uses LLM to generate suggestion based on executed cell + output + context
6. Result updates `ghostCellState` observable
7. `GhostCell` React component renders based on state (loading → streaming → ready)

### State Machine
```typescript
type GhostCellState =
  | { status: 'hidden' }
  | { status: 'loading'; executedCellIndex: number }
  | { status: 'streaming'; executedCellIndex: number; code: string; explanation: string }
  | { status: 'ready'; executedCellIndex: number; code: string; explanation: string; language: string }
  | { status: 'error'; executedCellIndex: number; message: string };
```

## Known Rough Edges / TODOs


6. **Error state styling**: Error state auto-dismisses after 5 seconds but could use better visual treatment

7. **No tests**: Unit tests and E2E tests mentioned in plan but not implemented

## Key Patterns Used

- Observable state with `observableValue` from `base/common/observable.js`
- React hook `useObservedValue` to consume observables
- `StreamingTagLexer` for parsing XML responses from LLM
- Per-notebook metadata overrides via `metadata.positron.assistant.*`
- ActionButton component for consistent button styling

## Testing the Feature

1. Enable Positron Notebooks: `positron.notebook.enabled: true`
2. Open a Jupyter notebook
3. Execute a code cell (e.g., `import pandas as pd; df = pd.DataFrame({'a': [1,2,3]})`)
4. Wait 3+ seconds after execution
5. Ghost cell should appear below with a suggestion

Settings:
- Global: `positron.assistant.notebook.ghostCellSuggestions` (default: true)
- Per-notebook: Toggle in Assistant Panel or via notebook metadata

# Fix Cmd+Shift+G keyboard shortcut for ghost cell suggestions

- Branch: `nick/ghost-cell-keyboard-shortcut-fix`
- Status: **Implemented** -- Fix committed (`0c38761de8`). Closes #12024.

## Problem

The keyboard shortcut Cmd+Shift+G to manually trigger a ghost cell suggestion in
Positron notebooks did not work. Two separate issues prevented it from firing.

## Root causes

### 1. Keybinding weight too low

The keybinding weight was `KeybindingWeight.EditorContrib` (100), which is lower
than the built-in `editor.action.announceCursorPosition` binding at
`KeybindingWeight.WorkbenchContrib + 10` (210). The built-in action always won
the conflict for Cmd+Shift+G.

### 2. Unreliable `when` clause

The original `when` clause used only `POSITRON_NOTEBOOK_EDITOR_FOCUSED` (DOM
focus tracking from `ContextKeysManager`), which alone was insufficient -- the
shortcut also needed an active-editor check. Additionally, earlier iterations
required `POSITRON_NOTEBOOK_GHOST_CELL_AWAITING_REQUEST`, meaning the shortcut
only fired in the narrow `awaiting-request` state that users rarely reached
organically. The `opt-in-prompt` state was also unhandled, so users who hadn't
yet opted in couldn't use the shortcut to accept.

## Fix (implemented)

Two changes across two files:

1. **`actions.ts`** -- Two keybinding fixes:
   - Changed `when` clause to require all three conditions:
     `POSITRON_NOTEBOOK_IS_ACTIVE_EDITOR` AND
     `POSITRON_NOTEBOOK_EDITOR_FOCUSED` (DOM focus within notebook) AND
     `POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.negate()`.
     The active-editor check uses
     `ContextKeyExpr.equals('activeEditor', 'workbench.editor.positronNotebook')`,
     matching the pattern used by `SelectPositronNotebookKernelAction`.
     `POSITRON_NOTEBOOK_EDITOR_FOCUSED` ensures DOM focus is actually inside the
     notebook (prevents firing when focus is in the terminal or other panels).
     The cell editor negation prevents the shortcut from stealing Cmd+Shift+G
     (Find Previous) when a cell editor is focused. Imports both
     `POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED` and
     `POSITRON_NOTEBOOK_EDITOR_FOCUSED` from `ContextKeysManager`.
   - Raised weight to `KeybindingWeight.WorkbenchContrib + 50` to beat the
     built-in `editor.action.announceCursorPosition` (WorkbenchContrib + 10).

2. **`controller.ts`** (`requestGhostCellSuggestion`) -- Rewrote the method to
   work from any state instead of only `awaiting-request`:
   - Clears any pending debounce/error timers before proceeding so they cannot
     overwrite the state after a manual trigger.
   - If `opt-in-prompt`, treats the shortcut as the user opting in by calling
     `enableGhostCellSuggestions()` and returns early.
   - If `loading` or `streaming`, the request is ignored (don't interrupt).
   - If in a non-hidden state (`awaiting-request`, `showing`, `error`), reuses
     the existing `executedCellIndex`.
   - If `hidden`, finds the last code cell in the notebook and uses its index.
   - If no code cell exists, returns early.

## Key files

- `src/vs/workbench/contrib/positronNotebook/browser/contrib/ghostCell/actions.ts`
- `src/vs/workbench/contrib/positronNotebook/browser/contrib/ghostCell/controller.ts`

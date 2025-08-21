# Phase 2: Command Registration and Keybindings

## Objective
Register clipboard commands and keyboard shortcuts for Positron notebooks, making the clipboard functionality accessible to users through standard keyboard interactions and the command palette.

## Background Context

### Current Command Registration Pattern
Positron notebooks use a helper function `registerNotebookKeybinding()` in `positronNotebook.contribution.ts` that:
- Registers commands with `KeybindingsRegistry`
- Ensures commands only run when Positron notebook is focused
- Accesses the active notebook instance via `IPositronNotebookService`

### VSCode Reference
VSCode registers notebook clipboard commands as actions with:
- Command IDs like `notebook.cell.copy`, `notebook.cell.cut`, `notebook.cell.paste`
- Standard keybindings (Ctrl/Cmd+C/X/V)
- Context key conditions for enablement

## Implementation Tasks

### Task 1: Define Command IDs and Metadata

**File**: `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`

Add command ID constants at the top of the keybindings section:

```typescript
//#region Clipboard Commands
const POSITRON_NOTEBOOK_COPY_CELLS = 'positronNotebook.copyCells';
const POSITRON_NOTEBOOK_CUT_CELLS = 'positronNotebook.cutCells';
const POSITRON_NOTEBOOK_PASTE_CELLS = 'positronNotebook.pasteCells';
const POSITRON_NOTEBOOK_PASTE_CELLS_ABOVE = 'positronNotebook.pasteCellsAbove';
//#endregion Clipboard Commands
```

### Task 2: Register Copy Command

**File**: `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`

Add after existing keybinding registrations:

```typescript
// Copy cells command
registerNotebookKeybinding({
    id: POSITRON_NOTEBOOK_COPY_CELLS,
    primary: KeyMod.CtrlCmd | KeyCode.KeyC,
    mac: {
        primary: KeyMod.CtrlCmd | KeyCode.KeyC,
    },
    onRun: ({ activeNotebook }) => {
        activeNotebook.copyCells();
    }
});
```

### Task 3: Register Cut Command

```typescript
// Cut cells command
registerNotebookKeybinding({
    id: POSITRON_NOTEBOOK_CUT_CELLS,
    primary: KeyMod.CtrlCmd | KeyCode.KeyX,
    mac: {
        primary: KeyMod.CtrlCmd | KeyCode.KeyX,
    },
    onRun: ({ activeNotebook }) => {
        // Only allow cut if notebook is editable
        if (!activeNotebook.isReadOnly) {
            activeNotebook.cutCells();
        }
    }
});
```

### Task 4: Register Paste Commands

```typescript
// Paste cells command
registerNotebookKeybinding({
    id: POSITRON_NOTEBOOK_PASTE_CELLS,
    primary: KeyMod.CtrlCmd | KeyCode.KeyV,
    win: {
        primary: KeyMod.CtrlCmd | KeyCode.KeyV,
        secondary: [KeyMod.Shift | KeyCode.Insert]
    },
    linux: {
        primary: KeyMod.CtrlCmd | KeyCode.KeyV,
        secondary: [KeyMod.Shift | KeyCode.Insert]
    },
    mac: {
        primary: KeyMod.CtrlCmd | KeyCode.KeyV,
    },
    onRun: ({ activeNotebook }) => {
        // Only allow paste if notebook is editable and clipboard has content
        if (!activeNotebook.isReadOnly && activeNotebook.canPaste()) {
            activeNotebook.pasteCells();
        }
    }
});

// Paste cells above command
registerNotebookKeybinding({
    id: POSITRON_NOTEBOOK_PASTE_CELLS_ABOVE,
    primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
    onRun: ({ activeNotebook }) => {
        // Only allow paste if notebook is editable and clipboard has content
        if (!activeNotebook.isReadOnly && activeNotebook.canPaste()) {
            activeNotebook.pasteCellsAbove();
        }
    }
});
```

### Task 5: Add Read-Only State to Instance

**File**: `src/vs/workbench/services/positronNotebook/browser/IPositronNotebookInstance.ts`

Add property to interface:

```typescript
/**
 * Indicates whether this notebook is read-only and cannot be edited.
 */
readonly isReadOnly: boolean;
```

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`

⚠️ **IMPLEMENTATION NOTE**: The final implementation uses `_creationOptions?.isReadOnly` instead of checking the text model, as the Positron notebook text model system doesn't expose `isReadOnly()` method.

Implement the property:

```typescript
get isReadOnly(): boolean {
    return this._creationOptions?.isReadOnly ?? false;
}
```

### Task 6: Register Commands with Command Service (Optional Enhancement)

For better integration with the command palette and extensions, also register with the command service:

**File**: `src/vs/workbench/contrib/positronNotebook/browser/positronNotebookCommands.ts` (new file)

```typescript
import { localize } from '../../../../nls.js';
import { ICommandService, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IPositronNotebookService } from '../../../services/positronNotebook/browser/positronNotebookService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';

// Register copy command
CommandsRegistry.registerCommand({
    id: 'positronNotebook.copyCells',
    handler: (accessor: ServicesAccessor) => {
        const notebookService = accessor.get(IPositronNotebookService);
        const activeNotebook = notebookService.getActiveInstance();
        if (activeNotebook) {
            activeNotebook.copyCells();
        }
    }
});

// Register cut command
CommandsRegistry.registerCommand({
    id: 'positronNotebook.cutCells',
    handler: (accessor: ServicesAccessor) => {
        const notebookService = accessor.get(IPositronNotebookService);
        const activeNotebook = notebookService.getActiveInstance();
        if (activeNotebook && !activeNotebook.isReadOnly) {
            activeNotebook.cutCells();
        }
    }
});

// Register paste command
CommandsRegistry.registerCommand({
    id: 'positronNotebook.pasteCells',
    handler: (accessor: ServicesAccessor) => {
        const notebookService = accessor.get(IPositronNotebookService);
        const activeNotebook = notebookService.getActiveInstance();
        if (activeNotebook && !activeNotebook.isReadOnly && activeNotebook.canPaste()) {
            activeNotebook.pasteCells();
        }
    }
});

// Register paste above command
CommandsRegistry.registerCommand({
    id: 'positronNotebook.pasteCellsAbove',
    handler: (accessor: ServicesAccessor) => {
        const notebookService = accessor.get(IPositronNotebookService);
        const activeNotebook = notebookService.getActiveInstance();
        if (activeNotebook && !activeNotebook.isReadOnly && activeNotebook.canPaste()) {
            activeNotebook.pasteCellsAbove();
        }
    }
});
```

### Task 7: Add Context Keys for Command Enablement

**File**: `src/vs/workbench/services/positronNotebook/browser/ContextKeysManager.ts`

Add new context keys:

```typescript
// Add to existing context keys
export const POSITRON_NOTEBOOK_HAS_CLIPBOARD_CELLS = new RawContextKey<boolean>(
    'positronNotebookHasClipboardCells',
    false,
    localize('positronNotebookHasClipboardCells', 'Whether the Positron notebook clipboard has cells')
);

export const POSITRON_NOTEBOOK_IS_READONLY = new RawContextKey<boolean>(
    'positronNotebookIsReadOnly',
    false,
    localize('positronNotebookIsReadOnly', 'Whether the Positron notebook is read-only')
);
```

Update the context key manager to track clipboard state:

```typescript
export class PositronNotebookContextKeyManager {
    private _hasClipboardCells: IContextKey<boolean>;
    private _isReadOnly: IContextKey<boolean>;
    
    constructor(
        contextKeyService: IContextKeyService,
        private _notebookInstance: IPositronNotebookInstance
    ) {
        // ... existing code ...
        
        this._hasClipboardCells = POSITRON_NOTEBOOK_HAS_CLIPBOARD_CELLS.bindTo(contextKeyService);
        this._isReadOnly = POSITRON_NOTEBOOK_IS_READONLY.bindTo(contextKeyService);
        
        // Update context keys based on state
        this.updateContextKeys();
    }
    
    private updateContextKeys(): void {
        // ... existing updates ...
        
        this._hasClipboardCells.set(this._notebookInstance.canPaste());
        this._isReadOnly.set(this._notebookInstance.isReadOnly);
    }
}
```

### Task 8: Enhanced Keybinding Registration with Context

Update the keybinding registrations to use context keys:

```typescript
// Enhanced paste command with context
registerNotebookKeybinding({
    id: POSITRON_NOTEBOOK_PASTE_CELLS,
    primary: KeyMod.CtrlCmd | KeyCode.KeyV,
    when: ContextKeyExpr.and(
        POSITRON_NOTEBOOK_EDITOR_FOCUSED,
        POSITRON_NOTEBOOK_HAS_CLIPBOARD_CELLS,
        POSITRON_NOTEBOOK_IS_READONLY.negate()
    ),
    onRun: ({ activeNotebook }) => {
        activeNotebook.pasteCells();
    }
});
```

## Command Descriptions for UI

### Localized Strings

**File**: `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`

Add localized descriptions:

```typescript
const COPY_CELLS_LABEL = localize('positronNotebook.copyCells', 'Copy Cells');
const CUT_CELLS_LABEL = localize('positronNotebook.cutCells', 'Cut Cells');
const PASTE_CELLS_LABEL = localize('positronNotebook.pasteCells', 'Paste Cells');
const PASTE_CELLS_ABOVE_LABEL = localize('positronNotebook.pasteCellsAbove', 'Paste Cells Above');

const COPY_CELLS_DESC = localize('positronNotebook.copyCells.desc', 
    'Copy selected cells to clipboard');
const CUT_CELLS_DESC = localize('positronNotebook.cutCells.desc', 
    'Cut selected cells to clipboard');
const PASTE_CELLS_DESC = localize('positronNotebook.pasteCells.desc', 
    'Paste cells from clipboard below current selection');
const PASTE_CELLS_ABOVE_DESC = localize('positronNotebook.pasteCellsAbove.desc', 
    'Paste cells from clipboard above current selection');
```

## Testing Checklist

### Keyboard Shortcut Tests
1. **Ctrl/Cmd+C**: Verify copies selected cells
2. **Ctrl/Cmd+X**: Verify cuts selected cells
3. **Ctrl/Cmd+V**: Verify pastes cells below selection
4. **Ctrl/Cmd+Shift+V**: Verify pastes cells above selection

### Command Palette Tests
1. Open command palette (Ctrl/Cmd+Shift+P)
2. Search for "Copy Cells" - should appear and execute
3. Search for "Cut Cells" - should appear and execute
4. Search for "Paste Cells" - should appear when clipboard has content
5. Verify commands are disabled in read-only notebooks

### Context Key Tests
1. Verify paste commands are disabled when clipboard is empty
2. Verify cut/paste commands are disabled in read-only notebooks
3. Verify commands only work when Positron notebook is focused

### Edge Cases
1. Test with no selection (should use focused cell)
2. Test with multi-cell selection
3. Test rapid successive operations
4. Test with notebook switching (clipboard should persist)

## Keybinding Conflicts

### Potential Conflicts to Check
1. **Ctrl/Cmd+C/X/V**: Standard editor copy/cut/paste
   - Resolution: Use `when` clause to ensure notebook focus
2. **Shift+Insert**: Alternative paste on Windows/Linux
   - Resolution: Register as secondary keybinding

### Priority Handling
The `KeybindingWeight.EditorContrib` weight ensures these keybindings take precedence when a Positron notebook is focused.

## Platform-Specific Considerations

### Windows
- Support Shift+Delete for cut (optional)
- Support Shift+Insert for paste
- Support Ctrl+Insert for copy (optional)

### macOS
- Use Cmd instead of Ctrl
- No additional keybindings needed

### Linux
- Similar to Windows keybindings
- Test with various desktop environments

## Integration Points

### With Selection State Machine
The commands should respect and update the selection state:
```typescript
// After paste, select the pasted cells
activeNotebook.selectionStateMachine.selectCells(pastedCells);
```

### With Undo/Redo System
Ensure operations are undoable:
```typescript
// Register operations with the undo service
// This may require integration with the text model's undo stack
```

### With Status Bar (Future Enhancement)
Consider adding clipboard status indicator:
```typescript
// Show "3 cells copied" in status bar
statusbarService.setMessage('3 cells copied', 2000);
```

## Performance Monitoring

### Metrics to Track
1. Command execution time
2. Keybinding response latency
3. Context key evaluation performance

### Logging
Add debug logging for troubleshooting:
```typescript
onRun: ({ activeNotebook, accessor }) => {
    const logService = accessor.get(ILogService);
    logService.debug('Executing copy cells command');
    const startTime = performance.now();
    
    activeNotebook.copyCells();
    
    const duration = performance.now() - startTime;
    logService.debug(`Copy cells completed in ${duration}ms`);
}
```

## Next Phase Prerequisites

Before moving to Phase 3 (Context Menu Integration), ensure:
1. ✅ All commands are registered and working
2. ✅ Keyboard shortcuts trigger correct actions
3. ✅ Commands appear in command palette
4. ✅ Context keys properly enable/disable commands
5. ✅ Platform-specific keybindings work correctly
6. ✅ No keybinding conflicts with existing shortcuts
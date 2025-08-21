# Phase 1: Core Clipboard Infrastructure

## Objective
Establish the foundational clipboard service integration and core cell manipulation methods for Positron notebooks. This phase creates the underlying infrastructure that all clipboard operations will rely on.

## Background Context

### Current Architecture
- Positron notebooks use `IPositronNotebookInstance` as the main interface for notebook operations
- Cells are managed through `IPositronNotebookCell` objects
- The system uses observables for reactive state management
- Selection is handled by `SelectionStateMachine`

### VSCode Reference Implementation
The VSCode implementation in `src/vs/workbench/contrib/notebook/browser/contrib/clipboard/notebookClipboard.ts` provides patterns we'll adapt:
- Uses `IClipboardService` for system clipboard
- Uses `INotebookService.setToCopy()` for internal clipboard
- Implements `cloneNotebookCellTextModel()` for cell duplication

## Implementation Tasks

### Task 1: Update IPositronNotebookInstance Interface

**File**: `src/vs/workbench/services/positronNotebook/browser/IPositronNotebookInstance.ts`

Add the following methods to the interface:

```typescript
/**
 * Copies the specified cells to the clipboard.
 * If no cells are provided, copies the currently selected cells.
 * @param cells Optional array of cells to copy. If not provided, uses current selection.
 */
copyCells(cells?: IPositronNotebookCell[]): void;

/**
 * Cuts the specified cells (copies to clipboard and removes from notebook).
 * If no cells are provided, cuts the currently selected cells.
 * @param cells Optional array of cells to cut. If not provided, uses current selection.
 */
cutCells(cells?: IPositronNotebookCell[]): void;

/**
 * Pastes cells from the clipboard at the specified index.
 * If no index is provided, pastes after the current selection.
 * @param index Optional index to paste at. If not provided, pastes after current selection.
 */
pasteCells(index?: number): void;

/**
 * Pastes cells from the clipboard above the current selection.
 */
pasteCellsAbove(): void;

/**
 * Returns whether there are cells available to paste from the clipboard.
 */
canPaste(): boolean;
```

### Task 2: Create Cell Clipboard Utilities

**New File**: `src/vs/workbench/contrib/positronNotebook/browser/cellClipboardUtils.ts`

⚠️ **IMPLEMENTATION NOTE**: The original plan called for cloning `NotebookCellTextModel` instances, but this approach caused text model registration issues. The final implementation uses `ICellDto2` format instead.

Create utilities for cell clipboard operations:

```typescript
import { IPositronNotebookCell } from '../../../services/positronNotebook/browser/IPositronNotebookCell';
import { ICellDto2 } from '../../notebook/common/notebookCommon';

/**
 * Converts a Positron notebook cell to ICellDto2 format for clipboard storage.
 * This preserves all cell data without creating standalone text models.
 */
export function cellToCellDto2(cell: IPositronNotebookCell): ICellDto2 {
    // Implementation should:
    // 1. Extract source content from cell
    // 2. Preserve language and cell kind
    // 3. Convert outputs to proper format
    // 4. Use empty metadata (lightweight format)
    // 5. Avoid creating NotebookCellTextModel instances
}

/**
 * Serializes cells to a JSON string for system clipboard storage.
 * This enables pasting cells into other applications or notebooks.
 */
export function serializeCellsToClipboard(cells: IPositronNotebookCell[]): string {
    // Implementation should:
    // 1. Convert cells to a standard notebook cell format
    // 2. Include cell type, source, metadata, and outputs
    // 3. Use a format compatible with Jupyter notebook spec
}

/**
 * Deserializes cells from a clipboard string to ICellDto2 format.
 * Handles both Positron and standard Jupyter notebook formats.
 */
export function deserializeCellsFromClipboard(clipboardData: string): ICellDto2[] | null {
    // Implementation should:
    // 1. Try to parse as JSON
    // 2. Validate the structure matches expected cell format
    // 3. Convert to ICellDto2 format (not NotebookCellTextModel)
    // 4. Return null if parsing fails
}
```

### Task 3: Implement Clipboard Methods in PositronNotebookInstance

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`

Add the following implementations:

```typescript
// Add these imports at the top
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService';
import { cellToCellDto2, serializeCellsToClipboard } from './cellClipboardUtils';

// Add to constructor parameters
@IClipboardService private readonly _clipboardService: IClipboardService,

// Add private property for internal clipboard
private _clipboardCells: ICellDto2[] = [];
private _isClipboardCut: boolean = false;

// Implement the methods
public copyCells(cells?: IPositronNotebookCell[]): void {
    const cellsToCopy = cells || this.getSelectedCells();
    
    if (cellsToCopy.length === 0) {
        return;
    }
    
    // Store internally for full-fidelity paste
    this._clipboardCells = cellsToCopy.map(cell => cellToCellDto2(cell));
    this._isClipboardCut = false;
    
    // Also write to system clipboard as text
    const clipboardText = serializeCellsToClipboard(cellsToCopy);
    this._clipboardService.writeText(clipboardText);
    
    // Log for debugging
    this._logService.debug(`Copied ${cellsToCopy.length} cells to clipboard`);
}

public cutCells(cells?: IPositronNotebookCell[]): void {
    const cellsToCut = cells || this.getSelectedCells();
    
    if (cellsToCut.length === 0) {
        return;
    }
    
    // Copy cells first
    this.copyCells(cellsToCut);
    this._isClipboardCut = true;
    
    // Delete the cells
    const indices = cellsToCut.map(cell => this.cells.get().indexOf(cell));
    this.deleteCellsAtIndices(indices);
    
    // Update selection to nearest remaining cell
    this.updateSelectionAfterDelete(indices[0]);
}

public pasteCells(index?: number): void {
    if (!this.canPaste()) {
        return;
    }
    
    this._assertTextModel();
    
    const pasteIndex = index ?? this.getInsertionIndex();
    const cellCount = this._clipboardCells.length;
    
    // Use textModel.applyEdits to properly create and register cells
    const synchronous = true;
    const pushUndoStop = true;
    const endSelections: ISelectionState = { 
        kind: SelectionStateType.Index, 
        focus: { start: pasteIndex, end: pasteIndex + cellCount }, 
        selections: [{ start: pasteIndex, end: pasteIndex + cellCount }] 
    };
    const focusAfterInsertion = {
        start: pasteIndex,
        end: pasteIndex + cellCount
    };

    this.textModel.applyEdits([
        {
            editType: CellEditType.Replace,
            index: pasteIndex,
            count: 0,
            cells: this._clipboardCells
        }
    ],
        synchronous,
        {
            kind: SelectionStateType.Index,
            focus: focusAfterInsertion,
            selections: [focusAfterInsertion]
        },
        () => endSelections, undefined, pushUndoStop && !this.isReadOnly
    );

    // If this was a cut operation, clear the clipboard
    if (this._isClipboardCut) {
        this._clipboardCells = [];
        this._isClipboardCut = false;
    }

    this._onDidChangeContent.fire();
}

public pasteCellsAbove(): void {
    const selection = this.selectionStateMachine.getSelections();
    if (selection.length > 0) {
        const firstSelectedIndex = this.cells.get().indexOf(selection[0]);
        this.pasteCells(firstSelectedIndex);
    } else {
        this.pasteCells(0);
    }
}

public canPaste(): boolean {
    return this._clipboardCells.length > 0;
}

// Helper method to get selected cells
private getSelectedCells(): IPositronNotebookCell[] {
    return this.selectionStateMachine.getSelections();
}

// Helper method to get insertion index
private getInsertionIndex(): number {
    const selections = this.selectionStateMachine.getSelections();
    if (selections.length > 0) {
        const lastSelectedIndex = this.cells.get().indexOf(selections[selections.length - 1]);
        return lastSelectedIndex + 1;
    }
    return this.cells.get().length;
}
```

### Task 4: Add Helper Methods for Cell Manipulation

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`

⚠️ **IMPLEMENTATION NOTE**: The original plan included several helper methods (`insertCellsAtIndex`, `createCellFromModel`, `selectCells`) but these were removed in the final implementation since `pasteCells()` now uses `textModel.applyEdits()` directly.

Add these helper methods to support clipboard operations:

```typescript
/**
 * Deletes cells at the specified indices.
 * Updates the notebook model and triggers necessary events.
 */
private deleteCellsAtIndices(indices: number[]): void {
    // Sort indices in descending order to avoid index shifting issues
    const sortedIndices = [...indices].sort((a, b) => b - a);
    
    const currentCells = [...this.cells.get()];
    
    for (const index of sortedIndices) {
        if (index >= 0 && index < currentCells.length) {
            currentCells.splice(index, 1);
        }
    }
    
    // Update the observable
    this.cells.set(currentCells);
    
    // Trigger model change if we have a text model
    if (this._textModel) {
        const edits: ICellEditOperation[] = sortedIndices.map(index => ({
            editType: CellEditType.Replace,
            index: index,
            count: 1,
            cells: []
        }));
        
        this._textModel.applyEdits(edits, true, undefined, () => undefined, undefined, true);
    }
}

/**
 * Inserts cells at the specified index.
 */
private insertCellsAtIndex(newCells: IPositronNotebookCell[], index: number): void {
    const currentCells = [...this.cells.get()];
    currentCells.splice(index, 0, ...newCells);
    
    // Update the observable
    this.cells.set(currentCells);
    
    // Update the text model
    if (this._textModel) {
        const cellModels = newCells.map(cell => cell.model);
        const edit: ICellEditOperation = {
            editType: CellEditType.Replace,
            index: index,
            count: 0,
            cells: cellModels
        };
        
        this._textModel.applyEdits([edit], true, undefined, () => undefined, undefined, true);
    }
}

/**
 * Creates a new cell instance from a cell text model.
 */
private createCellFromModel(cellModel: NotebookCellTextModel): IPositronNotebookCell {
    // Use the existing createNotebookCell utility
    return createNotebookCell(
        cellModel,
        this,
        this._instantiationService
    );
}

/**
 * Updates selection after deleting cells.
 */
private updateSelectionAfterDelete(deletedIndex: number): void {
    const cellCount = this.cells.get().length;
    if (cellCount === 0) {
        return;
    }
    
    // Select the cell that's now at the deleted position, or the last cell
    const newIndex = Math.min(deletedIndex, cellCount - 1);
    this.selectionStateMachine.selectCell(this.cells.get()[newIndex], CellSelectionType.focus);
}

/**
 * Selects cells in the specified range.
 */
private selectCells(startIndex: number, endIndex: number): void {
    const cells = this.cells.get();
    const cellsToSelect = cells.slice(startIndex, endIndex);
    
    if (cellsToSelect.length > 0) {
        // Select first cell
        this.selectionStateMachine.selectCell(cellsToSelect[0], CellSelectionType.focus);
        
        // Add rest to selection if multiple
        for (let i = 1; i < cellsToSelect.length; i++) {
            this.selectionStateMachine.selectCell(cellsToSelect[i], CellSelectionType.selections);
        }
    }
}
```

## Testing Checklist

### Unit Tests to Create
1. **Cell Cloning Tests** (`cellClipboardUtils.test.ts`)
   - Test cloning preserves all cell properties
   - Test new IDs are generated to avoid conflicts
   - Test serialization to clipboard format
   - Test deserialization from various formats

2. **Clipboard Operations Tests** (`PositronNotebookInstance.test.ts`)
   - Test copy with single cell
   - Test copy with multiple cells
   - Test cut removes cells correctly
   - Test paste inserts at correct position
   - Test paste above functionality
   - Test canPaste state management

### Manual Testing Scenarios
1. Copy a single code cell and verify clipboard contains source
2. Copy multiple cells and verify order is preserved
3. Cut cells and verify they are removed
4. Paste cells and verify they appear at correct position
5. Verify outputs and metadata are preserved
6. Test with empty selections
7. Test with read-only notebooks (should prevent cut/paste)

## Dependencies and Imports

### Required Services
- `IClipboardService` - System clipboard access
- `ILogService` - Debugging and logging
- `IInstantiationService` - Creating new cell instances

### Required Types
- `NotebookCellTextModel` - Cell data model
- `ICellEditOperation` - Cell edit operations
- `CellEditType` - Edit operation types
- `IPositronNotebookCell` - Positron cell interface

## Error Handling

### Edge Cases to Handle
1. **Empty Selection**: Operations should no-op gracefully
2. **Invalid Clipboard Data**: Paste should fail gracefully with corrupted data
3. **Read-only Notebooks**: Mutating operations should be prevented
4. **Memory Constraints**: Large cells should be handled efficiently
5. **Concurrent Operations**: Ensure thread safety with observable updates

### Error Messages
```typescript
// Use INotificationService for user-facing errors
this._notificationService.error(localize('clipboard.pasteFailed', 
    'Failed to paste cells: Invalid clipboard data'));

// Use ILogService for debugging
this._logService.warn('Clipboard operation failed', error);
```

## Performance Considerations

1. **Lazy Cloning**: Only clone outputs when necessary
2. **Batch Updates**: Use single observable update for multiple cells
3. **Memory Management**: Clear internal clipboard when appropriate
4. **Large Notebooks**: Consider pagination or virtualization for large selections

## Next Phase Prerequisites

Before moving to Phase 2 (Command Registration), ensure:
1. ✅ All clipboard methods are implemented and working
2. ✅ Cell cloning preserves all necessary data
3. ✅ System clipboard integration is functional
4. ✅ Basic unit tests are passing
5. ✅ Observable updates trigger UI refreshes correctly
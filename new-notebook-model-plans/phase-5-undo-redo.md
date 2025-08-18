# Phase 5: Undo/Redo Implementation - Positron Notebook Model
## Timeline: Weeks 12-13

## Executive Summary
Implement comprehensive undo/redo functionality that integrates with VS Code's IUndoRedoService while handling complex challenges like cell selection restoration, operation grouping, content coalescing, and multi-cell edits. This phase addresses one of the most intricate aspects identified in the technical review.

## Prerequisites
- Phase 1 (Core Model) completed
- Phase 4 (File I/O) for save points
- Understanding of IUndoRedoService
- Knowledge of operation coalescing patterns

## Background Context

### Critical Complexity Areas
The technical review identified these challenges:
1. **Selection Restoration**: Cell focus and text selection after undo
2. **Operation Grouping**: Multi-cell edits as single undo unit
3. **Content Coalescing**: Rapid typing should create single undo step
4. **Viewport Restoration**: Scroll position after undo
5. **Cross-Editor Coordination**: Multiple views of same notebook

### Architecture Pattern
```
User Action → PositronNotebookModel → UndoRedoElement → IUndoRedoService
                     ↓                        ↓
              State Capture            Stack Management
                     ↓                        ↓
              Selection/Viewport      Global Undo Stack
```

## Implementation Tasks

### Task 1: Undo/Redo Element Implementation
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/undoRedo/positronNotebookUndoRedoElement.ts`

```typescript
export interface NotebookOperationContext {
    operation: NotebookOperation;
    beforeState: NotebookState;
    afterState: NotebookState;
    timestamp: number;
    coalesceKey?: string;
}

export interface NotebookState {
    cells: CellState[];
    metadata: any;
    selections: CellSelection[];
    viewport: ViewportState;
    focusedCell?: string;
    editorStates: Map<string, EditorState>;
}

export interface CellState {
    id: string;
    type: 'code' | 'markdown';
    content: string;
    outputs: IPositronCellOutput[];
    metadata: any;
    collapsed: boolean;
}

export interface CellSelection {
    cellId: string;
    startOffset?: number;
    endOffset?: number;
}

export interface ViewportState {
    scrollTop: number;
    visibleRange: { start: number; end: number };
}

export interface EditorState {
    cursorPosition: { line: number; column: number };
    selections: Range[];
    scrollTop: number;
}

export class PositronNotebookUndoRedoElement implements IUndoRedoElement {
    public readonly type = UndoRedoElementType.Resource;
    public readonly label: string;
    public readonly code = 'positronNotebookOperation';
    
    private _operations: NotebookOperationContext[] = [];
    
    constructor(
        public readonly resource: URI,
        private readonly model: IPositronNotebookModel,
        private readonly viewModel: INotebookViewModel, // For selection/viewport
        operation: NotebookOperation,
        beforeState: NotebookState,
        afterState: NotebookState
    ) {
        this.label = this._getOperationLabel(operation);
        
        this._operations.push({
            operation,
            beforeState,
            afterState,
            timestamp: Date.now(),
            coalesceKey: this._getCoalesceKey(operation)
        });
    }
    
    async undo(): Promise<void> {
        // Restore in reverse order
        for (let i = this._operations.length - 1; i >= 0; i--) {
            const context = this._operations[i];
            await this._restoreState(context.beforeState);
        }
    }
    
    async redo(): Promise<void> {
        // Apply in forward order
        for (const context of this._operations) {
            await this._restoreState(context.afterState);
        }
    }
    
    canCoalesce(other: IUndoRedoElement): boolean {
        if (!(other instanceof PositronNotebookUndoRedoElement)) {
            return false;
        }
        
        if (other.resource.toString() !== this.resource.toString()) {
            return false;
        }
        
        const lastOp = this._operations[this._operations.length - 1];
        const otherFirstOp = other._operations[0];
        
        // Check coalesce key match
        if (!lastOp.coalesceKey || !otherFirstOp.coalesceKey) {
            return false;
        }
        
        if (lastOp.coalesceKey !== otherFirstOp.coalesceKey) {
            return false;
        }
        
        // Check time window (500ms for typing)
        const timeDiff = otherFirstOp.timestamp - lastOp.timestamp;
        if (timeDiff > 500) {
            return false;
        }
        
        return true;
    }
    
    coalesce(other: PositronNotebookUndoRedoElement): PositronNotebookUndoRedoElement {
        // Keep first beforeState, take last afterState
        const firstBefore = this._operations[0].beforeState;
        const lastAfter = other._operations[other._operations.length - 1].afterState;
        
        // Merge operations
        this._operations.push(...other._operations);
        
        // Update states
        this._operations[0].beforeState = firstBefore;
        this._operations[this._operations.length - 1].afterState = lastAfter;
        
        return this;
    }
    
    private async _restoreState(state: NotebookState): Promise<void> {
        // 1. Restore cells
        await this._restoreCells(state.cells);
        
        // 2. Restore metadata
        this.model.updateMetadata(state.metadata);
        
        // 3. Restore selections
        await this._restoreSelections(state.selections);
        
        // 4. Restore viewport
        await this._restoreViewport(state.viewport);
        
        // 5. Restore focused cell
        if (state.focusedCell) {
            await this._restoreFocus(state.focusedCell);
        }
        
        // 6. Restore editor states
        await this._restoreEditorStates(state.editorStates);
    }
    
    private async _restoreCells(cells: CellState[]): Promise<void> {
        // Clear existing cells
        while (this.model.cells.length > 0) {
            this.model.removeCell(this.model.cells[0].id);
        }
        
        // Add cells from state
        for (const cellState of cells) {
            const cell = this.model.addCell(
                cellState.type,
                cellState.content,
                this.model.cells.length,
                cellState.metadata
            );
            
            // Restore outputs
            if (cellState.outputs.length > 0) {
                this.model.updateCellOutputs(cell.id, cellState.outputs);
            }
            
            // Note: We need to map old IDs to new IDs for selection restoration
            this._cellIdMap.set(cellState.id, cell.id);
        }
    }
    
    private async _restoreSelections(selections: CellSelection[]): Promise<void> {
        if (!this.viewModel) return;
        
        const mappedSelections = selections.map(sel => ({
            cellId: this._cellIdMap.get(sel.cellId) || sel.cellId,
            startOffset: sel.startOffset,
            endOffset: sel.endOffset
        }));
        
        // Use view model to restore selections
        this.viewModel.updateSelections(mappedSelections);
    }
    
    private async _restoreViewport(viewport: ViewportState): Promise<void> {
        if (!this.viewModel) return;
        
        // Restore scroll position
        this.viewModel.setScrollTop(viewport.scrollTop);
        
        // Ensure visible range is in view
        this.viewModel.revealRange(viewport.visibleRange);
    }
    
    private async _restoreFocus(cellId: string): Promise<void> {
        const mappedId = this._cellIdMap.get(cellId) || cellId;
        this.viewModel?.focusCell(mappedId);
    }
    
    private async _restoreEditorStates(editorStates: Map<string, EditorState>): Promise<void> {
        for (const [cellId, state] of editorStates) {
            const mappedId = this._cellIdMap.get(cellId) || cellId;
            const editor = this.viewModel?.getCellEditor(mappedId);
            
            if (editor) {
                // Restore cursor
                editor.setPosition(state.cursorPosition);
                
                // Restore selections
                editor.setSelections(state.selections);
                
                // Restore scroll
                editor.setScrollTop(state.scrollTop);
            }
        }
    }
    
    private _getOperationLabel(operation: NotebookOperation): string {
        switch (operation.type) {
            case 'addCell': return 'Add Cell';
            case 'removeCell': return 'Remove Cell';
            case 'moveCell': return 'Move Cell';
            case 'updateContent': return 'Edit Cell';
            case 'updateOutputs': return 'Update Outputs';
            case 'clearOutputs': return 'Clear Outputs';
            case 'updateMetadata': return 'Update Metadata';
            default: return 'Notebook Operation';
        }
    }
    
    private _getCoalesceKey(operation: NotebookOperation): string | undefined {
        if (operation.type === 'updateContent') {
            // Coalesce content updates for same cell
            return `content-${operation.cellId}`;
        }
        
        if (operation.type === 'moveCell' && operation.isDragging) {
            // Coalesce drag operations
            return `drag-${operation.cellId}`;
        }
        
        return undefined;
    }
    
    private _cellIdMap = new Map<string, string>();
}
```

### Task 2: Undo/Redo Manager
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/undoRedo/positronNotebookUndoRedoManager.ts`

```typescript
export class PositronNotebookUndoRedoManager extends Disposable {
    private readonly _pendingElement: Map<string, PositronNotebookUndoRedoElement> = new Map();
    private _isUndoing = false;
    private _isRedoing = false;
    private _pauseTracking = false;
    
    constructor(
        private readonly model: IPositronNotebookModel,
        private readonly viewModel: INotebookViewModel,
        @IUndoRedoService private readonly undoRedoService: IUndoRedoService,
        @IConfigurationService private readonly configService: IConfigurationService
    ) {
        super();
        
        this._registerModelListeners();
    }
    
    private _registerModelListeners(): void {
        // Track all model changes
        this._register(this.model.onDidChangeContent(e => {
            if (this._pauseTracking || this._isUndoing || this._isRedoing) {
                return;
            }
            
            this._handleModelChange(e);
        }));
    }
    
    private _handleModelChange(event: NotebookContentChangeEvent): void {
        const operation = this._createOperation(event);
        const beforeState = this._captureBeforeState(event);
        const afterState = this._captureCurrentState();
        
        const element = new PositronNotebookUndoRedoElement(
            this.model.uri,
            this.model,
            this.viewModel,
            operation,
            beforeState,
            afterState
        );
        
        // Check for coalescing
        const coalesceKey = element['_getCoalesceKey'](operation);
        if (coalesceKey) {
            const pending = this._pendingElement.get(coalesceKey);
            if (pending && pending.canCoalesce(element)) {
                // Coalesce with pending
                pending.coalesce(element);
                return;
            }
        }
        
        // Push to undo stack
        this._pushElement(element);
        
        // Track for potential coalescing
        if (coalesceKey) {
            this._pendingElement.set(coalesceKey, element);
            
            // Clear pending after timeout
            setTimeout(() => {
                this._pendingElement.delete(coalesceKey);
            }, 600);
        }
    }
    
    private _pushElement(element: PositronNotebookUndoRedoElement): void {
        this.undoRedoService.pushElement(element, element.resource);
    }
    
    private _createOperation(event: NotebookContentChangeEvent): NotebookOperation {
        return {
            type: event.type,
            cellId: event.cellId,
            index: event.index,
            newIndex: event.newIndex,
            timestamp: Date.now()
        };
    }
    
    private _captureBeforeState(event: NotebookContentChangeEvent): NotebookState {
        // This is tricky - we need the state BEFORE the change
        // One approach is to maintain a shadow copy
        // Another is to reverse the operation temporarily
        
        // For now, use cached state
        return this._lastState || this._captureCurrentState();
    }
    
    private _captureCurrentState(): NotebookState {
        const state: NotebookState = {
            cells: this._captureCells(),
            metadata: { ...this.model.metadata },
            selections: this._captureSelections(),
            viewport: this._captureViewport(),
            focusedCell: this.viewModel?.getFocusedCell(),
            editorStates: this._captureEditorStates()
        };
        
        // Cache for next operation
        this._lastState = state;
        
        return state;
    }
    
    private _captureCells(): CellState[] {
        return this.model.cells.map(cell => ({
            id: cell.id,
            type: cell.type === 'code' ? 'code' : 'markdown',
            content: cell.content,
            outputs: [...cell.outputs],
            metadata: { ...cell.metadata },
            collapsed: cell.metadata.collapsed || false
        }));
    }
    
    private _captureSelections(): CellSelection[] {
        if (!this.viewModel) return [];
        
        return this.viewModel.getSelections().map(sel => ({
            cellId: sel.cellId,
            startOffset: sel.startOffset,
            endOffset: sel.endOffset
        }));
    }
    
    private _captureViewport(): ViewportState {
        if (!this.viewModel) {
            return { scrollTop: 0, visibleRange: { start: 0, end: 10 } };
        }
        
        return {
            scrollTop: this.viewModel.getScrollTop(),
            visibleRange: this.viewModel.getVisibleRange()
        };
    }
    
    private _captureEditorStates(): Map<string, EditorState> {
        const states = new Map<string, EditorState>();
        
        if (!this.viewModel) return states;
        
        for (const cell of this.model.cells) {
            const editor = this.viewModel.getCellEditor(cell.id);
            if (editor) {
                states.set(cell.id, {
                    cursorPosition: editor.getPosition(),
                    selections: editor.getSelections(),
                    scrollTop: editor.getScrollTop()
                });
            }
        }
        
        return states;
    }
    
    // Public API for batching operations
    async runWithoutUndo<T>(fn: () => T): Promise<T> {
        this._pauseTracking = true;
        try {
            return await fn();
        } finally {
            this._pauseTracking = false;
        }
    }
    
    beginUndoGroup(): void {
        // Start batching operations
        this._currentGroup = [];
    }
    
    endUndoGroup(label?: string): void {
        if (!this._currentGroup || this._currentGroup.length === 0) {
            return;
        }
        
        // Create composite element
        const composite = new CompositeUndoRedoElement(
            this.model.uri,
            label || 'Notebook Operations',
            this._currentGroup
        );
        
        this._pushElement(composite);
        this._currentGroup = undefined;
    }
    
    private _currentGroup?: PositronNotebookUndoRedoElement[];
    private _lastState?: NotebookState;
}
```

### Task 3: Composite Operations
**Location**: `/src/vs/workbench/contrib/positronNotebook/browser/undoRedo/compositeUndoRedoElement.ts`

```typescript
export class CompositeUndoRedoElement implements IUndoRedoElement {
    public readonly type = UndoRedoElementType.Resource;
    public readonly code = 'positronNotebookComposite';
    
    constructor(
        public readonly resource: URI,
        public readonly label: string,
        private readonly elements: PositronNotebookUndoRedoElement[]
    ) {}
    
    async undo(): Promise<void> {
        // Undo in reverse order
        for (let i = this.elements.length - 1; i >= 0; i--) {
            await this.elements[i].undo();
        }
    }
    
    async redo(): Promise<void> {
        // Redo in forward order
        for (const element of this.elements) {
            await element.redo();
        }
    }
}
```

### Task 4: Integration with Model
**Location**: Update `/src/vs/workbench/contrib/positronNotebook/browser/model/positronNotebookModel.ts`

```typescript
// Add to PositronNotebookModel
private _undoRedoManager: PositronNotebookUndoRedoManager | undefined;

setUndoRedoManager(manager: PositronNotebookUndoRedoManager): void {
    this._undoRedoManager = manager;
}

// Wrap operations for undo grouping
async executeMultipleCellOperations(
    operations: Array<() => void>,
    label?: string
): Promise<void> {
    if (this._undoRedoManager) {
        this._undoRedoManager.beginUndoGroup();
    }
    
    try {
        for (const op of operations) {
            op();
        }
    } finally {
        if (this._undoRedoManager) {
            this._undoRedoManager.endUndoGroup(label);
        }
    }
}

// Special handling for execution outputs (shouldn't be undoable)
updateCellOutputsWithoutUndo(cellId: string, outputs: IPositronCellOutput[]): boolean {
    if (this._undoRedoManager) {
        return this._undoRedoManager.runWithoutUndo(() => {
            return this.updateCellOutputs(cellId, outputs);
        });
    }
    
    return this.updateCellOutputs(cellId, outputs);
}
```

## Testing Requirements

### Complex Scenarios
```typescript
suite('PositronNotebookUndoRedo - Complex', () => {
    test('coalesces rapid typing', async () => {
        const model = createTestModel();
        const undoManager = new PositronNotebookUndoRedoManager(model);
        
        const cell = model.addCell('code', '');
        
        // Simulate rapid typing
        for (const char of 'hello world') {
            model.updateCellContent(cell.id, model.cells[0].content + char);
            await delay(50); // Within coalesce window
        }
        
        // Should be single undo operation
        await undoRedoService.undo(model.uri);
        assert.strictEqual(model.cells[0].content, '');
    });
    
    test('restores selection after undo', async () => {
        const model = createTestModel();
        const viewModel = createTestViewModel(model);
        const undoManager = new PositronNotebookUndoRedoManager(model, viewModel);
        
        const cell1 = model.addCell('code', 'first');
        const cell2 = model.addCell('code', 'second');
        
        // Select second cell
        viewModel.selectCell(cell2.id);
        
        // Remove first cell
        model.removeCell(cell1.id);
        
        // Undo
        await undoRedoService.undo(model.uri);
        
        // Selection should be restored to second cell
        assert.strictEqual(viewModel.getFocusedCell(), cell2.id);
    });
    
    test('handles multi-cell operations as group', async () => {
        const model = createTestModel();
        const undoManager = new PositronNotebookUndoRedoManager(model);
        
        // Group operation
        await model.executeMultipleCellOperations([
            () => model.addCell('code', 'cell1'),
            () => model.addCell('code', 'cell2'),
            () => model.addCell('code', 'cell3')
        ], 'Add Three Cells');
        
        assert.strictEqual(model.cells.length, 3);
        
        // Single undo removes all three
        await undoRedoService.undo(model.uri);
        assert.strictEqual(model.cells.length, 0);
        
        // Single redo restores all three
        await undoRedoService.redo(model.uri);
        assert.strictEqual(model.cells.length, 3);
    });
    
    test('preserves viewport on undo', async () => {
        const model = createTestModel();
        const viewModel = createTestViewModel(model);
        const undoManager = new PositronNotebookUndoRedoManager(model, viewModel);
        
        // Add many cells
        for (let i = 0; i < 100; i++) {
            model.addCell('code', `cell ${i}`);
        }
        
        // Scroll to middle
        viewModel.setScrollTop(2000);
        
        // Delete cell in view
        model.removeCell(model.cells[50].id);
        
        // Undo
        await undoRedoService.undo(model.uri);
        
        // Viewport should be restored
        assert.strictEqual(viewModel.getScrollTop(), 2000);
    });
    
    test('execution outputs not undoable', async () => {
        const model = createTestModel();
        const undoManager = new PositronNotebookUndoRedoManager(model);
        
        const cell = model.addCell('code', 'print("hello")');
        
        // Update outputs without undo
        model.updateCellOutputsWithoutUndo(cell.id, [{
            outputId: 'test',
            outputs: [{ mime: 'text/plain', data: 'hello' }]
        }]);
        
        // Undo should not affect outputs
        await undoRedoService.undo(model.uri);
        
        // Cell removed but if we redo...
        await undoRedoService.redo(model.uri);
        
        // Outputs should still be there
        assert.strictEqual(model.cells[0].outputs.length, 1);
    });
});
```

## Configuration

```json
{
  "positron.notebook.undoRedo.coalesceWindow": {
    "type": "number",
    "default": 500,
    "description": "Time window in ms for coalescing operations"
  },
  "positron.notebook.undoRedo.preserveSelection": {
    "type": "boolean",
    "default": true,
    "description": "Restore cell selection after undo/redo"
  },
  "positron.notebook.undoRedo.preserveViewport": {
    "type": "boolean",
    "default": true,
    "description": "Restore scroll position after undo/redo"
  }
}
```

## Success Criteria
- ✅ All cell operations undoable
- ✅ Rapid typing coalesced properly
- ✅ Selection state restored
- ✅ Viewport position restored
- ✅ Multi-cell operations grouped
- ✅ Execution outputs excluded from undo
- ✅ Cross-editor undo coordination
- ✅ Memory efficient for large notebooks

## Risk Mitigation

### High Risk: State Capture Timing
**Solution**: Shadow state maintenance, before/after snapshots

### High Risk: Selection/Viewport Loss
**Solution**: Comprehensive state capture, ID mapping

### Medium Risk: Memory Usage
**Solution**: State pruning, compression for large notebooks

## Next Phase Dependencies
Enables:
- Phase 6: UI integration (undo/redo buttons)
- Phase 7: Testing (undo/redo scenarios)
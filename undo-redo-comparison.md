# Undo/Redo Implementation: ICellEditOperation vs Simplified Approaches

## VS Code's Approach (With ICellEditOperation)

```typescript
// Complex but automatic - every operation is inherently undoable
class NotebookOperationManager {
    private _pendingStackOperation: StackOperation | null = null;
    
    pushEditOperation(element: IUndoRedoElement, beginSelectionState, resultSelectionState, alternativeVersionId, undoRedoGroup) {
        // 100+ lines of complex state management
        const pendingStackOperation = this._getOrCreateEditStackElement(...);
        pendingStackOperation.pushEditOperation(element, ...);
    }
}

// Usage requires operation objects
textModel.applyEdits([
    { editType: CellEditType.Replace, index: 0, count: 1, cells: [...] }
], synchronous, beginSelectionState, endSelectionsComputer, undoRedoGroup, computeUndoRedo);
```

**Pros:**
- Integrates with VS Code's workspace-wide undo system
- Handles complex scenarios (remote editing, extensions)
- Automatic operation grouping

**Cons:**
- ~500 lines of complex code
- Tight coupling to VS Code infrastructure
- Hard to understand and debug

## Positron's Simplified Approach (Without ICellEditOperation)

### Option 1: Simple Command Pattern
```typescript
// Much simpler - each action knows how to undo itself
interface INotebookCommand {
    execute(): void;
    undo(): void;
}

class AddCellCommand implements INotebookCommand {
    private cellId?: string;
    
    constructor(
        private model: PositronNotebookModel,
        private type: 'code' | 'markdown',
        private content: string,
        private index: number
    ) {}
    
    execute() {
        const cell = this.model.addCell(this.type, this.content, this.index);
        this.cellId = cell.id;
    }
    
    undo() {
        if (this.cellId) {
            this.model.removeCell(this.cellId);
        }
    }
}

// Simple undo manager
class UndoManager {
    private undoStack: INotebookCommand[] = [];
    private redoStack: INotebookCommand[] = [];
    
    execute(command: INotebookCommand) {
        command.execute();
        this.undoStack.push(command);
        this.redoStack = []; // Clear redo on new action
    }
    
    undo() {
        const command = this.undoStack.pop();
        if (command) {
            command.undo();
            this.redoStack.push(command);
        }
    }
    
    redo() {
        const command = this.redoStack.pop();
        if (command) {
            command.execute();
            this.undoStack.push(command);
        }
    }
}
```

**Implementation: ~50 lines vs ~500 lines**

### Option 2: Snapshot-Based Undo (Even Simpler)
```typescript
class SnapshotUndoManager {
    private snapshots: NotebookSnapshot[] = [];
    private currentIndex: number = -1;
    
    saveSnapshot(model: PositronNotebookModel) {
        // Remove any snapshots after current index (for redo)
        this.snapshots = this.snapshots.slice(0, this.currentIndex + 1);
        
        // Add new snapshot
        this.snapshots.push(model.createSnapshot());
        this.currentIndex++;
        
        // Limit history size
        if (this.snapshots.length > 100) {
            this.snapshots.shift();
            this.currentIndex--;
        }
    }
    
    undo(model: PositronNotebookModel) {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            model.restoreSnapshot(this.snapshots[this.currentIndex]);
        }
    }
    
    redo(model: PositronNotebookModel) {
        if (this.currentIndex < this.snapshots.length - 1) {
            this.currentIndex++;
            model.restoreSnapshot(this.snapshots[this.currentIndex]);
        }
    }
}
```

**Implementation: ~30 lines**

### Option 3: Inverse Operations (Middle Ground)
```typescript
class InverseOperationUndoManager {
    private undoStack: Array<() => void> = [];
    private redoStack: Array<() => void> = [];
    
    // When adding a cell, store its inverse
    trackAddCell(model: PositronNotebookModel, cellId: string) {
        const inverse = () => model.removeCell(cellId);
        this.undoStack.push(inverse);
    }
    
    // When removing a cell, store its restoration
    trackRemoveCell(model: PositronNotebookModel, cell: IPositronCell, index: number) {
        const inverse = () => model.insertCell(cell, index);
        this.undoStack.push(inverse);
    }
    
    undo() {
        const inverse = this.undoStack.pop();
        if (inverse) {
            inverse();
            // Track the undo operation for redo
        }
    }
}
```

## Comparison for Positron's Needs

| Approach | Complexity | Lines of Code | Features | Best For |
|----------|------------|---------------|----------|----------|
| VS Code ICellEditOperation | High | ~500 | Full integration, remote editing, extensions | Platform with extensions |
| Simple Command Pattern | Low | ~50 | Clean, testable, extensible | Most applications |
| Snapshot-Based | Very Low | ~30 | Simple, reliable | Small notebooks |
| Inverse Operations | Low | ~40 | Efficient, simple | Positron's needs |

## Why It's Not Harder for Positron

### 1. Simpler Requirements
- No need for workspace-wide undo coordination
- No extension integration needed
- No remote editing scenarios
- Just need notebook-level undo/redo

### 2. Clearer Implementation
```typescript
// VS Code approach - indirect and complex
textModel.applyEdits([complexOperation], true, selectionState, () => newSelection, undoGroup);

// Positron approach - direct and clear
undoManager.execute(new AddCellCommand(model, 'code', 'print("hello")', 0));
```

### 3. Better Debugging
- Can easily inspect undo/redo stacks
- Commands are self-contained and testable
- No hidden state in complex managers

### 4. Flexible Granularity
```typescript
// Easy to group operations
class CompositeCommand implements INotebookCommand {
    constructor(private commands: INotebookCommand[]) {}
    
    execute() {
        this.commands.forEach(cmd => cmd.execute());
    }
    
    undo() {
        // Undo in reverse order
        this.commands.reverse().forEach(cmd => cmd.undo());
    }
}

// Group multiple operations into one undo step
undoManager.execute(new CompositeCommand([
    new AddCellCommand(...),
    new UpdateCellContentCommand(...),
    new ExecuteCellCommand(...)
]));
```

## Recommended Approach for Positron

Use a **Simple Command Pattern** because it:
1. Takes ~50 lines instead of ~500
2. Is easy to understand and maintain
3. Provides all needed functionality
4. Can be extended as needed
5. Makes testing straightforward

Example integration:
```typescript
class PositronNotebookModel {
    private undoManager = new UndoManager();
    
    addCellWithUndo(type: 'code' | 'markdown', content: string, index: number) {
        const command = new AddCellCommand(this, type, content, index);
        this.undoManager.execute(command);
        return command.getCell(); // Return the created cell
    }
    
    undo() {
        this.undoManager.undo();
        this._onDidChangeContent.fire({ type: 'undo' });
    }
    
    redo() {
        this.undoManager.redo();
        this._onDidChangeContent.fire({ type: 'redo' });
    }
}
```

## Conclusion

Removing ICellEditOperation doesn't make undo/redo harder - it makes it **simpler and more appropriate** for Positron's needs. The VS Code pattern is designed for a complex platform with thousands of extensions. Positron can achieve robust undo/redo with 10% of the code complexity using well-established patterns that are easier to understand, test, and maintain.
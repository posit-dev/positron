# Positron Notebooks Architecture Reference

This document contains detailed architectural information about Positron Notebooks components and systems.

## Core Components

### Entry Points

**`src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`**
- Registers commands, keybindings, and menus
- Sets up editor resolver for `.ipynb` files
- Initializes contribution on workbench startup
- Command registration pattern uses `CommandsRegistry.registerCommand()`

**`src/vs/workbench/contrib/positronNotebook/browser/positronNotebookExperimentalConfig.ts`**
- Feature flag configuration: `positron.notebook.enabled`
- Defaults to `false`, requires restart to enable
- Controls editor resolver priority

### Central State Management

**`src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`**
- **Most important file** - contains majority of non-UI logic
- Manages cell lifecycle, execution, selection
- Coordinates between VS Code services and React UI
- Observable-based state for React reactivity
- Key methods:
  - `executeCell()` - Cell execution orchestration
  - `addCell()` / `deleteCell()` - Cell CRUD operations
  - `selectCell()` / `focusCell()` - Selection management
  - `attachTextEditor()` - Monaco editor integration

**`src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorInput.ts`**
- Editor input lifecycle management
- Model resolution and disposal
- View state persistence
- Kernel selection state

**`src/vs/workbench/services/positronNotebook/browser/positronNotebookService.ts`**
- Global registry of active instances
- One instance per open notebook
- Provides `getActiveInstance()` for commands

### Cell System

**Interface: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.ts`**
```typescript
interface IPositronNotebookCell {
	uri: URI;
	cellIndex: number;
	cellType: CellKind;
	selectedObservable: IObservable<boolean>;
	focusedObservable: IObservable<boolean>;
	executionStateObservable: IObservable<NotebookCellExecutionState | undefined>;
	// ... more observables for reactive UI
}
```

**Base: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/PositronNotebookCellGeneral.ts`**
- Shared cell logic for both code and markdown
- Manages selection, focus, execution state
- Text editor attachment lifecycle
- Observable state management

**Specializations:**
- `PositronNotebookCodeCell.ts` - Code execution, output parsing
- `PositronNotebookMarkdownCell.ts` - Markdown rendering, edit mode

### React UI Components

**Root: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor.tsx`**
- Top-level React component
- Renders cell list
- Handles container-level events
- Sets up notebook-level context keys

**Cell Components:**
- `notebookCells/NotebookCodeCell.tsx` - Code cell wrapper
- `notebookCells/NotebookMarkdownCell.tsx` - Markdown cell wrapper
- `notebookCells/CellEditorMonacoWidget.tsx` - Monaco editor integration
- `notebookCells/ExecutionStatusBadge.tsx` - Execution status indicator
- `notebookCells/CellLeftActionMenu.tsx` - Cell action buttons (run, debug)

### State Management

**Selection Machine: `src/vs/workbench/contrib/positronNotebook/browser/selectionMachine.ts`**
- XState finite state machine
- States:
  - `NoSelection` - No cells selected
  - `SingleSelection` - One cell selected
  - `MultiSelection` - Multiple cells selected
  - `EditingSelection` - Cell in edit mode
- Events trigger state transitions
- State determines available commands

**Context Keys: `src/vs/workbench/contrib/positronNotebook/browser/ContextKeysManager.ts`**
- Per-cell scoped context keys
- Notebook-level keys (container focus, editor focus)
- Cell-level keys (type, execution state, markdown editor open)
- Drives command availability via when-clauses

## Architecture Patterns

### Observable-Based Reactivity

Positron Notebooks uses VS Code's observable system (`@base/common/observable`) for React integration:

```typescript
// Cell state as observables
private readonly _selected = observableValue<boolean>('selected', false);
public readonly selectedObservable: IObservable<boolean> = this._selected;

// React consumes observables
const selected = useObservedValue(cell.selectedObservable);
```

Benefits:
- Type-safe state management
- Automatic React re-rendering
- Decoupled model and view layers

### One Webview Per Output

Unlike VS Code notebooks (single giant webview for all outputs):
- Each output gets its own webview instance
- Simpler lifecycle management
- Better isolation between outputs
- Trade-off: More webview overhead

### Feature Flag Architecture

```typescript
// Check if feature is enabled
if (usingPositronNotebooks(configurationService)) {
	// Positron notebook logic
} else {
	// Fall back to VS Code notebook
}
```

### Shared VS Code Infrastructure

Positron Notebooks reuses:
- `INotebookService` - Notebook model management
- `INotebookKernelService` - Kernel lifecycle
- `INotebookExecutionService` - Cell execution
- `INotebookEditorService` - Editor tracking

Only adds:
- React-based UI layer
- Alternative state management
- Enhanced UX features

## Integration Points

### VS Code Services
- `INotebookService` - Model resolution, notebook lifecycle
- `INotebookKernelService` - Kernel selection and management
- `INotebookExecutionService` - Cell execution coordination
- `INotebookEditorService` - Active editor tracking
- `ICodeEditorService` - Monaco editor management

### Positron Services
- `IPositronNotebookService` - Instance registry and coordination
- `IRuntimeSessionService` - Runtime lifecycle and console integration
- `IPositronConsoleService` - "Execute in Console" functionality
- `IPositronWebviewPreloadService` - Output renderer registration

### Execution Flow

```
User clicks Run
    ↓
CellLeftActionMenu.tsx (React component)
    ↓
Command: 'positronNotebook.cell.execute'
    ↓
PositronNotebookInstance.executeCell()
    ↓
INotebookExecutionService.executeCell()
    ↓
Runtime Kernel queues execution
    ↓
Cell output arrives via INotebookExecutionStateService
    ↓
PositronNotebookCodeCell parses outputs
    ↓
React re-renders with new outputs
    ↓
Webviews mount for each output
```

## Performance Considerations

1. **No virtualization** - All cells render immediately
   - Fine for notebooks < 100 cells
   - Performance degrades with large notebooks
   - Future work: Implement virtual scrolling

2. **Observable overhead** - Every state change triggers observable update
   - Minimal for typical notebooks
   - Can be optimized with derived observables

3. **Webview per output** - More memory than single webview approach
   - Simpler lifecycle management justifies cost
   - Memory usage scales with output count

## Key Constraints

1. **Feature-flagged coexistence** - Must not break VS Code notebooks when disabled
2. **Upstream compatibility** - Minimize modifications to VS Code files
3. **Service reuse** - Don't duplicate VS Code infrastructure
4. **Context key scoping** - Cell keys scoped to cell DOM, not global

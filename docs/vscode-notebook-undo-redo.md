# VS Code Notebook Undo/Redo Architecture

This note captures how upstream VS Code notebooks plug structural cell operations into the platform-wide undo/redo stack. It serves as a reference for reusing the same mechanisms in Positron notebooks.

## High-Level Flow

1. **NotebookTextModel.applyEdits** is the single entry point for structural cell changes. Callers pass the desired edits (insert, delete, move, metadata, outputs, etc.).
2. When `computeUndoRedo` is `true` (the default for VS Code notebooks) the model:
   - Creates/updates a `StackOperation` via its `NotebookOperationManager`.
   - Records inverse edits (`SpliceCellsEdit`, `MoveCellEdit`, `CellMetadataEdit`, …) that know how to perform undo/redo.
   - Pushes the resulting `StackOperation` into the shared `IUndoRedoService`.
3. Undo/redo replays the recorded inverse edits through the same `NotebookTextModel`, so downstream viewers just react to the normal `onDidChangeContent` events.

Because the actual notebook widget only listens to model events, no editor-side changes are required when undo/redo runs.

## Key Pieces in VS Code

### NotebookTextModel (`src/vs/workbench/contrib/notebook/common/model/notebookTextModel.ts`)
- Owns the canonical list of `NotebookCellTextModel`s and exposes `applyEdits`.
- Wraps edit application in a pause/resume scope to coalesce change events and selection updates (`applyEdits`, lines ~588+).
- Delegates undo management to `NotebookOperationManager` when `computeUndoRedo` is enabled.
- Emits `NotebookTextModelChangedEvent`s after edits so views can update.

### NotebookOperationManager (same file, lines ~121+)
- Tracks the pending `StackOperation` for the current edit batch.
- `pushEditOperation` captures individual `IUndoRedoElement`s (splice, move, metadata, outputs) as the model mutates.
- `pushStackElement` finalises the batch and pushes it into `IUndoRedoService` unless the edits were transient.
- Supports appending metadata-only edits to the previous stack element so typing grouping stays intuitive.

### StackOperation (same file, lines ~32+)
- Implements `IWorkspaceUndoRedoElement` so notebook changes can be grouped and labelled on the global stack.
- Records begin/end selection state and the notebook’s alternative version id to restore focus during undo.
- `undo()`/`redo()` iterate the captured `IUndoRedoElement`s in reverse/forward order, calling their own `undo/redo` methods.
- Fires a synthetic `NotebookTextModelChangedEvent` after replay so views refresh selection/focus.

### Cell-Level Undo Elements (`src/vs/workbench/contrib/notebook/common/model/cellEdit.ts`)
- **`SpliceCellsEdit`** restores or reapplies cell insert/delete batches via the model’s editing delegate.
- **`MoveCellEdit`** swaps cell ranges back and forth.
- **`CellMetadataEdit`**, `OutputEdit`, etc. update metadata/output state.
- Each element implements `IResourceUndoRedoElement` and relies on an `ITextCellEditingDelegate` (the `NotebookTextModel`) to change cell collections without creating new undo entries.

### Platform Undo Service (`src/vs/platform/undoRedo/common/undoRedo.ts`)
- Provides `pushElement`, `getLastElement`, and dispatches `undo`/`redo` commands for all resources.
- Because notebook edits are registered as resource elements, they participate in the same global history as text buffer edits. Standard commands (`undo`, `redo`, keyboard shortcuts) already work.

## What to Mirror in Positron

To use the platform stack instead of a custom manager, Positron notebooks should:

1. Call `NotebookTextModel.applyEdits` with `computeUndoRedo = true` (and `pushUndoStop = true`) for structural edits.
2. Avoid recording the same operation in a parallel history; the model’s undo elements already capture the inverse state.
3. Let standard VS Code undo/redo commands drive the history. No notebook-specific commands are needed unless you want custom keybindings.
4. Keep reacting to `onDidChangeContent`/`onWillAddRemoveCells`—undo will surface through those events automatically.
5. If additional operations are added, rely on existing `IUndoRedoElement`s or author new ones that plug into `NotebookOperationManager` in the same fashion.

## Edge Cases & Grouping

- Metadata-only edits on newly inserted cells are appended to the previous stack element so undo merges them (see `NotebookTextModel.isOnlyEditingMetadataOnNewCells`).
- Selection state is captured before/after the batch and restored inside `StackOperation.undo/redo`, ensuring focus returns to the expected cell.
- Cross-resource grouping is handled by the platform service via `UndoRedoGroup`. The notebook model passes through the group id supplied to `applyEdits`.

## References

- `src/vs/workbench/contrib/notebook/common/model/notebookTextModel.ts`
- `src/vs/workbench/contrib/notebook/common/model/cellEdit.ts`
- `src/vs/platform/undoRedo/common/undoRedo.ts`

Use this outline when adapting Positron’s notebook flow back onto the shared undo/redo infrastructure.

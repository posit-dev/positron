# Positron Notebook Undo/Redo Implementation Plan

## Executive Summary

This document outlines the implementation plan for adding proper undo/redo functionality to Positron notebooks, aligning with VS Code's native notebook architecture. The goal is to enable cell-level structural changes (add, delete, move cells) to be undoable/redoable through the platform's standard undo/redo commands.

## Background

### Current State
- Positron notebooks (`PositronNotebookInstance`) already use `NotebookTextModel.applyEdits()` for cell operations
- The `computeUndoRedo` parameter is inconsistently set, sometimes hardcoded to `false`
- No integration with platform undo/redo commands exists for Positron notebooks
- Cell operations are not properly reversible through standard Cmd+Z/Cmd+Shift+Z

### VS Code's Approach
VS Code notebooks leverage the platform-wide `IUndoRedoService` by:
1. Setting `computeUndoRedo=true` when calling `NotebookTextModel.applyEdits()`
2. The `NotebookOperationManager` automatically creates inverse edits and pushes them to the undo stack
3. A contribution hooks platform undo/redo commands to handle notebook-specific behavior
4. Selection state is preserved and restored during undo/redo operations

## Implementation Plan

### Phase 1: Fix Core Undo/Redo Mechanics

#### 1.1 Standardize computeUndoRedo Parameter
**File:** `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`

**Changes Required:**
1. **Line 596**: Fix the `deleteCells` method
   ```typescript
   // CURRENT (incorrect):
   const computeUndoRedo = !readOnly || textModel.viewType === 'interactive';

   // SHOULD BE:
   const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';
   ```

2. **Line 539**: Fix the `addCell` method
   ```typescript
   // CURRENT:
   () => endSelections, undefined, pushUndoStop && !this.isReadOnly

   // CORRECT - already properly implemented
   ```

3. **Line 654**: Verify `deleteCells` uses computed value
   ```typescript
   // Ensure this uses the computeUndoRedo variable, not a hardcoded value
   }, undefined, computeUndoRedo);
   ```

4. **Lines 924, 929**: Fix `clearCellOutput` method
   ```typescript
   // Already correctly uses: const computeUndoRedo = !this.isReadOnly;
   ```

5. **Line 980**: Fix `clearAllCellOutputs` method
   ```typescript
   // Already correctly uses: const computeUndoRedo = !this.isReadOnly;
   ```

6. **Line 1088**: Fix `pasteCells` method
   ```typescript
   // CURRENT:
   () => endSelections, undefined, pushUndoStop && !this.isReadOnly

   // CORRECT - already properly implemented
   ```

### Phase 2: Create Undo/Redo Contribution

#### 2.1 Create New Contribution File
**New File:** `src/vs/workbench/contrib/positronNotebook/browser/contrib/undoRedo/positronNotebookUndoRedo.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../../common/contributions.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { RedoCommand, UndoCommand } from '../../../../../../editor/browser/editorExtensions.js';
import { IPositronNotebookService } from '../../../../../services/positronNotebook/browser/positronNotebookService.js';
import { PositronNotebookEditorInput } from '../../PositronNotebookEditorInput.js';

class PositronNotebookUndoRedoContribution extends Disposable {

	static readonly ID = 'workbench.contrib.positronNotebookUndoRedo';

	constructor(
		@IEditorService private readonly _editorService: IEditorService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService
	) {
		super();

		const PRIORITY = 105; // Same priority as VS Code notebooks

		// Hook into platform undo command
		this._register(UndoCommand.addImplementation(PRIORITY, 'positron-notebook-undo-redo', () => {
			const activeInput = this._editorService.activeEditor;

			// Check if active editor is a Positron notebook
			if (activeInput instanceof PositronNotebookEditorInput) {
				const instance = this._positronNotebookService.getNotebookInstance(activeInput.resource);

				if (instance?.textModel) {
					// The undo operation happens automatically through the platform service
					// because we set computeUndoRedo=true in applyEdits
					// We just need to ensure the notebook has focus
					return true; // Indicate we handled the command
				}
			}

			return false; // Let other handlers process the command
		}));

		// Hook into platform redo command
		this._register(RedoCommand.addImplementation(PRIORITY, 'positron-notebook-undo-redo', () => {
			const activeInput = this._editorService.activeEditor;

			// Check if active editor is a Positron notebook
			if (activeInput instanceof PositronNotebookEditorInput) {
				const instance = this._positronNotebookService.getNotebookInstance(activeInput.resource);

				if (instance?.textModel) {
					// The redo operation happens automatically through the platform service
					// because we set computeUndoRedo=true in applyEdits
					return true; // Indicate we handled the command
				}
			}

			return false; // Let other handlers process the command
		}));
	}
}

// Register the contribution
registerWorkbenchContribution2(
	PositronNotebookUndoRedoContribution.ID,
	PositronNotebookUndoRedoContribution,
	WorkbenchPhase.BlockRestore
);
```

#### 2.2 Register the Contribution
**File:** `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`

Add import at the top of the file:
```typescript
import './contrib/undoRedo/positronNotebookUndoRedo.js';
```

### Phase 3: Testing & Validation

#### 3.1 Manual Testing Checklist
- [ ] **Add Cell**: Insert a new cell, then undo (Cmd+Z) - cell should be removed
- [ ] **Delete Cell**: Delete a cell, then undo - cell should be restored with content
- [ ] **Delete Multiple Cells**: Select and delete multiple cells, then undo - all cells restored
- [ ] **Move Cell**: Move a cell up/down, then undo - cell returns to original position
- [ ] **Clear Output**: Clear cell outputs, then undo - outputs should be restored
- [ ] **Clear All Outputs**: Clear all outputs, then undo - all outputs restored
- [ ] **Paste Cells**: Paste cells, then undo - pasted cells removed
- [ ] **Multiple Operations**: Perform several operations, then undo multiple times
- [ ] **Redo**: After undoing, test redo (Cmd+Shift+Z) for all operations

#### 3.2 Edge Cases to Test
- [ ] Undo/redo with empty notebook
- [ ] Undo/redo with single cell (ensure notebook doesn't become empty)
- [ ] Undo/redo during cell execution
- [ ] Undo/redo with markdown cells in edit mode
- [ ] Undo/redo with unsaved changes
- [ ] Read-only notebooks should not create undo entries

### Phase 4: Future Enhancements (Optional)

#### 4.1 Per-Cell Undo/Redo Configuration
Add support for cell-level undo/redo (like VS Code):

1. Add configuration setting in `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts`:
```typescript
'positronNotebook.undoRedoPerCell': {
    description: 'Whether to use separate undo/redo stack for each cell.',
    type: 'boolean',
    default: false
}
```

2. Register URI comparison key computer for cell-level undo/redo

#### 4.2 Selection State Preservation
Enhance undo/redo to restore selection state:
- Capture selection before operations
- Restore selection after undo/redo
- Focus the appropriate cell after undo/redo

## Technical Notes

### How VS Code's Undo/Redo Works
1. **NotebookTextModel.applyEdits()** is the single entry point for all structural changes
2. When `computeUndoRedo=true`, the `NotebookOperationManager`:
   - Creates `StackOperation` instances
   - Records inverse edits (`SpliceCellsEdit`, `MoveCellEdit`, etc.)
   - Pushes operations to `IUndoRedoService`
3. Undo/redo replays inverse edits through the same `applyEdits` method
4. Views react to standard `onDidChangeContent` events

### Key Files in VS Code for Reference
- `src/vs/workbench/contrib/notebook/common/model/notebookTextModel.ts` - Core model with applyEdits
- `src/vs/workbench/contrib/notebook/common/model/cellEdit.ts` - Undo element implementations
- `src/vs/workbench/contrib/notebook/browser/contrib/undoRedo/notebookUndoRedo.ts` - VS Code's contribution
- `src/vs/platform/undoRedo/common/undoRedo.ts` - Platform undo service

## Success Criteria
1. All cell structural operations are undoable/redoable
2. Standard keyboard shortcuts (Cmd+Z/Cmd+Shift+Z) work correctly
3. Undo/redo maintains notebook consistency (no corrupted state)
4. Selection and focus are reasonably preserved
5. Read-only notebooks don't pollute the undo stack
6. Performance is not degraded

## Implementation Timeline
- **Phase 1**: 1 hour - Fix core parameter issues
- **Phase 2**: 2 hours - Create and test contribution
- **Phase 3**: 2 hours - Comprehensive testing
- **Phase 4**: Optional - 4 hours if implementing per-cell undo/redo

## Risks & Mitigations
- **Risk**: Conflicts with existing Positron-specific behavior
  - **Mitigation**: Careful testing of all notebook operations
- **Risk**: Performance impact from undo stack growth
  - **Mitigation**: Platform service already handles memory management
- **Risk**: Cell execution state conflicts with undo/redo
  - **Mitigation**: Test thoroughly with running cells

## Conclusion
This implementation leverages VS Code's existing undo/redo infrastructure, requiring minimal code changes while providing full undo/redo functionality for Positron notebooks. The key insight is that once `computeUndoRedo=true` is properly set, the platform handles most of the complexity automatically.
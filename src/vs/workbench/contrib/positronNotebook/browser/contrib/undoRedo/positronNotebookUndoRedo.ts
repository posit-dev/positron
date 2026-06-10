/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../../common/contributions.js';
import { UndoCommand, RedoCommand } from '../../../../../../editor/browser/editorExtensions.js';
import { NotebookContextKeys } from '../../../common/notebookContextKeys.js';
import { IUndoRedoService } from '../../../../../../platform/undoRedo/common/undoRedo.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';
import { NotebookOperationType } from '../../IPositronNotebookInstance.js';

/**
 * Returns true when the active Positron notebook should claim the undo/redo
 * command -- i.e. the notebook editor container is focused, a cell editor is
 * focused, or the notebook is empty (so neither can hold focus but undo/redo
 * should still unwind cell operations).
 */
function shouldHandleUndoRedo(editorService: IEditorService): boolean {
	// Get the active notebook instance to access its scoped context key service
	const instance = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!instance) {
		return false;
	}

	// Determine if the notebook is empty. This is important because when there are no cells,
	// neither the container or cell editor will have focus, but we still want undo/redo to work.
	// This enables undoing cell operations (cut and delete) that result in an empty notebook.
	const emptyNotebook = instance.cells.get().length === 0;

	// Use the notebook-specific scoped context key service instead of the global one
	const { scopedContextKeyService } = instance;

	// Read context keys from the scoped context service that actually has these keys bound
	const containerFocused = scopedContextKeyService.getContextKeyValue<boolean>(NotebookContextKeys.editorFocused.key) ?? false;
	const cellEditorFocused = scopedContextKeyService.getContextKeyValue<boolean>(NotebookContextKeys.cellEditorFocused.key) ?? false;

	// Handle undo/redo if the container is focused OR a cell editor is focused OR the notebook is empty
	// This allows undo to work even when typing in a cell (common after adding a new cell)
	return containerFocused || cellEditorFocused || emptyNotebook;
}

/**
 * Body of the UndoCommand handler the contribution registers. Exported so
 * tests can drive the same code path the global UndoCommand dispatcher would
 * hit without standing up a keybinding harness.
 *
 * Returns `false` to yield to the next priority handler when the notebook
 * isn't focused or has nothing to undo; otherwise sets the Undo operation
 * flag on the active notebook and dispatches through the undo/redo service.
 */
export function handleNotebookUndo(
	editorService: IEditorService,
	undoRedoService: IUndoRedoService,
): boolean | Promise<void> {
	if (!shouldHandleUndoRedo(editorService)) {
		return false;
	}

	const instance = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!instance) {
		return false;
	}

	if (!undoRedoService.canUndo(instance.uri)) {
		return false;
	}

	instance.setCurrentOperation(NotebookOperationType.Undo);

	try {
		const result = undoRedoService.undo(instance.uri);
		// If successful, _syncCells() will clear the flag
		return result ?? true;
	} catch (error) {
		instance.clearCurrentOperation();
		throw error;
	}
}

/**
 * Body of the RedoCommand handler the contribution registers. Symmetric to
 * {@link handleNotebookUndo}; see that function's doc comment for semantics.
 */
export function handleNotebookRedo(
	editorService: IEditorService,
	undoRedoService: IUndoRedoService,
): boolean | Promise<void> {
	if (!shouldHandleUndoRedo(editorService)) {
		return false;
	}

	const instance = getNotebookInstanceFromActiveEditorPane(editorService);
	if (!instance) {
		return false;
	}

	if (!undoRedoService.canRedo(instance.uri)) {
		return false;
	}

	instance.setCurrentOperation(NotebookOperationType.Redo);

	try {
		const result = undoRedoService.redo(instance.uri);
		// If successful, _syncCells() will clear the flag
		return result ?? true;
	} catch (error) {
		instance.clearCurrentOperation();
		throw error;
	}
}

export class PositronNotebookUndoRedoContribution extends Disposable {

	static readonly ID = 'workbench.contrib.positronNotebookUndoRedo';

	constructor(
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();

		const PRIORITY = 105;

		this._register(UndoCommand.addImplementation(PRIORITY, 'positron-notebook-undo-redo',
			() => handleNotebookUndo(this.editorService, this.undoRedoService)));
		this._register(RedoCommand.addImplementation(PRIORITY, 'positron-notebook-undo-redo',
			() => handleNotebookRedo(this.editorService, this.undoRedoService)));
	}
}

registerWorkbenchContribution2(
	PositronNotebookUndoRedoContribution.ID,
	PositronNotebookUndoRedoContribution,
	WorkbenchPhase.BlockRestore
);

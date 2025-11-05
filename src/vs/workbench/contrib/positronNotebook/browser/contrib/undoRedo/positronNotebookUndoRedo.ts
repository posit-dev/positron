/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../../common/contributions.js';
import { UndoCommand, RedoCommand } from '../../../../../../editor/browser/editorExtensions.js';
import { POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED, POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED } from '../../ContextKeysManager.js';
import { IUndoRedoService } from '../../../../../../platform/undoRedo/common/undoRedo.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../notebookUtils.js';
import { NotebookOperationType } from '../../IPositronNotebookInstance.js';

class PositronNotebookUndoRedoContribution extends Disposable {

	static readonly ID = 'workbench.contrib.positronNotebookUndoRedo';

	constructor(
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService,
		@IEditorService private readonly editorService: IEditorService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();

		const PRIORITY = 105;

		this._register(UndoCommand.addImplementation(PRIORITY, 'positron-notebook-undo-redo', () => this.handleUndo()));
		this._register(RedoCommand.addImplementation(PRIORITY, 'positron-notebook-undo-redo', () => this.handleRedo()));
	}

	private shouldHandleUndoRedo(): boolean {
		// Get the active notebook instance to access its scoped context key service
		const instance = getNotebookInstanceFromActiveEditorPane(this.editorService);
		if (!instance) {
			return false;
		}

		// Use the notebook-specific scoped context key service instead of the global one
		const scopedContextKeyService = instance.scopedContextKeyService;
		if (!scopedContextKeyService) {
			// Fallback to global context service if scoped service is not available
			// This shouldn't happen in normal operation, but provides a safety net
			const containerFocused = this.contextKeyService.getContextKeyValue<boolean>(POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED.key) ?? false;
			const cellEditorFocused = this.contextKeyService.getContextKeyValue<boolean>(POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.key) ?? false;
			// Handle undo/redo if either the container is focused OR a cell editor is focused
			// This matches VS Code's behavior where notebook undo works regardless of specific focus location
			return containerFocused || cellEditorFocused;
		}

		// Read context keys from the scoped context service that actually has these keys bound
		const containerFocused = scopedContextKeyService.getContextKeyValue<boolean>(POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED.key) ?? false;
		const cellEditorFocused = scopedContextKeyService.getContextKeyValue<boolean>(POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.key) ?? false;

		// Handle undo/redo if either the container is focused OR a cell editor is focused
		// This allows undo to work even when typing in a cell (common after adding a new cell)
		return containerFocused || cellEditorFocused;
	}

	private handleUndo(): boolean | Promise<void> {
		if (!this.shouldHandleUndoRedo()) {
			return false;
		}

		const instance = getNotebookInstanceFromActiveEditorPane(this.editorService);
		if (!instance) {
			return false;
		}

		if (!this.undoRedoService.canUndo(instance.uri)) {
			return false;
		}

		instance.setCurrentOperation(NotebookOperationType.Undo);

		try {
			const result = this.undoRedoService.undo(instance.uri);
			// If successful, _syncCells() will clear the flag
			return result ?? true;
		} catch (error) {
			instance.clearCurrentOperation();
			throw error;
		}
	}

	private handleRedo(): boolean | Promise<void> {
		if (!this.shouldHandleUndoRedo()) {
			return false;
		}

		const instance = getNotebookInstanceFromActiveEditorPane(this.editorService);
		if (!instance) {
			return false;
		}

		if (!this.undoRedoService.canRedo(instance.uri)) {
			return false;
		}

		instance.setCurrentOperation(NotebookOperationType.Redo);

		try {
			const result = this.undoRedoService.redo(instance.uri);
			// If successful, _syncCells() will clear the flag
			return result ?? true;
		} catch (error) {
			instance.clearCurrentOperation();
			throw error;
		}
	}
}

registerWorkbenchContribution2(
	PositronNotebookUndoRedoContribution.ID,
	PositronNotebookUndoRedoContribution,
	WorkbenchPhase.BlockRestore
);

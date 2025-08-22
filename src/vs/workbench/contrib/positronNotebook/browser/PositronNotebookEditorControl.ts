/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICompositeCodeEditor, IEditor } from '../../../../editor/common/editorCommon.js';
import { SelectionState } from '../../../services/positronNotebook/browser/selectionMachine.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';

/**
 * The PositronNotebookEditorControl is used by features like inline chat, debugging, and outlines
 * to access the code editor widget of the selected cell in a Positron notebook.
 *
 * TODO: Some notebook functionality (possibly debugging and outlines) require that the editor control
 * also have a `notebookEditor: INotebookEditor` property. We'll need to investigate what that unlocks,
 * whether to implement INotebookEditor, or find a different solution.
 */
export class PositronNotebookEditorControl extends Disposable implements ICompositeCodeEditor {
	private readonly _onDidChangeActiveEditor = this._register(new Emitter<this>());

	/**
	 * Event that fires when the active cell, and therefore the active code editor, changes.
	 */
	public readonly onDidChangeActiveEditor = this._onDidChangeActiveEditor.event;

	/**
	 * The active cell's code editor.
	 */
	private _activeCodeEditor: IEditor | undefined;

	/**
	 * Disposables for the current notebook instance.
	 */
	private readonly _instanceDisposables = this._register(new DisposableStore());

	/**
	 * Gets the active cell's code editor.
	 */
	public get activeCodeEditor(): IEditor | undefined {
		return this._activeCodeEditor;
	}

	/**
	 * Sets the notebook instance for the editor control.
	 * @param notebookInstance The notebook instance to set.
	 */
	public setNotebookInstance(notebookInstance: PositronNotebookInstance): void {
		// Stop listening to events from a previous notebook instance.
		this._instanceDisposables.clear();

		// Update the active code editor when the notebook selection state changes.
		this._instanceDisposables.add(
			notebookInstance.selectionStateMachine.onNewState((state) => {
				if (state.type === SelectionState.EditingSelection) {
					this._activeCodeEditor = state.selectedCell.editor;
				} else if (state.type === SelectionState.NoSelection) {
					this._activeCodeEditor = undefined;
				} else {
					this._activeCodeEditor = state.selected[0]?.editor;
				}
			})
		);
	}
}

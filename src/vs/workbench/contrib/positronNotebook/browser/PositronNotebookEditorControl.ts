/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { ICompositeCodeEditor, IEditor } from '../../../../editor/common/editorCommon.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';
import { getSelectedCells } from './selectionMachine.js';

/**
 * The PositronNotebookEditorControl is used by features like inline chat, debugging, and outlines
 * to access the code editor widget of the selected cell in a Positron notebook.
 *
 * TODO: Some notebook functionality (possibly debugging and outlines) require that the editor control
 * also have a `notebookEditor: INotebookEditor` property. We'll need to investigate what that unlocks,
 * whether to implement INotebookEditor, or find a different solution.
 */
export class PositronNotebookEditorControl extends Disposable implements ICompositeCodeEditor {
	/**
	 * Event that fires when the active cell, and therefore the active code editor, changes.
	 */
	public readonly onDidChangeActiveEditor = Event.None;

	/**
	 * The active cell's code editor.
	 */
	private _activeCodeEditor: IEditor | undefined;

	constructor(
		private readonly _notebookInstance: PositronNotebookInstance,
	) {
		super();

		// Update the active code editor when the notebook selection state changes.
		this._register(autorun(reader => {
			const selectionStateMachine = this._notebookInstance.selectionStateMachine;
			selectionStateMachine.state.read(reader);
			// We currently assume that the first selected cell is the "active" one,
			// but we should probably explicitly track the active cell in the selection state.
			this._activeCodeEditor = getSelectedCells(selectionStateMachine.state.get())[0]?.editor;
		}));
	}

	/**
	 * Gets the active cell's code editor.
	 */
	public get activeCodeEditor(): IEditor | undefined {
		return this._activeCodeEditor;
	}
}

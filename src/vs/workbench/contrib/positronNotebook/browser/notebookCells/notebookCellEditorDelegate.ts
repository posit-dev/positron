/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISize } from '../../../../../base/browser/positronReactRenderer.js';
import { derived, IObservable } from '../../../../../base/common/observable.js';
import { IBaseCellEditorOptions } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookOptions } from '../../../notebook/browser/notebookOptions.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { CellSelectionType, SelectionState } from '../selectionMachine.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';
import { CellEditorFocusStatus, ICellEditorDelegate } from './CellEditor.js';

/**
 * The {@link ICellEditorDelegate} backed by a Positron notebook instance: it
 * routes the editor's host needs (sizing, options, selection, containment) to
 * the notebook's selection state machine and container. This is the bridge that
 * keeps {@link CellEditor} itself host-agnostic.
 */
export class NotebookCellEditorDelegate implements ICellEditorDelegate {
	constructor(
		private readonly _instance: IPositronNotebookInstance,
		readonly size: IObservable<ISize>,
	) { }

	get notebookOptions(): NotebookOptions {
		return this._instance.notebookOptions;
	}

	getBaseCellEditorOptions(language: string): IBaseCellEditorOptions {
		return this._instance.getBaseCellEditorOptions(language);
	}

	containsElement(element: Element | null): boolean {
		return !!element && !!this._instance.currentContainer?.contains(element);
	}

	cellFocusStatus(cell: PositronNotebookCellGeneral): IObservable<CellEditorFocusStatus> {
		return derived(reader => {
			const state = this._instance.selectionStateMachine.state.read(reader);
			if (state.type === SelectionState.EditingSelection && state.active === cell) {
				return 'editing';
			}
			if (state.type === SelectionState.SingleSelection && state.active === cell) {
				return 'activeSingle';
			}
			return 'inactive';
		});
	}

	enterEditor(cell: PositronNotebookCellGeneral): void {
		this._instance.selectionStateMachine.enterEditor(cell);
	}

	exitEditor(cell: PositronNotebookCellGeneral): void {
		this._instance.selectionStateMachine.exitEditor(cell);
	}

	addCellToSelection(cell: PositronNotebookCellGeneral): void {
		this._instance.selectionStateMachine.selectCell(cell, CellSelectionType.Add);
	}
}

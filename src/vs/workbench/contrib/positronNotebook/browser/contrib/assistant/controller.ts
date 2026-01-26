/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { IPositronNotebookContribution } from '../../positronNotebookExtensions.js';
import { INotebookCellDTO, INotebookContextDTO, NotebookCellType } from '../../../../../common/positron/notebookAssistant.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { getActiveCell, getSelectedCells } from '../../selectionMachine.js';

/**
 * Controller for providing assistant context from the notebook.
 * Handles gathering notebook and cell information for the AI assistant panel.
 */
export class PositronNotebookAssistantController extends Disposable implements IPositronNotebookContribution {
	public static readonly ID = 'positron.notebook.contrib.assistantController';

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
	) {
		super();
	}

	public static get(notebook: IPositronNotebookInstance): PositronNotebookAssistantController | undefined {
		return notebook.getContribution<PositronNotebookAssistantController>(PositronNotebookAssistantController.ID);
	}

	/**
	 * Get the assistant context for this notebook.
	 * Returns the context DTO with cell information for the assistant panel.
	 */
	async getAssistantContext(): Promise<INotebookContextDTO | undefined> {
		const cells = this._notebook.cells.get();
		const kernel = this._notebook.kernel.get();
		const selectionState = this._notebook.selectionStateMachine.state.get();

		const allCells: INotebookCellDTO[] = cells.map(cell => this._mapCellToDTO(cell, selectionState));
		const selectedCells = this._getSelectedCellsFromState(selectionState).map(cell => this._mapCellToDTO(cell, selectionState));

		return {
			uri: this._notebook.uri.toString(),
			kernelId: kernel?.id,
			kernelLanguage: kernel?.runtime.languageId,
			cellCount: cells.length,
			selectedCells,
			allCells
		};
	}

	/**
	 * Maps a cell to its DTO representation for the assistant context.
	 */
	private _mapCellToDTO(cell: IPositronNotebookCell, selectionState: ReturnType<typeof this._notebook.selectionStateMachine.state.get>): INotebookCellDTO {
		const cellOutputs = cell.outputs?.get() ?? [];
		// Use the isMarkdownCell type guard to determine cell type
		const isCodeCell = !cell.isMarkdownCell();

		const dto: INotebookCellDTO = {
			id: cell.uri.toString(),
			index: cell.index,
			type: isCodeCell ? NotebookCellType.Code : NotebookCellType.Markdown,
			content: cell.getContent(),
			hasOutput: cellOutputs.length > 0,
			selectionStatus: this._getCellSelectionStatusFromState(cell, selectionState)
		};

		return dto;
	}

	/**
	 * Gets the selection status for a cell based on the current selection state.
	 */
	private _getCellSelectionStatusFromState(cell: IPositronNotebookCell, selectionState: ReturnType<typeof this._notebook.selectionStateMachine.state.get>): 'active' | 'selected' | 'unselected' {
		const activeCell = getActiveCell(selectionState);
		if (activeCell === cell) {
			return 'active';
		}
		const selectedCells = getSelectedCells(selectionState);
		if (selectedCells.includes(cell)) {
			return 'selected';
		}
		return 'unselected';
	}

	/**
	 * Gets the selected cells from the current selection state.
	 */
	private _getSelectedCellsFromState(selectionState: ReturnType<typeof this._notebook.selectionStateMachine.state.get>): IPositronNotebookCell[] {
		return getSelectedCells(selectionState);
	}
}

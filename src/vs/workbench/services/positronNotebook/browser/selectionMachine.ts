/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { autorun, derived, IObservable, observableValueOpts } from '../../../../base/common/observable.js';
import { IPositronNotebookCell } from '../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { disposableTimeout } from '../../../../base/common/async.js';

export enum SelectionState {
	NoSelection = 'NoSelection',
	SingleSelection = 'SingleSelection',
	MultiSelection = 'MultiSelection',
	EditingSelection = 'EditingSelection'
}

type SelectionStates =
	| {
		type: SelectionState.NoSelection;
	}
	| {
		type: SelectionState.SingleSelection;
		selectedHandles: number[];
	}
	| {
		type: SelectionState.MultiSelection;
		selectedHandles: number[];
	}
	| {
		type: SelectionState.EditingSelection;
		selectedHandle: number;
	};

export enum CellSelectionType {
	Add = 'Add',
	Edit = 'Edit',
	Normal = 'Normal'
}

/**
 * Determines if two selection states are logically equivalent.
 */
function areSelectionStatesEqual(a: SelectionStates, b: SelectionStates): boolean {
	switch (a.type) {
		case SelectionState.NoSelection:
			return a.type === b.type;
		case SelectionState.SingleSelection:
		case SelectionState.MultiSelection:
			return a.type === b.type &&
				a.selectedHandles.length === b.selectedHandles.length &&
				a.selectedHandles.every(h => b.selectedHandles.includes(h));
		case SelectionState.EditingSelection:
			return a.type === b.type &&
				a.selectedHandle === b.selectedHandle;
		default:
			return false;
	}
}

export class SelectionStateMachine extends Disposable {
	//#region Private Properties
	private readonly _state = observableValueOpts<SelectionStates>({
		owner: this,
		equalsFn: areSelectionStatesEqual
	}, { type: SelectionState.NoSelection });
	private readonly _selectedCells: IObservable<{ type: SelectionState; cells: IPositronNotebookCell[] }>;
	private readonly _selectedCell: IObservable<IPositronNotebookCell | null>;
	private readonly _editingCell: IObservable<IPositronNotebookCell | null>;
	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor(
		private readonly _cells: IObservable<IPositronNotebookCell[]>,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Derive the selected cells from selected cell handles
		this._selectedCells = derived(this, reader => {
			const state = this._state.read(reader);
			const cells = this._cells.read(reader);

			switch (state.type) {
				case SelectionState.SingleSelection:
				case SelectionState.MultiSelection:
					return {
						type: state.type,
						cells: cells.filter(c => state.selectedHandles.includes(c.handleId))
					};
				case SelectionState.EditingSelection:
					return {
						type: state.type,
						cells: cells.filter(c => c.handleId === state.selectedHandle)
					};
				case SelectionState.NoSelection:
				default:
					return {
						type: state.type,
						cells: []
					};
			}
		});

		// Derive single selected cell from selected cells
		this._selectedCell = derived(this, reader => {
			const selection = this._selectedCells.read(reader);
			return selection.cells.length === 1 ? selection.cells[0] : null;
		});

		// Derive editing cell from state
		this._editingCell = derived(this, reader => {
			const state = this._state.read(reader);
			if (state.type !== SelectionState.EditingSelection) {
				return null;
			}
			const cells = this._cells.read(reader);
			return cells.find(c => c.handleId === state.selectedHandle) || null;
		});

		// Auto-clear selection if selected cells are removed
		this._register(autorun(reader => {
			const selection = this._selectedCells.read(reader);
			const state = this._state.get();

			// If we have a selection but no cells match anymore, clear selection
			if (state.type !== SelectionState.NoSelection && selection.cells.length === 0) {
				this._setState({ type: SelectionState.NoSelection });
			}
		}));
	}
	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Observable of the current selection state
	 */
	get state(): IObservable<SelectionStates> {
		return this._state;
	}

	/**
	 * Observable of the currently selected cells
	 */
	get selectedCells(): IObservable<IPositronNotebookCell[]> {
		return this._selectedCells.map(selection => selection.cells);
	}

	/**
	 * Observable of the currently selected single cell (null if none or multiple)
	 */
	get selectedCell(): IObservable<IPositronNotebookCell | null> {
		return this._selectedCell;
	}

	/**
	 * Observable of the currently editing cell (null if not editing)
	 */
	get editingCell(): IObservable<IPositronNotebookCell | null> {
		return this._editingCell;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Selects a cell.
	 * @param cell The cell to select.
	 * @param selectType The type of selection to perform.
	 */
	selectCell(cell: IPositronNotebookCell, selectType: CellSelectionType = CellSelectionType.Normal): void {
		const state = this._state.get();

		if (selectType === CellSelectionType.Normal) {
			this._setState({ type: SelectionState.SingleSelection, selectedHandles: [cell.handleId] });
			return;
		}

		if (selectType === CellSelectionType.Edit) {
			this._setState({ type: SelectionState.EditingSelection, selectedHandle: cell.handleId });
			return;
		}

		if (selectType === CellSelectionType.Add) {
			if (state.type === SelectionState.NoSelection) {
				this._setState({ type: SelectionState.SingleSelection, selectedHandles: [cell.handleId] });
				return;
			}

			if (state.type === SelectionState.SingleSelection) {
				// Check if cell is already selected
				if (state.selectedHandles.includes(cell.handleId)) {
					return;
				}
				this._setState({ type: SelectionState.MultiSelection, selectedHandles: [...state.selectedHandles, cell.handleId] });
				return;
			}

			if (state.type === SelectionState.MultiSelection) {
				// Check if cell is already in the selection
				if (state.selectedHandles.includes(cell.handleId)) {
					return;
				}
				this._setState({ type: SelectionState.MultiSelection, selectedHandles: [...state.selectedHandles, cell.handleId] });
				return;
			}
		}

		// Shouldn't get here.
		this._logService.error('Unknown selection state', state, { selectType });
	}

	/**
	 * Removes selection from a cell.
	 * @param cell The cell to deselect.
	 * @returns
	 */
	deselectCell(cell: IPositronNotebookCell): void {
		const state = this._state.get();

		if (state.type === SelectionState.NoSelection) {
			return;
		}

		const deselectingCurrentSelection = (state.type === SelectionState.SingleSelection && state.selectedHandles.includes(cell.handleId))
			|| (state.type === SelectionState.EditingSelection && state.selectedHandle === cell.handleId);

		if (deselectingCurrentSelection) {
			this._setState({ type: SelectionState.NoSelection });
			return;
		}

		if (state.type === SelectionState.MultiSelection) {
			const updatedHandles = state.selectedHandles.filter(h => h !== cell.handleId);
			if (updatedHandles.length === 0) {
				this._setState({ type: SelectionState.NoSelection });
			} else if (updatedHandles.length === 1) {
				this._setState({ type: SelectionState.SingleSelection, selectedHandles: updatedHandles });
				// TODO: This should happen in the view layer...
				// Focus the remaining cell
				const remainingCell = this._cells.get().find(c => c.handleId === updatedHandles[0]);
				remainingCell?.focus();
			} else {
				this._setState({ type: SelectionState.MultiSelection, selectedHandles: updatedHandles });
				// TODO: This should happen in the view layer...
				// Focus the last cell in selection
				const lastHandle = updatedHandles[updatedHandles.length - 1];
				const lastCell = this._cells.get().find(c => c.handleId === lastHandle);
				lastCell?.focus();
			}
		}

		// If the cell is not in the selection, do nothing.
	}

	/**
	 * Move the selection up.
	 * @param addMode If true, the selection will be added to the current selection.
	 */
	moveUp(addMode: boolean): void {
		this._moveSelection(true, addMode);
	}

	/**
	 * Move the selection down.
	 * @param addMode If true, the selection will be added to the current selection.
	 */
	moveDown(addMode: boolean): void {
		this._moveSelection(false, addMode);
	}

	/**
	 * Enters the editor for the selected cell.
	 */
	enterEditor(): void {
		const selection = this._selectedCells.get();
		if (selection.type !== SelectionState.SingleSelection || selection.cells.length === 0) {
			return;
		}

		const cellToEdit = selection.cells[0];
		this._setState({ type: SelectionState.EditingSelection, selectedHandle: cellToEdit.handleId });
		// Timeout here avoids the problem of enter applying to the editor widget itself.
		this._register(
			disposableTimeout(async () => await cellToEdit.showEditor(true), 0)
		);
	}

	/**
	 * Reset the selection to the cell so user can navigate between cells
	 */
	exitEditor(): void {
		const state = this._state.get();
		if (state.type !== SelectionState.EditingSelection) { return; }

		const selectedCell = this._cells.get().find(c => c.handleId === state.selectedHandle);
		if (selectedCell) {
			selectedCell.defocusEditor();
		}
		this._setState({ type: SelectionState.SingleSelection, selectedHandles: [state.selectedHandle] });
	}

	/**
	 * Get the index of the selected cell.
	 * @returns The index of the selected cell. -1 if there is no selection.
	 */
	getIndexOfSelectedCell(): number | null {
		const cell = this._selectedCell.get();
		if (cell) {
			const cells = this._cells.get();
			return cells.indexOf(cell);
		}
		return null;
	}

	/**
	 * Check if a specific cell is currently selected.
	 * @param cell The cell to check
	 * @returns True if the cell is selected, false otherwise
	 */
	isCellSelected(cell: IPositronNotebookCell): boolean {
		const state = this._state.get();

		switch (state.type) {
			case SelectionState.SingleSelection:
			case SelectionState.MultiSelection:
				return state.selectedHandles.includes(cell.handleId);
			case SelectionState.EditingSelection:
				return state.selectedHandle === cell.handleId;
			case SelectionState.NoSelection:
			default:
				return false;
		}
	}

	//#endregion Public Methods


	//#region Private Methods
	private _setState(state: SelectionStates) {
		// Alert the observable that the state has changed.
		this._state.set(state, undefined);
	}



	private _moveSelection(up: boolean, addMode: boolean) {
		const state = this._state.get();
		const cells = this._cells.get();

		if (state.type === SelectionState.EditingSelection) {
			return;
		}
		if (state.type === SelectionState.NoSelection) {
			// Select first cell if selecting down and the last cell if selecting up.
			const cellToSelect = cells.at(up ? -1 : 0);
			if (cellToSelect) {
				this.selectCell(cellToSelect, CellSelectionType.Normal);
			}
			return;
		}

		// Get the edge handle based on direction and selection type
		const edgeHandle = state.selectedHandles[up ? 0 : state.selectedHandles.length - 1];
		const edgeCell = cells.find(c => c.handleId === edgeHandle);
		if (!edgeCell) {
			return;
		}

		const indexOfEdgeCell = cells.indexOf(edgeCell);
		const nextCell = cells[indexOfEdgeCell + (up ? -1 : 1)];

		if (!nextCell) {
			return;
		}

		if (addMode) {
			// Build new selection handles
			let newHandles: number[];
			if (state.type === SelectionState.SingleSelection) {
				newHandles = up ? [nextCell.handleId, ...state.selectedHandles] : [...state.selectedHandles, nextCell.handleId];
			} else {
				// Check if nextCell is already in selection
				if (state.selectedHandles.includes(nextCell.handleId)) {
					return;
				}
				newHandles = up ? [nextCell.handleId, ...state.selectedHandles] : [...state.selectedHandles, nextCell.handleId];
			}
			this._setState({
				type: SelectionState.MultiSelection,
				selectedHandles: newHandles
			});
			return;
		}

		if (state.type === SelectionState.MultiSelection) {
			this.selectCell(nextCell, CellSelectionType.Normal);
			return;
		}

		// If meta is not held down, we're in single selection mode.
		this.selectCell(nextCell, CellSelectionType.Normal);
		nextCell.focus();
	}
	//#endregion Private Methods

}

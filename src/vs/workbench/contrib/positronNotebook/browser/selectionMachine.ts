/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { autorun, IObservable, observableValueOpts } from '../../../../base/common/observable.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
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
		selected: IPositronNotebookCell[];
	}
	| {
		type: SelectionState.MultiSelection;
		selected: IPositronNotebookCell[];
	}
	| {
		type: SelectionState.EditingSelection;
		selectedCell: IPositronNotebookCell;
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
				a.selected.length === (b as typeof a).selected.length &&
				a.selected.every(cell => (b as typeof a).selected.includes(cell));
		case SelectionState.EditingSelection:
			return a.type === b.type &&
				a.selectedCell === (b as typeof a).selectedCell;
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
	private readonly _selectedCells: IObservable<IPositronNotebookCell[]>;
	private readonly _singleSelectedCell: IObservable<IPositronNotebookCell | null>;
	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor(
		private readonly _cells: IObservable<IPositronNotebookCell[]>,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Derive selected cells from selection state
		this._selectedCells = this._state.map(state => {
			switch (state.type) {
				case SelectionState.SingleSelection:
				case SelectionState.MultiSelection:
					return state.selected;
				case SelectionState.EditingSelection:
					return [state.selectedCell];
				case SelectionState.NoSelection:
				default:
					return [];
			}
		});

		// Derive single selected cell from selected cells
		this._singleSelectedCell = this._selectedCells.map(cells => {
			return cells.length === 1 ? cells[0] : null;
		});

		// Update the selection state when cells change
		this._register(autorun(reader => {
			const cells = this._cells.read(reader);
			this._setCells(cells);
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
		return this._selectedCells;
	}

	/**
	 * Observable of the currently selected single cell (null if none or multiple)
	 */
	get singleSelectedCell(): IObservable<IPositronNotebookCell | null> {
		return this._singleSelectedCell;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Selects a cell.
	 * @param cell The cell to select.
	 * @param selectType The type of selection to perform.
	 */
	selectCell(cell: IPositronNotebookCell, selectType: CellSelectionType = CellSelectionType.Normal): void {
		if (selectType === CellSelectionType.Normal) {
			this._setState({ type: SelectionState.SingleSelection, selected: [cell] });
			return;
		}

		if (selectType === CellSelectionType.Edit) {
			this._setState({ type: SelectionState.EditingSelection, selectedCell: cell });
			return;
		}

		const state = this._state.get();

		if (selectType === CellSelectionType.Add) {
			if (state.type === SelectionState.NoSelection) {
				this._setState({ type: SelectionState.SingleSelection, selected: [cell] });
				return;
			}

			if (state.type === SelectionState.SingleSelection) {
				// Check if cell is already selected
				if (state.selected.includes(cell)) {
					return;
				}
				this._setState({ type: SelectionState.MultiSelection, selected: [...state.selected, cell] });
				return;
			}

			if (state.type === SelectionState.MultiSelection) {
				// Check if cell is already in the selection
				if (state.selected.includes(cell)) {
					return;
				}
				this._setState({ type: SelectionState.MultiSelection, selected: [...state.selected, cell] });
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

		const deselectingCurrentSelection = (state.type === SelectionState.SingleSelection && state.selected.includes(cell))
			|| (state.type === SelectionState.EditingSelection && state.selectedCell === cell);

		if (deselectingCurrentSelection) {
			this._setState({ type: SelectionState.NoSelection });
			return;
		}

		if (state.type === SelectionState.MultiSelection) {
			const updatedCells = state.selected.filter(c => c !== cell);
			if (updatedCells.length === 0) {
				this._setState({ type: SelectionState.NoSelection });
			} else if (updatedCells.length === 1) {
				this._setState({ type: SelectionState.SingleSelection, selected: updatedCells });
				// TODO: This should happen in the view layer...
				// Focus the remaining cell
				updatedCells[0]?.focus();
			} else {
				this._setState({ type: SelectionState.MultiSelection, selected: updatedCells });
				// TODO: This should happen in the view layer...
				// Focus the last cell in selection
				const lastCell = updatedCells[updatedCells.length - 1];
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
		const state = this._state.get();
		if (state.type !== SelectionState.SingleSelection || state.selected.length === 0) {
			return;
		}

		const cellToEdit = state.selected[0];
		this._setState({ type: SelectionState.EditingSelection, selectedCell: cellToEdit });
		// Timeout here avoids the problem of enter applying to the editor widget itself.
		// TODO: Can we move this to the view layer?
		this._register(
			disposableTimeout(async () => await cellToEdit.showEditor(true), 0)
		);
	}

	/**
	 * Reset the selection to the cell so user can navigate between cells
	 */
	exitEditor(): void {
		const state = this._state.get();
		if (state.type !== SelectionState.EditingSelection) {
			return;
		}
		state.selectedCell.defocusEditor();
		this._setState({ type: SelectionState.SingleSelection, selected: [state.selectedCell] });
	}

	//#endregion Public Methods


	//#region Private Methods
	/**
	 * Updates the selection state when cells change.
	 *
	 * @param cells The new cells to set.
	 */
	private _setCells(cells: IPositronNotebookCell[]): void {
		const state = this._state.get();

		if (state.type === SelectionState.NoSelection) {
			return;
		}

		// If we're editing a cell when setCells is called. We need to check if the cell is still in the new cells.
		// If it isn't we need to reset the selection.
		if (state.type === SelectionState.EditingSelection) {
			if (!cells.includes(state.selectedCell)) {
				this._setState({ type: SelectionState.NoSelection });
				return;
			}
			return;
		}

		const newSelection = state.selected.filter(c => cells.includes(c));
		if (newSelection.length === 0) {
			this._setState({ type: SelectionState.NoSelection });
			return;
		}

		this._setState({ type: newSelection.length === 1 ? SelectionState.SingleSelection : SelectionState.MultiSelection, selected: newSelection });
	}


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

		const edgeCell = state.selected.at(up ? 0 : -1)!;
		const indexOfEdgeCell = cells.indexOf(edgeCell);
		const nextCell = cells[indexOfEdgeCell + (up ? -1 : 1)];

		if (!nextCell) {
			return;
		}

		if (addMode) {
			// If the edge cell is at the top or bottom of the cells, and the up or down arrow key is pressed, respectively, do nothing.
			if (indexOfEdgeCell <= 0 && up || indexOfEdgeCell >= cells.length - 1 && !up) {
				// Already at the edge of the cells.
				return;
			}
			const newSelection = up ? [nextCell, ...state.selected] : [...state.selected, nextCell];
			this._setState({
				type: SelectionState.MultiSelection,
				selected: newSelection
			});
			return;
		}

		if (state.type === SelectionState.MultiSelection) {
			this.selectCell(nextCell, CellSelectionType.Normal);
			return;
		}

		// If the edge cell is at the top or bottom of the cells, and the up or down arrow key is pressed, respectively, do nothing.
		if (indexOfEdgeCell <= 0 && up || indexOfEdgeCell >= cells.length - 1 && !up) {
			// Already at the edge of the cells.
			return;
		}

		// If meta is not held down, we're in single selection mode.
		this.selectCell(nextCell, CellSelectionType.Normal);

		nextCell.focus();
	}
	//#endregion Private Methods

}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import { ISettableObservable, observableValue } from 'vs/base/common/observable';
import { IPositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { Event } from 'vs/base/common/event';

type NoSelection = {
	type: 'No Selection';
};

function isNoSelection(state: SelectionStates): state is NoSelection {
	return state.type === 'No Selection';
}

type SingleSelection = {
	type: 'Single Selection';
	selected: IPositronNotebookCell[];
};
function isSingleSelection(state: SelectionStates): state is SingleSelection {
	return state.type === 'Single Selection';
}

type MultiSelection = {
	type: 'Multi Selection';
	selected: IPositronNotebookCell[];
};
function isMultiSelection(state: SelectionStates): state is MultiSelection {
	return state.type === 'Multi Selection';
}

type EditingSelection = {
	type: 'Editing Selection';
	selectedCell: IPositronNotebookCell;
};
function isEditingSelection(state: SelectionStates): state is EditingSelection {
	return state.type === 'Editing Selection';
}

export enum CellSelectionType {
	Add,
	Edit,
	Normal
}

type SelectionStates =
	| NoSelection
	| SingleSelection
	| MultiSelection
	| EditingSelection;

export class SelectionStateMachine {

	private _state: SelectionStates = { type: 'No Selection' };

	// Alert the observable that the state has changed.
	private _setState(state: SelectionStates) {
		this._state = state;
		this.state.set(this._state, undefined);
	}

	private _cells: IPositronNotebookCell[] = [];

	state: ISettableObservable<SelectionStates>;
	onNewState: Event<SelectionStates>;

	constructor() {
		this.state = observableValue('selectionState', this._state);
		this.onNewState = Event.fromObservable(this.state);
	}

	/**
	 * Updates the known cells.
	 *
	 * Handles updating selection if neccesary when cells are added or removed.
	 *
	 * @param cells The new cells to set.
	 */
	setCells(cells: IPositronNotebookCell[]): void {
		this._cells = cells;

		if (isNoSelection(this._state)) {
			return;
		}

		// If we're editing a cell when setCells is called. We need to check if the cell is still in the new cells.
		// If it isn't we need to reset the selection.
		if (isEditingSelection(this._state)) {
			if (!cells.includes(this._state.selectedCell)) {
				this._setState({ type: 'No Selection' });
				return;
			}
			return;
		}

		const selectionAfterNewCells = cellSelectionIntersection(cells, this._state.selected);
		if (selectionAfterNewCells.length === 0) {
			this._setState({ type: 'No Selection' });
			return;
		}

		this._setState({ type: selectionAfterNewCells.length === 1 ? 'Single Selection' : 'Multi Selection', selected: selectionAfterNewCells });
	}

	/**
	 * Selects a cell.
	 * @param cell The cell to select.
	 * @param editMode If true, the cell will be selected in edit mode.
	 */
	selectCell(cell: IPositronNotebookCell, selectType: CellSelectionType = CellSelectionType.Normal): void {

		if (selectType === CellSelectionType.Normal || isNoSelection(this._state) && selectType === CellSelectionType.Add) {
			this._setState({ type: 'Single Selection', selected: [cell] });
			return;
		}

		if (selectType === CellSelectionType.Edit) {
			this._setState({ type: 'Editing Selection', selectedCell: cell });
			return;
		}

		if (isSingleSelection(this._state) || isMultiSelection(this._state)) {
			this._setState({ type: 'Multi Selection', selected: [...this._state.selected, cell] });
			return;
		}

		// Shouldn't get here.
	}

	/**
	 * Removes selection from a cell.
	 * @param cell The cell to deselect.
	 * @returns
	 */
	deselectCell(cell: IPositronNotebookCell): void {
		if (isNoSelection(this._state)) {
			return;
		}

		const deselectingCurrentSelection = isSingleSelection(this._state) || isEditingSelection(this._state) && this._state.selectedCell === cell;

		if (deselectingCurrentSelection) {
			this._setState({ type: 'No Selection' });
			return;
		}

		if (isMultiSelection(this._state)) {
			const updatedSelection = this._state.selected.filter(c => c !== cell);
			// Set focus on the last cell in the selection to avoid confusingly leaving selection
			// styles on cell just deselected. Not sure if this is the best UX.
			updatedSelection.at(-1)?.focus();
			this._setState({ type: updatedSelection.length === 1 ? 'Single Selection' : 'Multi Selection', selected: updatedSelection });
		}

		// If the cell is not in the selection, do nothing.
	}

	private _moveSelection(up: boolean, addMode: boolean) {

		if (isNoSelection(this._state) || isEditingSelection(this._state)) {
			return;
		}

		const edgeCell = this._state.selected.at(up ? 0 : -1)!;
		const indexOfEdgeCell = this._cells.indexOf(edgeCell);
		const nextCell = this._cells[indexOfEdgeCell + (up ? -1 : 1)];

		if (addMode) {
			// If the edge cell is at the top or bottom of the cells, and the up or down arrow key is pressed, respectively, do nothing.
			if (indexOfEdgeCell <= 0 && up || indexOfEdgeCell >= this._cells.length - 1 && !up) {
				// Already at the edge of the cells.
				return;
			}
			const newSelection = up ? [nextCell, ...this._state.selected] : [...this._state.selected, nextCell];
			this._setState({
				type: 'Multi Selection',
				selected: newSelection
			});

			return;
		}

		if (isMultiSelection(this._state)) {
			this._setState({ type: 'Single Selection', selected: [edgeCell] });
			edgeCell.focus();
			return;
		}

		// If the edge cell is at the top or bottom of the cells, and the up or down arrow key is pressed, respectively, do nothing.
		if (indexOfEdgeCell <= 0 && up || indexOfEdgeCell >= this._cells.length - 1 && !up) {
			// Already at the edge of the cells.
			return;
		}

		// If meta is not held down, we're in single selection mode.
		this._setState({ type: 'Single Selection', selected: [nextCell] });

		nextCell.focus();
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
		if (isSingleSelection(this._state)) {
			const cellToEdit = this._state.selected[0];
			this._setState({ type: 'Editing Selection', selectedCell: cellToEdit });
			// Timeout here avoids the problem of enter applying to the editor widget itself.
			setTimeout(() => cellToEdit.focusEditor(), 0);
		}
	}

	/**
	 * Reset the selection to the cell so user can navigate between cells
	 */
	exitEditor(): void {
		if (isEditingSelection(this._state)) {
			this._state.selectedCell.defocusEditor();
			this._setState({ type: 'Single Selection', selected: [this._state.selectedCell] });
		}
	}
}


function cellSelectionIntersection(cells: IPositronNotebookCell[], selection: IPositronNotebookCell[]) {
	if (selection === null) {
		return [];
	}
	const selectedCells = Array.isArray(selection) ? selection : [selection];

	return selectedCells.filter(c => cells.includes(c));
}

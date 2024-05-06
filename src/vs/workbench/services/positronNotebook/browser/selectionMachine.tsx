/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import { ISettableObservable, observableValue } from 'vs/base/common/observable';
import { IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable } from 'vs/base/common/lifecycle';

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

export class SelectionStateMachine extends Disposable {

	//#region Private Properties
	private _state: SelectionStates = { type: SelectionState.NoSelection };
	private _cells: IPositronNotebookCell[] = [];

	/**
	 * A timeout timer that's used to keep track of any pending selection changes. Controlled
	 * with `_cleanTimeout` and `_setSelectionTimeout`.
	 */
	private _selectionTimeout: NodeJS.Timeout | undefined;

	//#endregion Private Properties


	//#region Public Properties
	state: ISettableObservable<SelectionStates>;
	onNewState: Event<SelectionStates>;
	//#endregion Public Properties

	//#region Constructor & Dispose
	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this.state = observableValue('selectionState', this._state);
		this.onNewState = Event.fromObservable(this.state);
	}

	override dispose() {
		this._cleanTimeout();
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Updates the known cells.
	 *
	 * Handles updating selection if neccesary when cells are added or removed.
	 *
	 * @param cells The new cells to set.
	 */
	setCells(cells: IPositronNotebookCell[]): void {
		this._cleanTimeout();
		this._cells = cells;

		if (this._state.type === SelectionState.NoSelection) {
			return;
		}

		// If we're editing a cell when setCells is called. We need to check if the cell is still in the new cells.
		// If it isn't we need to reset the selection.
		if (this._state.type === SelectionState.EditingSelection) {
			if (!cells.includes(this._state.selectedCell)) {
				this._setState({ type: SelectionState.NoSelection });
				return;
			}
			return;
		}

		const selectionAfterNewCells = cellSelectionIntersection(cells, this._state.selected);
		if (selectionAfterNewCells.length === 0) {
			this._setState({ type: SelectionState.NoSelection });
			return;
		}

		this._setState({ type: selectionAfterNewCells.length === 1 ? SelectionState.SingleSelection : SelectionState.MultiSelection, selected: selectionAfterNewCells });
	}

	/**
	 * Selects a cell.
	 * @param cell The cell to select.
	 * @param editMode If true, the cell will be selected in edit mode.
	 */
	selectCell(cell: IPositronNotebookCell, selectType: CellSelectionType = CellSelectionType.Normal): void {
		this._cleanTimeout();
		if (selectType === CellSelectionType.Normal || this._state.type === SelectionState.NoSelection && selectType === CellSelectionType.Add) {
			this._setState({ type: SelectionState.SingleSelection, selected: [cell] });
			return;
		}

		if (selectType === CellSelectionType.Edit) {
			this._setState({ type: SelectionState.EditingSelection, selectedCell: cell });
			return;
		}

		if (this._state.type === SelectionState.SingleSelection || this._state.type === SelectionState.MultiSelection) {
			this._setState({ type: SelectionState.MultiSelection, selected: [...this._state.selected, cell] });
			return;
		}

		// Shouldn't get here.
		this._logService.error('Unknown selection state', this._state, { selectType });
	}

	/**
	 * Removes selection from a cell.
	 * @param cell The cell to deselect.
	 * @returns
	 */
	deselectCell(cell: IPositronNotebookCell): void {
		this._cleanTimeout();
		if (this._state.type === SelectionState.NoSelection) {
			return;
		}

		const deselectingCurrentSelection = this._state.type === SelectionState.SingleSelection
			|| this._state.type === SelectionState.EditingSelection
			&& this._state.selectedCell === cell;

		if (deselectingCurrentSelection) {
			this._setState({ type: SelectionState.NoSelection });
			return;
		}

		if (this._state.type === SelectionState.MultiSelection) {
			const updatedSelection = this._state.selected.filter(c => c !== cell);
			// Set focus on the last cell in the selection to avoid confusingly leaving selection
			// styles on cell just deselected. Not sure if this is the best UX.
			updatedSelection.at(-1)?.focus();
			this._setState({ type: updatedSelection.length === 1 ? SelectionState.SingleSelection : SelectionState.MultiSelection, selected: updatedSelection });
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
		if (this._state.type !== SelectionState.SingleSelection) {
			return;
		}

		const cellToEdit = this._state.selected[0];
		this._setState({ type: SelectionState.EditingSelection, selectedCell: cellToEdit });
		// Timeout here avoids the problem of enter applying to the editor widget itself.
		this._setSelectionTimeout(() => cellToEdit.focusEditor());
	}

	/**
	 * Reset the selection to the cell so user can navigate between cells
	 */
	exitEditor(): void {
		if (this._state.type !== SelectionState.EditingSelection) { return; }
		this._state.selectedCell.defocusEditor();
		this._setState({ type: SelectionState.SingleSelection, selected: [this._state.selectedCell] });
	}

	/**
	 * Get the index of the selected cell.
	 * @returns The index of the selected cell. -1 if there is no selection.
	 */
	getIndexOfSelectedCell(): number | null {
		if (this._state.type === SelectionState.SingleSelection) {
			return this._cells.indexOf(this._state.selected[0]);
		}

		return null;
	}

	/**
	 *
	 * @returns The selected cell. Null if there is no selection.
	 */
	getSelectedCell(): IPositronNotebookCell | null {
		if (this._state.type === SelectionState.SingleSelection) {
			return this._state.selected[0];
		}

		return null;
	}
	//#endregion Public Methods


	//#region Private Methods
	private _setState(state: SelectionStates) {
		this._state = state;
		// Alert the observable that the state has changed.
		this.state.set(this._state, undefined);
	}

	/**
	 * Clears the selection timeout. Useful to prevent weird conditions where a cell is selected
	 * after it has been navigated away from or deselected etc.. Can happen if the user is quickly
	 * navigating between cells.
	 */
	private _cleanTimeout() {
		if (this._selectionTimeout) {
			clearTimeout(this._selectionTimeout);
		}
	}

	private _setSelectionTimeout(fn: () => void) {
		this._cleanTimeout();
		this._selectionTimeout = setTimeout(fn, 0);
	}


	private _moveSelection(up: boolean, addMode: boolean) {

		this._cleanTimeout();
		if (this._state.type === SelectionState.EditingSelection) {
			return;
		}
		if (this._state.type === SelectionState.NoSelection) {
			// Select first cell if selecting down and the last cell if selecting up.
			const cellToSelect = this._cells.at(up ? -1 : 0);
			if (cellToSelect) {
				this._setState({ type: SelectionState.SingleSelection, selected: [cellToSelect] });
				cellToSelect.focus();
			}
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
				type: SelectionState.MultiSelection,
				selected: newSelection
			});

			return;
		}

		if (this._state.type === SelectionState.MultiSelection) {
			this._setState({ type: SelectionState.SingleSelection, selected: [edgeCell] });
			edgeCell.focus();
			return;
		}

		// If the edge cell is at the top or bottom of the cells, and the up or down arrow key is pressed, respectively, do nothing.
		if (indexOfEdgeCell <= 0 && up || indexOfEdgeCell >= this._cells.length - 1 && !up) {
			// Already at the edge of the cells.
			return;
		}

		// If meta is not held down, we're in single selection mode.
		this._setState({ type: SelectionState.SingleSelection, selected: [nextCell] });

		nextCell.focus();
	}
	//#endregion Private Methods

}


function cellSelectionIntersection(cells: IPositronNotebookCell[], selection: IPositronNotebookCell[]) {
	if (selection === null) {
		return [];
	}
	const selectedCells = Array.isArray(selection) ? selection : [selection];

	return selectedCells.filter(c => cells.includes(c));
}

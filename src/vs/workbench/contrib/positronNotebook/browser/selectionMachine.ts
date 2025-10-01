/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { autorun, autorunDelta, IObservable, observableValueOpts } from '../../../../base/common/observable.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

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
 * Get all selected cells based on the current selection state.
 * @param state The selection state to extract cells from
 * @returns An array of selected cells, empty if no selection.
 */
export function getSelectedCells(state: SelectionStates): IPositronNotebookCell[] {
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
}


/**
 * Get the selected cell if there is exactly one selected.
 * @returns The selected cell. Null if there is no selection.
 */
export function getSelectedCell(state: SelectionStates): IPositronNotebookCell | null {
	if (state.type === SelectionState.SingleSelection) {
		return state.selected[0];
	}
	return null;
}

/**
 * Get the cell that is currently being edited.
 * @param state The selection state to check
 * @returns The cell that is currently being edited. Null if no cell is being edited.
 */
export function getEditingCell(state: SelectionStates): IPositronNotebookCell | null {
	if (state.type !== SelectionState.EditingSelection) {
		return null;
	}
	return state.selectedCell;
}

/**
 * Determines if two selection states are equal.
 */
function isSelectionStateEqual(a: SelectionStates, b: SelectionStates): boolean {
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
		debugName: 'selectionState',
		equalsFn: isSelectionStateEqual
	}, { type: SelectionState.NoSelection });

	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor(
		private readonly _cells: IObservable<IPositronNotebookCell[]>,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(autorunDelta(this.state, ({ lastValue, newValue }) => {
			if (lastValue !== undefined) {
				this._updateCellSelectionStatus(lastValue, newValue);
			}
		}));

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

			if (state.type === SelectionState.SingleSelection || state.type === SelectionState.MultiSelection) {
				// Check if cell is already selected
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

		const deselectingCurrentSelection = state.type === SelectionState.SingleSelection
			|| state.type === SelectionState.EditingSelection
			&& state.selectedCell === cell;

		if (deselectingCurrentSelection) {
			this._setState({ type: SelectionState.NoSelection });
			return;
		}

		if (state.type === SelectionState.MultiSelection) {
			const updatedSelection = state.selected.filter(c => c !== cell);
			// React will handle focus based on selection state change
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
	async enterEditor(): Promise<void> {
		const state = this._state.get();
		if (state.type !== SelectionState.SingleSelection) {
			return;
		}

		const cellToEdit = state.selected[0];
		this._setState({ type: SelectionState.EditingSelection, selectedCell: cellToEdit });
		// Ensure editor is shown first (important for markdown cells and lazy-loaded editors)
		await cellToEdit.showEditor();
		// Request editor focus through observable - React will handle it
		cellToEdit.requestEditorFocus();
	}

	/**
	 * Reset the selection to the cell so user can navigate between cells
	 */
	exitEditor(): void {
		const state = this._state.get();
		if (state.type !== SelectionState.EditingSelection) { return; }
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

	/**
	 * Surgically updates the selection status of cells that have changed state.
	 * @param startState The selection state before the change
	 * @param endState The selection state after the change
	 */
	private _updateCellSelectionStatus(
		startState: SelectionStates,
		endState: SelectionStates
	): void {
		// Extract selected and editing cells from start and end states
		const previouslySelected = getSelectedCells(startState);
		const previouslyEditing = getEditingCell(startState);
		const newlySelected = getSelectedCells(endState);
		const newlyEditing = getEditingCell(endState);

		// Create sets for efficient lookups
		const previousSelectedSet = new Set(previouslySelected);
		const newSelectedSet = new Set(newlySelected);

		// Find cells that need status updates
		const cellsToUnselect = previouslySelected.filter(cell => !newSelectedSet.has(cell));
		const cellsToSelect = newlySelected.filter(cell => !previousSelectedSet.has(cell));

		//#region Update cell selection status
		// We do this here instead of letting each cell update itself in an attempt to be more efficient.
		// There's no actual structural reason so if in the future you find yourself here because of a bug,
		// feel free to move this logic into the cells themselves..

		// Update cells that are no longer selected
		cellsToUnselect.forEach(cell => {
			if (cell !== newlyEditing) {
				cell.selectionStatus.set(CellSelectionStatus.Unselected, undefined);
			}
		});

		// Update cells that are newly selected
		cellsToSelect.forEach(cell => {
			if (cell !== newlyEditing) {
				cell.selectionStatus.set(CellSelectionStatus.Selected, undefined);
			}
		});
		//#endregion Update cell selection status

		// Handle editing state transitions
		if (previouslyEditing && previouslyEditing !== newlyEditing) {
			// Previous editing cell is no longer being edited
			if (newSelectedSet.has(previouslyEditing)) {
				previouslyEditing.selectionStatus.set(CellSelectionStatus.Selected, undefined);
			} else {
				previouslyEditing.selectionStatus.set(CellSelectionStatus.Unselected, undefined);
			}
		}

		if (newlyEditing) {
			// New cell is being edited
			newlyEditing.selectionStatus.set(CellSelectionStatus.Editing, undefined);
		}
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
		const indexOfEdgeCell = edgeCell.index;
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

		// React will handle focus based on selection state change
	}

	//#endregion Private Methods

}

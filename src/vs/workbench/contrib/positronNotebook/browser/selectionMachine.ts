/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { autorunDelta, IObservable, observableValueOpts } from '../../../../base/common/observable.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
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

	/**
	 * Internal state to track the indices of selected cells.
	 * This is used for intelligent selection placement when cells are deleted.
	 */
	private _selectedCellIndices: number[] = [];

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
		this._register(autorunDelta(this._cells, ({ lastValue, newValue }) => {
			this._setCells(newValue, lastValue);
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
		const state = this._state.get();
		if (state.type !== SelectionState.SingleSelection) {
			return;
		}

		const cellToEdit = state.selected[0];
		this._setState({ type: SelectionState.EditingSelection, selectedCell: cellToEdit });
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
		state.selectedCell.defocusEditor();
		this._setState({ type: SelectionState.SingleSelection, selected: [state.selectedCell] });
	}

	//#endregion Public Methods


	//#region Private Methods
	/**
	 * Updates the selection state when cells change.
	 *
	 * @param cells The new cells to set.
	 * @param previousCells The previous cells array (undefined on initial call).
	 */
	private _setCells(cells: IPositronNotebookCell[], previousCells?: IPositronNotebookCell[]): void {
		// Handle initial case where there are no previous cells
		if (!previousCells) {
			return;
		}

		// Detect newly added cells
		const newlyAddedCells = cells.filter(cell => !previousCells.includes(cell));
		if (newlyAddedCells.length === 1) {
			// If we've only added one cell, set it as the selected cell and enter edit mode
			this._register(disposableTimeout(async () => {
				this.selectCell(newlyAddedCells[0], CellSelectionType.Edit);
				await newlyAddedCells[0].showEditor(true);
			}, 0));
		}

		// Detect deleted cells
		const deletedCells = previousCells.filter(cell => !cells.includes(cell));
		if (deletedCells.length > 0) {
			this._handleCellDeletion(deletedCells, previousCells.length);
		}

		const state = this._state.get();

		if (state.type === SelectionState.NoSelection) {
			return;
		}

		// So we have some sort of selection. It may be selection or editing.
		const selectedCells = state.type === SelectionState.EditingSelection ? [state.selectedCell] : state.selected;

		// Compute what the selection looks like after the cells have changed.
		const newSelection = selectedCells.filter(c => cells.includes(c));

		// If the new selection is empty, we need to reset the selection to a reasonable default.
		if (newSelection.length === 0) {
			// If the change resulted in the removal of the previously selected cells, we need to reset the selection to a reasonable default.
			const bestIndex = this._findBestSelectionIndexAfterDeletion(this._selectedCellIndices, cells.length);
			if (bestIndex === -1) {
				this._setState({ type: SelectionState.NoSelection });
				return;
			}

			const cellToSelect = cells[bestIndex];

			this.selectCell(cellToSelect, CellSelectionType.Normal);
			cellToSelect.focus();
			return;
		}

		// In the case where the selection state after the change is still valid, we can just set the state.
		this._setState({ type: newSelection.length === 1 ? SelectionState.SingleSelection : SelectionState.MultiSelection, selected: newSelection });
	}

	private _setState(state: SelectionStates) {
		// Update the selected cell indices to match the new state
		this._updateSelectedCellIndices(state);
		// Alert the observable that the state has changed.
		this._state.set(state, undefined);
	}

	/**
	 * Updates the internal _selectedCellIndices array based on the current selection state.
	 * @param state The current selection state
	 */
	private _updateSelectedCellIndices(state: SelectionStates): void {
		const selectedCells = getSelectedCells(state);
		this._selectedCellIndices = selectedCells.map(cell => cell.index);
	}

	/**
	 * Finds the best index to select after cells have been deleted.
	 * Strategy:
	 * 1. If any selected cells remain, keep the first remaining one
	 * 2. Otherwise, select the cell that would be at the position of the first deleted cell
	 * 3. If that's beyond the end, select the last cell
	 * @param deletedIndices The indices of the deleted cells
	 * @param newCellCount The number of cells after deletion
	 * @returns The best index to select, or -1 if no good selection
	 */
	private _findBestSelectionIndexAfterDeletion(deletedIndices: number[], newCellCount: number): number {
		if (newCellCount === 0) {
			return -1;
		}

		// Sort deleted indices for easier processing
		const sortedDeletedIndices = [...deletedIndices].sort((a, b) => a - b);

		// Check if any of the previously selected cells still exist
		for (const selectedIndex of this._selectedCellIndices) {
			// Calculate the new index after accounting for deletions
			const deletionsBefore = sortedDeletedIndices.filter(deletedIndex => deletedIndex < selectedIndex).length;
			const newIndex = selectedIndex - deletionsBefore;

			// If this selected cell wasn't deleted and the new index is valid
			if (!sortedDeletedIndices.includes(selectedIndex) && newIndex >= 0 && newIndex < newCellCount) {
				return newIndex;
			}
		}

		// No previously selected cells remain, so find the best position
		// Use the position where the first selected cell was
		if (this._selectedCellIndices.length > 0) {
			const firstSelectedIndex = Math.min(...this._selectedCellIndices);
			const deletionsBefore = sortedDeletedIndices.filter(deletedIndex => deletedIndex < firstSelectedIndex).length;
			const targetIndex = firstSelectedIndex - deletionsBefore;

			// Clamp to valid range
			return Math.min(Math.max(0, targetIndex), newCellCount - 1);
		}

		// Last ditch is to just select the first cell.
		return 0;
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

		nextCell.focus();
	}

	/**
	 * Handles the deletion of cells from the notebook.
	 * Manages selection state when selected cells are deleted.
	 *
	 * @param deletedCells Array of cells that were deleted
	 * @param startingCellCount The number of cells before deletion
	 */
	private _handleCellDeletion(deletedCells: IPositronNotebookCell[], startingCellCount: number): void {
		if (deletedCells.length === 0) {
			return;
		}

		const selectedCells = getSelectedCells(this._state.get());
		const deletedSelectedCells = deletedCells.filter(deletedCell =>
			selectedCells.some(selectedCell => selectedCell === deletedCell)
		);

		if (deletedSelectedCells.length === 0) {
			// No selected cells were deleted, nothing to do
			return;
		}

		// Check if there will be no selected cells left after deletion
		const remainingSelectedCells = selectedCells.filter(selectedCell =>
			!deletedCells.includes(selectedCell)
		);

		if (remainingSelectedCells.length === 0) {
			// Use the helper method to determine where selection should be placed
			const deletedIndices = deletedCells.map(cell => cell.index).sort((a, b) => a - b);
			const suggestedFocusIndex = this._determineFocusAfterDeletion(deletedIndices, startingCellCount);

			// Set focus on the suggested cell after sync completes
			if (suggestedFocusIndex !== null) {
				this._register(disposableTimeout(() => {
					if (suggestedFocusIndex !== null && suggestedFocusIndex < this._cells.get().length) {
						const cellToFocus = this._cells.get()[suggestedFocusIndex];
						if (cellToFocus) {
							this.selectCell(cellToFocus, CellSelectionType.Normal);
							cellToFocus.focus();
						}
					}
				}, 0));
			} else {
				// No cells remain, clear selection
				this._setState({ type: SelectionState.NoSelection });
			}
		}
		// If some selected cells remain, the existing _setCells logic will handle updating the selection
	}

	/**
	 * Determines which cell should receive focus after deleting the specified cell indices.
	 * @param cellIndices Array of cell indices being deleted (assumed to be sorted)
	 * @param originalCellCount Total number of cells before deletion
	 * @returns The index of the cell that should receive focus, or null if no cells remain
	 */
	private _determineFocusAfterDeletion(cellIndices: number[], originalCellCount: number): number | null {
		const lowestDeletedIndex = Math.min(...cellIndices);
		const totalCellsToDelete = cellIndices.length;
		const newCellCount = originalCellCount - totalCellsToDelete;

		// Determine the index of the cell that should receive focus after deletion
		let targetFocusIndex: number | null = null;
		if (newCellCount > 0) {
			if (lowestDeletedIndex < newCellCount) {
				// Focus on the cell that takes the place of the first deleted cell
				targetFocusIndex = lowestDeletedIndex;
			} else {
				// We deleted from the end, focus on the last remaining cell
				targetFocusIndex = newCellCount - 1;
			}
		}

		return targetFocusIndex;
	}

	//#endregion Private Methods

}

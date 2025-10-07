/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { autorunDelta, IObservable, observableValueOpts } from '../../../../base/common/observable.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';

/**
 * STATE MACHINE SPECIFICATION
 * ===========================
 *
 * This file implements a selection state machine for Positron notebooks.
 *
 **/
export enum SelectionState {
	NoCells = 'NoCells',
	SingleSelection = 'SingleSelection',
	MultiSelection = 'MultiSelection',
	EditingSelection = 'EditingSelection'
}

type NonEmptyArray<T> = [T, ...T[]];

function assertNonEmptyArray<T>(array: T[]): asserts array is NonEmptyArray<T> {
	if (array.length === 0) {
		throw new Error('Array must be non-empty');
	}
}

function verifyNonEmptyArray<T>(array: T[]): NonEmptyArray<T> {
	assertNonEmptyArray(array);
	return array as NonEmptyArray<T>;
}

/**
 * Selection state discriminated union.
 *
 * Design rationale for field types:
 * - SingleSelection uses `selected: IPositronNotebookCell` (singular) for type safety,
 *   ensuring compile-time enforcement that exactly one cell is selected.
 * - MultiSelection uses `selected: NonEmptyArray<IPositronNotebookCell>` (array) to ensure
 *   at least one cell is selected and enable filtering and equality checks.
 * - EditingSelection uses `selected: IPositronNotebookCell` (singular) for type safety,
 *   ensuring compile-time enforcement that exactly one cell is being edited.
 *
 * This design provides type safety while maintaining clear distinctions between
 * single and multi-cell selection states.
 */
type SelectionStates =
	| {
		type: SelectionState.NoCells;
	}
	| {
		type: SelectionState.SingleSelection;
		selected: IPositronNotebookCell;
	}
	| {
		type: SelectionState.MultiSelection;
		selected: NonEmptyArray<IPositronNotebookCell>;
	}
	| {
		type: SelectionState.EditingSelection;
		selected: IPositronNotebookCell;
	};

export enum CellSelectionType {
	Add = 'Add',
	Edit = 'Edit',
	Normal = 'Normal'
}

/**
 * Get all selected cells based on the current selection state.
 * @param state The selection state to extract cells from
 * @returns An array of selected cells, empty if no cells exist.
 */
export function getSelectedCells(state: SelectionStates): IPositronNotebookCell[] {
	switch (state.type) {
		case SelectionState.NoCells:
			return [];
		case SelectionState.SingleSelection:
			return [state.selected];
		case SelectionState.MultiSelection:
			return state.selected;
		case SelectionState.EditingSelection:
			return [state.selected];
	}
}

/**
 * Get the selected cell if there is exactly one selected.
 * @returns The selected cell. Null if there is no selection.
 */
export function getSelectedCell(state: SelectionStates): IPositronNotebookCell | null {
	if (state.type === SelectionState.SingleSelection) {
		return state.selected;
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
	return state.selected;
}

/**
 * Determines if two selection states are equal.
 */
function isSelectionStateEqual(a: SelectionStates, b: SelectionStates): boolean {
	switch (a.type) {
		case SelectionState.NoCells:
			return a.type === b.type;
		case SelectionState.SingleSelection:
			return a.type === b.type &&
				a.selected === (b as typeof a).selected;
		case SelectionState.MultiSelection:
			return a.type === b.type &&
				a.selected.length === (b as typeof a).selected.length &&
				a.selected.every(cell => (b as typeof a).selected.includes(cell));
		case SelectionState.EditingSelection:
			return a.type === b.type &&
				a.selected === (b as typeof a).selected;
	}
}

export class SelectionStateMachine extends Disposable {

	//#region Private Properties
	private readonly _state = observableValueOpts<SelectionStates>({
		debugName: 'selectionState',
		equalsFn: isSelectionStateEqual
	}, { type: SelectionState.NoCells });
	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor(
		private readonly _cells: IObservable<IPositronNotebookCell[]>,
		@ILogService private readonly _logService: ILogService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
	) {
		super();
		this._register(autorunDelta(this.state, ({ lastValue, newValue }) => {
			if (lastValue !== undefined) {
				this._updateCellSelectionStatus(lastValue, newValue);
			}
		}));

		// Update the selection state when cells change
		this._register(autorunDelta(this._cells, ({ lastValue, newValue }) => {
			if (lastValue !== undefined) {
				this._setCells(newValue, lastValue);
				// Enforce invariant after cell changes
				this._enforceInvariant(newValue);
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

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Selects a cell.
	 * @param cell The cell to select.
	 * @param selectType The type of selection to perform.
	 */
	selectCell(cell: IPositronNotebookCell, selectType: CellSelectionType = CellSelectionType.Normal): void {
		switch (selectType) {
			case CellSelectionType.Normal:
				this._selectCellNormal(cell);
				break;
			case CellSelectionType.Edit:
				this._selectCellEdit(cell);
				break;
			case CellSelectionType.Add:
				this._selectCellAdd(cell);
				break;
		}
	}

	/**
	 * Removes selection from a cell.
	 * @param cell The cell to deselect.
	 * @returns
	 */
	deselectCell(cell: IPositronNotebookCell): void {
		const state = this._state.get();

		if (state.type === SelectionState.NoCells) {
			return;
		}

		const deselectingCurrentSelection =
			(state.type === SelectionState.SingleSelection && state.selected === cell) ||
			(state.type === SelectionState.EditingSelection && state.selected === cell);

		if (deselectingCurrentSelection) {
			// Don't manually set NoCells - let invariant enforcement handle it
			// If cells still exist, select the first one
			const cells = this._cells.get();
			if (cells.length > 0) {
				this._setState({ type: SelectionState.SingleSelection, selected: cells[0] });
			}
			return;
		}

		if (state.type === SelectionState.MultiSelection) {
			const updatedSelection = state.selected.filter(c => c !== cell);
			if (updatedSelection.length === 0) {
				// All cells deselected - let invariant enforcement handle transition
				return;
			}
			const verifiedSelection = verifyNonEmptyArray(updatedSelection);
			// React will handle focus based on selection state change
			if (verifiedSelection.length === 1) {
				this._setState({ type: SelectionState.SingleSelection, selected: verifiedSelection[0] });
			} else {
				this._setState({ type: SelectionState.MultiSelection, selected: verifiedSelection });
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
	async enterEditor(): Promise<void> {
		const state = this._state.get();
		if (state.type !== SelectionState.SingleSelection) {
			return;
		}

		const cellToEdit = state.selected;
		this._setState({ type: SelectionState.EditingSelection, selected: cellToEdit });
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
		this._setState({ type: SelectionState.SingleSelection, selected: state.selected });
	}

	//#endregion Public Methods


	//#region Private Methods

	/**
	 * Performs a normal selection - replaces current selection with the specified cell.
	 * @param cell The cell to select.
	 */
	private _selectCellNormal(cell: IPositronNotebookCell): void {
		this._setState({ type: SelectionState.SingleSelection, selected: cell });
	}

	/**
	 * Selects a cell for editing - enters edit mode with the specified cell.
	 *
	 * @param cell The cell to select and edit.
	 */
	private _selectCellEdit(cell: IPositronNotebookCell): void {
		this._setState({ type: SelectionState.EditingSelection, selected: cell });
	}

	/**
	 * Adds a cell to the current selection (multi-select mode).
	 * @param cell The cell to add to the selection.
	 */
	private _selectCellAdd(cell: IPositronNotebookCell): void {
		const state = this._state.get();

		if (state.type === SelectionState.NoCells) {
			// Should not happen - can't add selection to non-existent cells
			// Invariant enforcement will handle this
			this._logService.warn('SelectionMachine: Cannot add cell selection in NoCells state');
			return;
		}

		if (state.type === SelectionState.EditingSelection) {
			// Cannot add to selection while editing
			this._logService.warn('SelectionMachine: Cannot add cell selection in EditingSelection state');
			return;
		}

		// Check if cell is already selected
		const selectedCells = state.type === SelectionState.SingleSelection ? [state.selected] : state.selected;
		if (selectedCells.includes(cell)) {
			return;
		}

		this._setState({ type: SelectionState.MultiSelection, selected: verifyNonEmptyArray([...selectedCells, cell]) });
	}

	/**
	 * Updates the selection state when cells change.
	 *
	 * @param cells The new cells array.
	 * @param previousCells The previous cells array.
	 */
	private _setCells(cells: IPositronNotebookCell[], previousCells: IPositronNotebookCell[]): void {
		const state = this._state.get();

		// Let invariant enforcement handle NoCells transitions
		if (state.type === SelectionState.NoCells) {
			return;
		}

		// If we're editing a cell when setCells is called. We need to check if the cell is still in the new cells.
		// If it isn't we need to select an appropriate neighboring cell.
		if (state.type === SelectionState.EditingSelection) {
			if (!cells.includes(state.selected)) {
				// Find the index where the deleted cell was in the previous array
				const deletedCellIndex = previousCells.indexOf(state.selected);
				const cellToSelect = this._selectNeighboringCell(cells, deletedCellIndex);
				if (cellToSelect) {
					this._setState({ type: SelectionState.SingleSelection, selected: cellToSelect });
				}
				// If no cell to select, invariant enforcement will handle transition to NoCells
				return;
			}
			return;
		}

		const currentSelection = getSelectedCells(state);
		const newSelection = currentSelection.filter(c => cells.includes(c));
		if (newSelection.length === 0) {
			// Cells were removed - select an appropriate neighboring cell
			// Use the index of the first selected cell that was removed in the previous array
			const deletedCellIndex = previousCells.indexOf(currentSelection[0]);
			const cellToSelect = this._selectNeighboringCell(cells, deletedCellIndex);
			if (cellToSelect) {
				this._setState({ type: SelectionState.SingleSelection, selected: cellToSelect });
			}
			// If no cell to select, invariant enforcement will handle transition to NoCells
			return;
		}

		if (newSelection.length === 1) {
			this._setState({ type: SelectionState.SingleSelection, selected: newSelection[0] });
		} else {
			this._setState({ type: SelectionState.MultiSelection, selected: verifyNonEmptyArray(newSelection) });
		}
	}

	/**
	 * Selects an appropriate neighboring cell when the current selection is removed.
	 * @param cells The current cells array
	 * @param deletedIndex The index where the deleted cell was
	 * @returns The cell to select, or null if no cells remain
	 */
	private _selectNeighboringCell(cells: IPositronNotebookCell[], deletedIndex: number): IPositronNotebookCell | null {
		if (cells.length === 0) {
			return null;
		}

		// If there's a cell at the same index (the cell that took the deleted cell's place), select it
		if (deletedIndex < cells.length) {
			return cells[deletedIndex];
		}

		// Otherwise, select the last cell
		return cells[cells.length - 1];
	}

	/**
	 * Enforces the invariant: NoCells ↔ cells.length === 0
	 * Called automatically when cells array changes
	 */
	private _enforceInvariant(cells: IPositronNotebookCell[]): void {
		const currentState = this._state.get();

		if (cells.length === 0 && currentState.type !== SelectionState.NoCells) {
			// Cells disappeared → force NoCells state
			this._logService.debug('SelectionMachine: Enforcing NoCells state (no cells exist)');
			this._setState({ type: SelectionState.NoCells });
		}
		else if (cells.length > 0 && currentState.type === SelectionState.NoCells) {
			// Cells appeared → automatically select first cell
			this._logService.debug('SelectionMachine: Auto-selecting first cell (cells appeared)');
			this._setState({
				type: SelectionState.SingleSelection,
				selected: cells[0]
			});
		}
	}

	/**
	 * Validates whether a transition from one state to another is valid.
	 * @param from The source state
	 * @param to The destination state
	 * @returns True if the transition is valid, false otherwise
	 */
	private _isValidTransition(from: SelectionState, to: SelectionState): boolean {
		// Define valid transitions as a map
		const validTransitions: Record<SelectionState, SelectionState[]> = {
			[SelectionState.NoCells]: [
				SelectionState.NoCells,          // Can stay in NoCells
				SelectionState.SingleSelection,  // Cells appear → select first
				SelectionState.EditingSelection, // Cell created in empty notebook and immediately edited
			],
			[SelectionState.SingleSelection]: [
				SelectionState.SingleSelection,  // Select different cell
				SelectionState.MultiSelection,   // Add cell to selection
				SelectionState.EditingSelection, // Enter edit mode
				SelectionState.NoCells,          // All cells removed
			],
			[SelectionState.MultiSelection]: [
				SelectionState.MultiSelection,   // Modify selection
				SelectionState.SingleSelection,  // Reduce to single cell
				SelectionState.NoCells,          // All cells removed
			],
			[SelectionState.EditingSelection]: [
				SelectionState.EditingSelection, // Can stay in editing (same cell)
				SelectionState.SingleSelection,  // Exit editor
				SelectionState.NoCells,          // Cell being edited removed
			],
		};

		return validTransitions[from].includes(to);
	}

	private _setState(state: SelectionStates) {
		const currentState = this._state.get();

		// Validate transition
		if (!this._isValidTransition(currentState.type, state.type)) {
			const message = `SelectionMachine: Invalid state transition from ${currentState.type} to ${state.type}`;

			// In development mode, throw an error to catch bugs early
			if (!this._environmentService.isBuilt) {
				throw new Error(message);
			}

			// In production, log a warning but allow the transition
			this._logService.warn(message);
		}

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
		// NoCells case: Cannot move selection when no cells exist
		// Invariant ensures we're never in NoCells when cells exist
		if (state.type === SelectionState.NoCells) {
			return;
		}

		// Direct access is safe because state invariants guarantee at least one element
		const edgeCell = state.type === SelectionState.SingleSelection
			? state.selected
			: state.selected[up ? 0 : state.selected.length - 1];
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
			const currentSelection = getSelectedCells(state);
			const newSelection = verifyNonEmptyArray(up ? [nextCell, ...currentSelection] : [...currentSelection, nextCell]);
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

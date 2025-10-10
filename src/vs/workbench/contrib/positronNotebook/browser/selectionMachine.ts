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
 * Represents the possible selection states for the notebook.
 */
export enum SelectionState {
	NoCells = 'NoCells',
	SingleSelection = 'SingleSelection',
	MultiSelection = 'MultiSelection',
	EditingSelection = 'EditingSelection'
}

/**
 * Selection state discriminated union.
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


/**
 * Valid selection state transitions.
 */
const ValidSelectionStateTransitions: Record<SelectionState, SelectionState[]> = {
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


/**
 * Defines the different modes of cell selection operations in the notebook.
 * Used to specify how a cell selection should be applied when selecting cells.
 */
export enum CellSelectionType {
	/** Adds a cell to the current selection (enables multi-selection mode) */
	Add = 'Add',
	/** Selects a cell and immediately enters edit mode */
	Edit = 'Edit',
	/** Performs a normal selection, replacing any current selection with the specified cell */
	Normal = 'Normal'
}

/**
 * A non-empty array type.
 */
type NonEmptyArray<T> = [T, ...T[]];

/**
 * Verifies that an array is non-empty and returns a non-empty array.
 * @param array The array to verify.
 * @returns The non-empty array.
 */
function verifyNonEmptyArray<T>(array: T[]): NonEmptyArray<T> {
	if (array.length === 0) {
		throw new Error('Array must be non-empty');
	}
	return array as NonEmptyArray<T>;
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
			// If cells still exist, select the first one
			this._selectFirstCell();
			// Don't manually set NoCells - let invariant enforcement handle it
			return;
		}

		if (state.type === SelectionState.MultiSelection) {
			const updatedSelection = state.selected.filter(c => c !== cell);
			if (updatedSelection.length === 0) {
				// All cells deselected - if cells still exist, select the first one
				this._selectFirstCell();
				// If no cells exist, invariant enforcement will handle transition to NoCells
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
	moveSelectionUp(addMode: boolean): void {
		this._moveSelection(true, addMode);
	}

	/**
	 * Move the selection down.
	 * @param addMode If true, the selection will be added to the current selection.
	 */
	moveSelectionDown(addMode: boolean): void {
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
	 * Computes the intended selection state based on which cells were added/removed,
	 * then delegates to _setState which handles invariant enforcement.
	 *
	 * @param cells The new cells array.
	 * @param previousCells The previous cells array.
	 */
	private _setCells(cells: IPositronNotebookCell[], previousCells: IPositronNotebookCell[]): void {
		const state = this._state.get();

		// If no cells existed and none exist now, nothing to do
		if (state.type === SelectionState.NoCells && cells.length === 0) {
			return;
		}

		// If we went from NoCells to having cells, _setState will auto-select first cell
		if (state.type === SelectionState.NoCells && cells.length > 0) {
			// Delegate to _setState with any valid state - it will correct to SingleSelection
			this._setState({ type: SelectionState.SingleSelection, selected: cells[0] });
			return;
		}

		// If we're editing a cell when cells change, check if that cell still exists
		if (state.type === SelectionState.EditingSelection) {
			if (!cells.includes(state.selected)) {
				// Cell being edited was removed - handle selection removal
				this._handleSelectionRemoved(state.selected, cells, previousCells);
			}
			// Cell still exists, keep current state
			return;
		}

		// Filter current selection to only include cells that still exist
		const currentSelection = getSelectedCells(state);
		const newSelection = currentSelection.filter(c => cells.includes(c));

		if (newSelection.length === 0) {
			// All selected cells were removed - handle selection removal
			this._handleSelectionRemoved(currentSelection[0], cells, previousCells);
			return;
		}

		// Update selection with remaining cells
		if (newSelection.length === 1) {
			this._setState({ type: SelectionState.SingleSelection, selected: newSelection[0] });
		} else {
			this._setState({ type: SelectionState.MultiSelection, selected: verifyNonEmptyArray(newSelection) });
		}
	}

	/**
	 * Selects the first cell if cells exist, transitioning to SingleSelection state.
	 * @returns True if a cell was selected, false if no cells exist
	 */
	private _selectFirstCell(): boolean {
		const cells = this._cells.get();
		if (cells.length > 0) {
			this._setState({ type: SelectionState.SingleSelection, selected: cells[0] });
			return true;
		}
		return false;
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
	 * Handles the case where the current selection (editing or otherwise) is removed due to cell deletion.
	 * Selects a neighboring cell if possible, or transitions to NoCells state if none remain.
	 * @param removedCell The cell that was deleted (or first of current selection)
	 * @param cells The new array of cells
	 * @param previousCells The previous array of cells
	 */
	private _handleSelectionRemoved(removedCell: IPositronNotebookCell | undefined, cells: IPositronNotebookCell[], previousCells: IPositronNotebookCell[]): void {
		if (!removedCell) {
			this._setState({ type: SelectionState.NoCells });
			return;
		}
		const removedCellIndex = previousCells.indexOf(removedCell);
		const cellToSelect = this._selectNeighboringCell(cells, removedCellIndex);
		if (cellToSelect) {
			this._setState({ type: SelectionState.SingleSelection, selected: cellToSelect });
		} else {
			this._setState({ type: SelectionState.NoCells });
		}
	};

	/**
	 * Validates and corrects state to maintain invariants.
	 *
	 * This is the single source of truth for what constitutes a valid state.
	 * All state changes MUST go through this validation to ensure invariants.
	 *
	 * Core invariant: NoCells ↔ cells.length === 0
	 *
	 * @param intended The state that was requested
	 * @param cells The current cells array
	 * @returns A valid state (either the intended state or a corrected version)
	 */
	private _validateAndCorrect(
		intended: SelectionStates,
		cells: IPositronNotebookCell[]
	): SelectionStates {
		// Invariant: NoCells ↔ cells.length === 0
		if (cells.length === 0) {
			// No cells exist → MUST be NoCells
			if (intended.type !== SelectionState.NoCells) {
				this._logService.debug('SelectionMachine: Auto-correcting to NoCells (no cells exist)');
			}
			return { type: SelectionState.NoCells };
		}

		if (intended.type === SelectionState.NoCells) {
			// NoCells but cells exist → MUST select something
			this._logService.debug('SelectionMachine: Auto-correcting from NoCells (cells exist)');
			return { type: SelectionState.SingleSelection, selected: cells[0] };
		}

		// State is valid
		return intended;
	}

	private _setState(state: SelectionStates) {
		const currentState = this._state.get();
		const cells = this._cells.get();

		// Step 1: Validate transition is legal
		if (!ValidSelectionStateTransitions[currentState.type].includes(state.type)) {
			const message = `SelectionMachine: Invalid state transition from ${currentState.type} to ${state.type}`;

			// In development mode, throw an error to catch bugs early
			if (!this._environmentService.isBuilt) {
				throw new Error(message);
			}

			// In production, log a warning but don't apply invalid transition
			this._logService.warn(message);
			return;
		}

		// Step 2: Validate and correct state to maintain invariants
		const correctedState = this._validateAndCorrect(state, cells);

		// Step 3: Apply the corrected state
		this._state.set(correctedState, undefined);
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { SelectionStateMachine } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';
import { PositronNotebookContextKeyManager } from 'vs/workbench/services/positronNotebook/browser/ContextKeysManager';
import { ICodeEditorViewState } from 'vs/editor/common/editorCommon';

export enum CellKind {
	Markup = 1,
	Code = 2
}

export enum KernelStatus {
	Uninitialized = 'Uninitialized',
	Connecting = 'Connecting',
	Connected = 'Connected',
	Disconnected = 'Disconnected',
	Errored = 'Errored'
}
/**
 * Class that abstracts away _most_ of the interfacing with existing notebook classes/models/functions
 * in an attempt to control the complexity of the notebook. This class is passed into React
 * and is the source of truth for rendering and controlling the notebook.
 * This is where all the logic and state for the notebooks is controlled and encapsulated.
 * This is then given to the UI to render.
 */

export interface IPositronNotebookInstance {

	/**
	 * URI of the notebook file being edited
	 */
	get uri(): URI;

	/**
	 * The cells that make up the notebook
	 */
	cells: ISettableObservable<IPositronNotebookCell[]>;

	/**
	 * Status of kernel for the notebook.
	 */
	kernelStatus: ISettableObservable<KernelStatus>;

	/**
	 * Selection state machine object.
	 */
	selectionStateMachine: SelectionStateMachine;

	/**
	 * Has the notebook instance been disposed?
	 */
	isDisposed: boolean;

	// Methods for interacting with the notebook
	/**
	 * Run the given cells
	 * @param cells The cells to run
	 */
	runCells(cells: IPositronNotebookCell[]): Promise<void>;

	/**
	 * Run the selected cells
	 */
	runSelectedCells(): Promise<void>;

	/**
	 * Run all cells in the notebook
	 */
	runAllCells(): Promise<void>;

	/**
	 * Add a new cell of a given type to the notebook at the requested index
	 */
	addCell(type: CellKind, index: number): void;

	/**
	 * Action mirror
	 */
	insertCodeCellAboveAndFocusContainer(): void;

	/**
	 * Delete a cell from the notebook
	 */
	deleteCell(cell: IPositronNotebookCell): void;

	/**
	 * Attach a view model to this instance
	 * @param viewModel View model for the notebook
	 * @param viewState Optional view state for the notebook
	 */
	attachView(viewModel: unknown, container: HTMLElement, viewState?: INotebookEditorViewState): void;

	readonly viewModel: unknown | undefined;

	/**
	 * Method called when the instance is detached from a view. This is used to cleanup
	 * all the logic and variables related to the view/DOM.
	 */
	detachView(): void;

	/**
	 * Set the currently selected cells for notebook instance
	 * @param cellOrCells The cell or cells to set as selected
	 */
	setSelectedCells(cellOrCells: IPositronNotebookCell[]): void;

	/**
	 * Remove selection from cell
	 * @param cell The cell to deselect
	 */
	deselectCell(cell: IPositronNotebookCell): void;


	/**
	 * Set the currently editing cell.
	 */
	setEditingCell(cell: IPositronNotebookCell | undefined): void;

	/**
	 * Class for managing context keys for notebook.
	 */
	contextManager: PositronNotebookContextKeyManager;
}

interface INotebookEditorViewState {
	editingCells: { [key: number]: boolean };
	collapsedInputCells: { [key: number]: boolean };
	collapsedOutputCells: { [key: number]: boolean };
	cellLineNumberStates: { [key: number]: 'on' | 'off' };
	editorViewStates: { [key: number]: ICodeEditorViewState | null };
	hiddenFoldingRanges?: {
		/**
		 * zero based index
		 */
		start: number;

		/**
		 * zero based index
		 */
		end: number;
	}[];
	cellTotalHeights?: { [key: number]: number };
	scrollPosition?: { left: number; top: number };
	focus?: number;
	editorFocused?: boolean;
	contributionsState?: { [id: string]: unknown };
	selectedKernelId?: string;
}

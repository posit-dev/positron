/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { CellKind, IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { SelectionStateMachine } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * Represents the possible states of a notebook's kernel connection
 */
export enum KernelStatus {
	/** No kernel has been initialized yet */
	Uninitialized = 'Uninitialized',
	/** Attempting to establish a connection to the kernel */
	Connecting = 'Connecting',
	/** Successfully connected to the kernel */
	Connected = 'Connected',
	/** Connection to the kernel has been lost */
	Disconnected = 'Disconnected',
	/** An error occurred while connecting to or communicating with the kernel */
	Errored = 'Errored'
}

/**
 * Interface defining the public API for interacting with a Positron notebook instance.
 * This interface abstracts away the complexity of notebook management and provides
 * a clean contract for the React UI layer to interact with notebook functionality.
 *
 * Key responsibilities:
 * - Manages notebook cell state and content
 * - Handles kernel connectivity and execution
 * - Controls cell selection and editing states
 * - Provides methods for common notebook operations
 */
export interface IPositronNotebookInstance {
	// ===== Properties =====
	/**
	 * Unique identifier for the notebook instance. Used for debugging and claiming
	 * ownership of various resources.
	 */
	id: string;

	/**
	 * URI of the notebook file being edited. This serves as the unique identifier
	 * for the notebook's content on disk.
	 */
	get uri(): URI;

	/**
	 * Indicates whether this notebook instance is currently connected to a view/editor.
	 * Used to determine if the notebook is currently being displayed.
	 */
	readonly connectedToEditor: boolean;

	/**
	 * Observable array of cells that make up the notebook. Changes to this array
	 * will trigger UI updates in connected views.
	 */
	cells: ISettableObservable<IPositronNotebookCell[]>;

	/**
	 * Observable status of the notebook's kernel connection. UI elements can
	 * react to changes in kernel connectivity.
	 */
	kernelStatus: ISettableObservable<KernelStatus>;

	/**
	 * Observable reference to the current runtime session for the notebook.
	 * This manages the connection to the kernel and execution environment.
	 */
	currentRuntime: ISettableObservable<ILanguageRuntimeSession | undefined>;

	/**
	 * State machine that manages cell selection behavior and state.
	 * Handles complex selection scenarios like multi-select and keyboard navigation.
	 */
	selectionStateMachine: SelectionStateMachine;

	/**
	 * Indicates whether this notebook instance has been disposed.
	 * Used to prevent operations on destroyed instances.
	 */
	isDisposed: boolean;

	// ===== Methods =====
	/**
	 * Executes the specified cells in order.
	 *
	 * @param cells Array of cells to execute
	 * @returns Promise that resolves when all cells have completed execution
	 */
	runCells(cells: IPositronNotebookCell[]): Promise<void>;

	/**
	 * Executes all cells in the notebook in order, from top to bottom.
	 *
	 * @returns Promise that resolves when all cells have completed execution
	 */
	runAllCells(): Promise<void>;

	/**
	 * Clears all output from all cells in the notebook.
	 */
	clearAllCellOutputs(): void;

	/**
	 * Creates and inserts a new cell into the notebook.
	 *
	 * @param type The kind of cell to create (e.g., code, markdown)
	 * @param index The position at which to insert the new cell
	 */
	addCell(type: CellKind, index: number): void;

	/**
	 * Inserts a new code cell either above or below the current selection
	 * and focuses the container.
	 *
	 * @param aboveOrBelow Whether to insert the cell above or below the current selection
	 */
	insertCodeCellAndFocusContainer(aboveOrBelow: 'above' | 'below'): void;

	/**
	 * Removes a cell from the notebook.
	 *
	 * @param cell Optional cell to delete. If not provided, deletes the currently selected cell
	 */
	deleteCell(cell?: IPositronNotebookCell): void;

	/**
	 * Updates the currently editing cell state.
	 *
	 * @param cell The cell to set as editing, or undefined to clear editing state
	 */
	setEditingCell(cell: IPositronNotebookCell | undefined): void;

	/**
	 * Closes the notebook instance.
	 */
	close(): void;
}

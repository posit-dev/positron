/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { CellKind, IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { SelectionStateMachine } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

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
	 * Identifier for the notebook instance. Used for debugging and claiming ownership of various
	 * resources.
	 */
	id: string;

	/**
	 * URI of the notebook file being edited
	 */
	get uri(): URI;

	/**
	 * Is this instance connected to a view/editor?
	 */
	readonly connectedToEditor: boolean;

	/**
	 * The cells that make up the notebook
	 */
	cells: ISettableObservable<IPositronNotebookCell[]>;

	/**
	 * Status of kernel for the notebook.
	 */
	kernelStatus: ISettableObservable<KernelStatus>;

	/**
	 * Current runtime for notebook
	 */
	currentRuntime: ISettableObservable<ILanguageRuntimeSession | undefined>;

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
	insertCodeCellAndFocusContainer(aboveOrBelow: 'above' | 'below'): void;

	/**
	 * Delete a cell from the notebook
	 */
	deleteCell(cell?: IPositronNotebookCell): void;

	/**
	 * Set the currently editing cell.
	 */
	setEditingCell(cell: IPositronNotebookCell | undefined): void;
}

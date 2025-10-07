/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { CellKind, IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
import { SelectionStateMachine } from './selectionMachine.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { Event } from '../../../../base/common/event.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IBaseCellEditorOptions } from '../../notebook/browser/notebookBrowser.js';
import { NotebookOptions } from '../../notebook/browser/notebookOptions.js';
import { PositronNotebookContextKeyManager } from './ContextKeysManager.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
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
	readonly id: string;

	/**
	 * URI of the notebook file being edited. This serves as the unique identifier
	 * for the notebook's content on disk.
	 */
	get uri(): URI;

	/**
	 * The underlying notebook text model, if loaded.
	 * Contains the actual notebook data (cells, metadata, etc.).
	 */
	readonly textModel: IObservable<NotebookTextModel | undefined>;

	/**
	 * Indicates whether this notebook instance is currently connected to a view/editor.
	 * Used to determine if the notebook is currently being displayed.
	 */
	readonly connectedToEditor: boolean;

	/**
	 * The DOM element that contains the cells for the notebook.
	 * This is set when the cells container is mounted in the React component.
	 */
	readonly cellsContainer: HTMLElement | undefined;

	/**
	 * Sets the DOM element that contains the cells for the notebook.
	 * @param container The container element to set, or null to clear
	 */
	setCellsContainer(container: HTMLElement | null): void;

	/**
	 * Observable array of cells that make up the notebook. Changes to this array
	 * will trigger UI updates in connected views.
	 */
	readonly cells: IObservable<IPositronNotebookCell[]>;

	/**
	 * Observable status of the notebook's kernel connection. UI elements can
	 * react to changes in kernel connectivity.
	 */
	readonly kernelStatus: IObservable<KernelStatus>;

	/**
	 * Observable reference to the current runtime session for the notebook.
	 * This manages the connection to the kernel and execution environment.
	 */
	readonly runtimeSession: IObservable<ILanguageRuntimeSession | undefined>;

	/**
	 * State machine that manages cell selection behavior and state.
	 * Handles complex selection scenarios like multi-select and keyboard navigation.
	 */
	readonly selectionStateMachine: SelectionStateMachine;

	/**
	 * Indicates whether this notebook instance has been disposed.
	 * Used to prevent operations on destroyed instances.
	 */
	readonly isDisposed: boolean;

	/**
	 * Indicates whether this notebook is read-only and cannot be edited.
	 */
	readonly isReadOnly: boolean;

	/**
	 * Context key manager for this notebook instance. Used to manage notebook-specific
	 * context keys that are scoped to the notebook's DOM container.
	 */
	readonly contextManager: PositronNotebookContextKeyManager;

	/**
	 * Event that fires when the cells container is scrolled
	 */
	readonly onDidScrollCellsContainer: Event<void>;

	/**
	 * Options for how the notebook should be displayed.
	 * Provides configuration for layout, styling, and display behavior.
	 */
	readonly notebookOptions: NotebookOptions;

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
	 * @param referenceCell Optional cell to insert relative to. If not provided, uses the currently selected cell
	 */
	insertCodeCellAndFocusContainer(aboveOrBelow: 'above' | 'below', referenceCell?: IPositronNotebookCell): void;

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
	 * Checks if the notebook instance contains a code editor.
	 *
	 * @param editor The code editor to check for.
	 */
	hasCodeEditor(editor: ICodeEditor): boolean;

	/**
	 * Closes the notebook instance.
	 */
	close(): void;

	/**
	 * Copies the specified cells to the clipboard.
	 * If no cells are provided, copies the currently selected cells.
	 * @param cells Optional array of cells to copy. If not provided, uses current selection.
	 */
	copyCells(cells?: IPositronNotebookCell[]): void;

	/**
	 * Cuts the specified cells (copies to clipboard and removes from notebook).
	 * If no cells are provided, cuts the currently selected cells.
	 * @param cells Optional array of cells to cut. If not provided, uses current selection.
	 */
	cutCells(cells?: IPositronNotebookCell[]): void;

	/**
	 * Pastes cells from the clipboard at the specified index.
	 * If no index is provided, pastes after the current selection.
	 * @param index Optional index to paste at. If not provided, pastes after current selection.
	 */
	pasteCells(index?: number): void;

	/**
	 * Pastes cells from the clipboard above the current selection.
	 */
	pasteCellsAbove(): void;

	/**
	 * Returns whether there are cells available to paste from the clipboard.
	 */
	canPaste(): boolean;

	/**
	 * Shows or focuses the notebook console for this notebook instance.
	 */
	showNotebookConsole(): void;

	/**
	 * Gets the base cell editor options for the given language.
	 * If they don't exist yet, they will be created.
	 * @param language The language to get the options for.
	 */
	getBaseCellEditorOptions(language: string): IBaseCellEditorOptions;

	/**
	 * Fire the scroll event for the cells container.
	 * Called by React when scroll or DOM mutations occur.
	 */
	fireScrollEvent(): void;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IObservable } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { CellKind, IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
import { SelectionStateMachine } from './selectionMachine.js';
import { Event } from '../../../../base/common/event.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IBaseCellEditorOptions, INotebookEditor } from '../../notebook/browser/notebookBrowser.js';
import { NotebookOptions } from '../../notebook/browser/notebookOptions.js';
import { PositronNotebookContextKeyManager } from './ContextKeysManager.js';
import { IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { RuntimeNotebookKernel } from '../../runtimeNotebookKernel/browser/runtimeNotebookKernel.js';

/**
 * Represents the possible states of a notebook's kernel connection
 */
export enum KernelStatus {
	/** Discovering available kernels */
	Discovering = 'Preparing',
	/** No kernel has been selected for the notebook */
	Unselected = 'Unselected',
	/** The kernel is restarting*/
	Restarting = 'Restarting',
	/** Changing from one kernel to another */
	Switching = 'Switching',
	/** The kernel is starting */
	Starting = 'Starting',
	/** The kernel is ready to receive a request */
	Idle = 'Idle',
	/** The kernel is busy handling a request */
	Busy = 'Busy',
	/** The kernel is in the process of exiting */
	Exiting = 'Exiting',
	/** The kernel has exited */
	Exited = 'Exited',
}

/**
 * Represents the types of operations that can be performed on a notebook.
 * Used to track the context of cell additions and modifications to control
 * automatic behavior like entering edit mode.
 */
export enum NotebookOperationType {
	/** Normal cell insertion via UI or command */
	InsertAndEdit = 'InsertAndEdit',
	/** Cells added via paste operation */
	Paste = 'Paste',
	/** Cells restored via undo operation */
	Undo = 'Undo',
	/** Cells restored via redo operation */
	Redo = 'Redo'
}

/**
 * Subset of INotebookEditor required to integrate with the extension API,
 * so we don't have to implement the entire INotebookEditor interface (...yet)
 * See mainThreadNotebookDocumentsAndEditors.ts and mainThreadNotebookEditors.ts.
 */
type INotebookEditorForExtensionApi = Pick<
	INotebookEditor,
	// Basic
	| 'getId'
	// Text/view model
	| 'textModel'  // only used for .uri
	| 'hasModel'
	| 'getViewModel'  // only used for .viewType
	// Selected cells: vscode.NotebookEditor.selections
	| 'getSelections'
	| 'setSelections'
	| 'onDidChangeSelection'
	// Visible cells: vscode.NotebookEditor.visibleRanges
	| 'visibleRanges'
	| 'onDidChangeVisibleRanges'
	// Cell structure: to retrieve a cell to be revealed and to ensure the revealed range is within the notebook length
	| 'getLength'
	| 'cellAt'  // returned ICellViewModel is only used by passing to a reveal method below
	// Reveal: to reveal a cell
	| 'revealInCenter'
	| 'revealCellRangeInView'
	| 'revealInCenterIfOutsideViewport'
	| 'revealInViewAtTop'
	| 'onDidFocusWidget'
>;

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
export interface IPositronNotebookInstance extends INotebookEditorForExtensionApi {
	// ===== Properties =====
	/**
	 * URI of the notebook file being edited. This serves as the unique identifier
	 * for the notebook's content on disk.
	 */
	readonly uri: URI;

	/**
	 * The notebook view type. Only Jupyter notebooks are supported currently.
	 */
	readonly viewType: 'jupyter-notebook';

	readonly scopedContextKeyService: IScopedContextKeyService | undefined;

	/**
	 * Indicates whether this notebook instance is currently connected to a view/editor.
	 * Used to determine if the notebook is currently being displayed.
	 */
	readonly connectedToEditor: boolean;

	/**
	 * The DOM element that contains the entire notebook editor (including toolbar, cells, etc.).
	 * This is the top-level container for the notebook UI.
	 */
	readonly container: HTMLElement | undefined;

	/**
	 * Sets the DOM element that contains the entire notebook editor.
	 * @param container The container element to set, or null to clear
	 */
	setEditorContainer(container: HTMLElement | null): void;

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
	 * Observable of the notebook's selected kernel.
	 */
	readonly kernel: IObservable<RuntimeNotebookKernel | undefined>;

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
	 * @param enterEditMode Whether to put the new cell into edit mode immediately
	 */
	addCell(type: CellKind, index: number, enterEditMode: boolean): void;

	/**
	 * Inserts a new code cell either above or below the current selection
	 * and focuses the container.
	 *
	 * @param aboveOrBelow Whether to insert the cell above or below the current selection
	 * @param referenceCell Optional cell to insert relative to. If not provided, uses the currently selected cell
	 */
	insertCodeCellAndFocusContainer(aboveOrBelow: 'above' | 'below', referenceCell?: IPositronNotebookCell): void;

	/**
	 * Inserts a new markdown cell either above or below the current selection
	 * and focuses the container.
	 *
	 * @param aboveOrBelow Whether to insert the cell above or below the current selection
	 * @param referenceCell Optional cell to insert relative to. If not provided, uses the currently selected cell
	 */
	insertMarkdownCellAndFocusContainer(aboveOrBelow: 'above' | 'below', referenceCell?: IPositronNotebookCell): void;

	/**
	 * Removes a cell from the notebook.
	 *
	 * @param cell Optional cell to delete. If not provided, deletes the currently selected cell
	 */
	deleteCell(cell?: IPositronNotebookCell): void;

	/**
	 * Moves a cell up by one position.
	 * Supports multi-cell selection - moves all selected cells as a group.
	 *
	 * @param cell The cell to move up
	 */
	moveCellUp(cell: IPositronNotebookCell): void;

	/**
	 * Moves a cell down by one position.
	 * Supports multi-cell selection - moves all selected cells as a group.
	 *
	 * @param cell The cell to move down
	 */
	moveCellDown(cell: IPositronNotebookCell): void;

	/**
	 * Moves cells to a specific index.
	 * Used by drag-and-drop operations.
	 *
	 * @param cells Array of cells to move
	 * @param targetIndex The index to move the cells to
	 */
	moveCells(cells: IPositronNotebookCell[], targetIndex: number): void;

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
	 * Gets the current notebook operation type that is in progress, if any.
	 * This is used to track the context of cell additions and modifications to
	 * control automatic behavior like entering edit mode. Operation is cleared
	 * after being retrieved to ensure it only applies to the immediate next
	 * action.
	 * @returns The current operation type, or undefined if no operation is in
	 * progress
	 */
	getAndResetCurrentOperation(): NotebookOperationType | undefined;

	/**
	 * Sets the current notebook operation type.
	 * This should be called at the beginning of operations like paste, undo, or redo
	 * to provide context for subsequent cell additions.
	 * @param type The operation type to set
	 */
	setCurrentOperation(type: NotebookOperationType): void;

	/**
	 * Clears the current notebook operation type.
	 * This should be called after the operation context is no longer needed.
	 */
	clearCurrentOperation(): void;

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


	/**
	 * Event that fires when the notebook editor widget or a cell editor within it gains focus.
	 */
	readonly onDidFocusWidget: Event<void>;
}

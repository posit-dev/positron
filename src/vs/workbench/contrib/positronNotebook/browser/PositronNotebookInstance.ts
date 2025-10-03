/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IActiveNotebookEditorDelegate, IBaseCellEditorOptions, INotebookEditorCreationOptions, INotebookEditorOptions, INotebookEditorViewState } from '../../notebook/browser/notebookBrowser.js';
import { NotebookOptions } from '../../notebook/browser/notebookOptions.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { CellEditType, CellKind, ICellEditOperation, ISelectionState, SelectionStateType, ICellReplaceEdit, NotebookCellExecutionState, ICellDto2 } from '../../notebook/common/notebookCommon.js';
import { INotebookExecutionService } from '../../notebook/common/notebookExecutionService.js';
import { INotebookExecutionStateService } from '../../notebook/common/notebookExecutionStateService.js';
import { createNotebookCell } from './PositronNotebookCells/createNotebookCell.js';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput.js';
import { BaseCellEditorOptions } from './BaseCellEditorOptions.js';
import * as DOM from '../../../../base/browser/dom.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType, getSelectedCell, getSelectedCells, SelectionState, SelectionStateMachine } from '../../../contrib/positronNotebook/browser/selectionMachine.js';
import { PositronNotebookContextKeyManager } from './ContextKeysManager.js';
import { IPositronNotebookService } from './positronNotebookService.js';
import { IPositronNotebookInstance, KernelStatus } from './IPositronNotebookInstance.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { SELECT_KERNEL_ID_POSITRON, SelectPositronNotebookKernelContext } from './SelectPositronNotebookKernelAction.js';
import { INotebookKernel, INotebookKernelService } from '../../notebook/common/notebookKernelService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { isEqual } from '../../../../base/common/resources.js';
import { IPositronWebviewPreloadService } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { autorun, observableValue } from '../../../../base/common/observable.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { cellToCellDto2, serializeCellsToClipboard } from './cellClipboardUtils.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

interface IPositronNotebookInstanceRequiredTextModel extends IPositronNotebookInstance {
	textModel: NotebookTextModel;
}

/**
 * Implementation of IPositronNotebookInstance that handles the core notebook functionality
 * and state management. This class serves as the bridge between the UI and the underlying
 * notebook model.
 *
 * Key responsibilities:
 * - Manages notebook cell state and execution
 * - Handles kernel connectivity
 * - Coordinates selection and editing states
 * - Manages the lifecycle of the notebook view
 */
export class PositronNotebookInstance extends Disposable implements IPositronNotebookInstance {

	// ===== Statics =====
	// #region Statics
	/** Map of all active notebook instances, keyed by notebook URI */
	static _instanceMap = new ResourceMap<PositronNotebookInstance>();

	/**
	 * Either makes or retrieves an instance of a Positron Notebook based on the resource. This
	 * helps avoid having multiple instances open for the same file when the input is rebuilt.
	 * @param input Positron Notebook input object for the notebook.
	 * @param creationOptions Options for opening notebook
	 * @param instantiationService Instantiation service for creating instance with proper DI.
	 * @returns Instance of the notebook, either retrieved from existing or created.
	 */
	static getOrCreate(
		input: PositronNotebookEditorInput,
		creationOptions: INotebookEditorCreationOptions | undefined,
		instantiationService: IInstantiationService,
	): PositronNotebookInstance {

		const existingInstance = PositronNotebookInstance._instanceMap.get(input.resource);
		if (existingInstance) {
			// Update input
			existingInstance._input = input;
			// Make sure we're starting with a fresh view
			existingInstance.detachView();
			existingInstance._creationOptions = creationOptions;
			return existingInstance;
		}

		const instance = instantiationService.createInstance(PositronNotebookInstance, input, creationOptions);
		PositronNotebookInstance._instanceMap.set(input.resource, instance);
		return instance;
	}

	// #endregion

	// =============================================================================================
	// #region Private Properties

	/**
	 * A set of disposables that are linked to a given model
	 * that need to be cleaned up when the model is changed.
	 */
	private readonly _modelStore = this._register(new DisposableStore());

	/**
	 * Dom element that contains the notebook is rendered in.
	 */
	private _container: HTMLElement | undefined = undefined;

	/**
	 * The DOM element that contains the cells for the notebook.
	 */
	private _cellsContainer: HTMLElement | undefined = undefined;

	/**
	 * Disposables for the current cells container event listeners
	 */
	private readonly _cellsContainerListeners = this._register(new DisposableStore());

	/**
	 * Callback to clear the keyboard navigation listeners. Set when listeners are attached.
	 */
	private _clearKeyboardNavigation: (() => void) | undefined = undefined;

	/**
	 * Key-value map of language to base cell editor options for cells of that language.
	 */
	private _baseCellEditorOptions: Map<string, IBaseCellEditorOptions> = new Map();

	/**
	 * View model for the notebook.
	 */
	// private _viewModel: NotebookViewModel | undefined = undefined;

	/**
	 * Model for the notebook contents.
	 */
	private readonly _textModel = observableValue<NotebookTextModel | undefined>('positronNotebookTextModel', undefined);

	/**
	 * Internal event emitter for when the editor's options change.
	 */
	private readonly _onDidChangeOptions = this._register(new Emitter<void>());

	// #region NotebookModel
	/**
	 * Model for the notebook contents. Note the difference between the NotebookTextModel and the
	 * NotebookViewModel.
	 */
	readonly onDidChangeModel = Event.fromObservable(this._textModel, this._store);

	/**
	 * Options for how the notebook should be displayed. Currently not really used but will be as
	 * notebook gets fleshed out.
	 */
	private _notebookOptions: NotebookOptions | undefined;

	/**
	 * Keep track of if this editor has been disposed.
	 */
	private _isDisposed: boolean = false;
	// #endregion

	/**
	 * Event emitter for when the text model changes.
	 */
	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	/**
	 * Event emitter for when the cells container is scrolled
	 */
	private readonly _onDidScrollCellsContainer = this._register(new Emitter<void>());
	readonly onDidScrollCellsContainer = this._onDidScrollCellsContainer.event;

	// =============================================================================================
	// #region Public Properties

	/**
	 * Unique identifier for the notebook instance. Currently just the notebook URI as a string.
	 */
	private _id: string;

	/**
	 * The DOM element that contains the cells for the notebook.
	 */
	get cellsContainer(): HTMLElement | undefined {
		return this._cellsContainer;
	}

	/**
	 * Sets the DOM element that contains the cells for the notebook.
	 * @param container The container element to set, or undefined to clear
	 */
	/**
	 * Sets the DOM element that contains the cells for the notebook.
	 * @param container The container element to set, or undefined to clear
	 */
	setCellsContainer(container: HTMLElement | undefined | null): void {
		// Clean up any existing listeners
		this._cellsContainerListeners.clear();

		if (!container) {
			this._cellsContainer = undefined;
			return;
		}

		this._cellsContainer = container;
	}

	/**
	 * Fire the scroll event for the cells container.
	 * Called by React when scroll or DOM mutations occur.
	 */
	fireScrollEvent(): void {
		this._onDidScrollCellsContainer.fire();
	}

	/**
	 * User facing cells wrapped in an observerable for the UI to react to changes
	 */
	cells;
	selectionStateMachine;
	contextManager;

	/**
	 * Selected kernel for the notebook.
	 */
	kernel;

	/**
	 * Status of kernel for the notebook.
	 */
	kernelStatus;

	/**
	 * Current runtime for the notebook.
	 */
	runtimeSession;

	/**
	 * Language for the notebook.
	 */
	private _language;

	// #endregion

	// =============================================================================================

	// #region Getters and Setters

	/**
	 * Is the instance connected to an editor as indicated by having an associated container object?
	 */
	get connectedToEditor(): boolean {
		return Boolean(this._container);
	}

	get uri(): URI {
		return this._input.resource;
	}

	/**
	 * Get the current `NotebookTextModel` for the editor.
	 */
	get textModel() {
		return this._textModel.get();
	}


	get isReadOnly(): boolean {
		return this._creationOptions?.isReadOnly ?? false;
	}

	/**
	 * Gets the notebook options for the editor.
	 * Exposes the private internal notebook options as a get only property.
	 */
	get notebookOptions() {

		if (this._notebookOptions) {
			return this._notebookOptions;
		}
		this._logService.info(this.id, 'Generating new notebook options');

		this._notebookOptions = this._instantiationService.createInstance(NotebookOptions, DOM.getActiveWindow(), this.isReadOnly, undefined);

		return this._notebookOptions;
	}

	get id(): string {
		return this._id;
	}

	get isDisposed(): boolean {
		return this._isDisposed;
	}

	/**
	 * Gets the language for the notebook.
	 */
	get language(): string {
		return this._language.get();
	}

	// #endregion

	// =============================================================================================
	// #region Lifecycle

	constructor(
		private _input: PositronNotebookEditorInput,
		private _creationOptions: INotebookEditorCreationOptions | undefined,
		@ICommandService private readonly _commandService: ICommandService,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
		@INotebookExecutionStateService private readonly notebookExecutionStateService: INotebookExecutionStateService,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
		@IPositronWebviewPreloadService private readonly _webviewPreloadService: IPositronWebviewPreloadService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
	) {
		super();

		this._id = _input.uniqueId;
		this.cells = observableValue<IPositronNotebookCell[]>('positronNotebookCells', []);

		// Track the current runtime session for this notebook
		this.runtimeSession = observableValue('positronNotebookRuntimeSession', this.runtimeSessionService.getNotebookSessionForNotebookUri(this.uri));
		this._register(this.runtimeSessionService.onDidStartRuntime((session) => {
			if (session.metadata.notebookUri && this._isThisNotebook(session.metadata.notebookUri)) {
				this.runtimeSession.set(session, undefined);
			}
		}));

		// Clear the runtime session observable when the session ends
		this._register(autorun(reader => {
			const session = this.runtimeSession.read(reader);
			if (session) {
				const d = this._register(session.onDidEndSession(() => {
					d.dispose();
					this.runtimeSession.set(undefined, undefined);
				}));
			}
		}));

		// Track the current selected kernel for this notebook
		this.kernel = observableValue<INotebookKernel | undefined>('positronNotebookKernel', undefined);
		this._register(this.notebookKernelService.onDidChangeSelectedNotebooks(e => {
			if (e && this._isThisNotebook(e.notebook) && this.textModel) {
				const matching = this.notebookKernelService.getMatchingKernel(this.textModel);
				const kernel = matching.all.find(k => k.id === e.newKernel);
				this.kernel.set(kernel, undefined);
			}
		}));

		// Derive the kernel connection status
		this.kernelStatus = this.kernel.map(
			this,
			kernel => /** @description positronNotebookKernelStatus */ kernel ? KernelStatus.Connected : KernelStatus.Disconnected
		);

		// Derive the notebook language from the selected kernel
		this._language = this.kernel.map(
			this,
			kernel => /** @description positronNotebookLanguage */ kernel?.supportedLanguages[0] ?? 'plaintext'
		);

		this.contextManager = this._register(
			this._instantiationService.createInstance(PositronNotebookContextKeyManager)
		);
		this._positronNotebookService.registerInstance(this);

		this.selectionStateMachine = this._register(
			this._instantiationService.createInstance(SelectionStateMachine, this.cells)
		);

		this._register(autorun(reader => {
			const state = this.selectionStateMachine.state.read(reader);
			const isEditing = state.type === SelectionState.EditingSelection;
			this.contextManager.setContainerFocused(!isEditing);
		}));

		this._webviewPreloadService.attachNotebookInstance(this);

		this._logService.info(this.id, 'constructor');

		// Add listener for content changes to sync cells
		this._register(this.onDidChangeContent(() => {
			this._syncCells();
		}));
	}

	override dispose() {

		this._logService.info(this.id, 'dispose');
		this._positronNotebookService.unregisterInstance(this);
		// Remove from the instance map
		PositronNotebookInstance._instanceMap.delete(this.uri);

		super.dispose();
		this.detachView();
	}

	// #endregion

	// =============================================================================================
	// #region Public Methods

	/**
	 * Handle logic associated with the text model for notebook. This
	 * includes setting up listeners for changes to the model and
	 * setting up the initial state of the notebook.
	 */
	setModel(model: NotebookTextModel, viewState?: INotebookEditorViewState): void {
		this._textModel.set(model, undefined);

		this._modelStore.clear();
		this._modelStore.add(model.onDidChangeContent((e) => {
			// Check if cells are in the same order by comparing references
			const newCells = model.cells;

			if (
				// If there are the same number of cells...
				newCells.length === this.cells.get().length &&
				// ... and they are in the same order...
				newCells.every((cell, i) => this.cells.get()[i].cellModel === cell)
			) {
				// ... then we don't need to sync the cells.
				return;
			}

			// Fire content change event before syncing
			this._onDidChangeContent.fire();
		}));

		// Select the appropriate kernel for the notebook
		this._selectKernelForNotebook(model, viewState);

		this._onDidChangeContent.fire();
	}


	/**
	 * Sets editor options for the notebook or a specific cell.
	 * If cellOptions.resource is provided, applies options to that cell.
	 * @param options Editor options to set
	 */
	async setOptions(options: INotebookEditorOptions | undefined): Promise<void> {
		// Apply cell options if provided
		const cellUri = options?.cellOptions?.resource;
		const cell = cellUri && this.cells.get().find(cell => isEqual(cell.uri, cellUri));
		if (cell) {
			await cell.setOptions(options);
		}
	}

	/**
	 * Runs the specified cells in the notebook.
	 * @param cells The cells to run
	 * @throws Error if no cells are provided
	 */
	async runCells(cells: IPositronNotebookCell[]): Promise<void> {
		if (!cells) {
			throw new Error(localize('noCells', "No cells to run"));
		}
		await this._runCells(cells);
	}

	/**
	 * Runs all cells in the notebook.
	 */
	async runAllCells(): Promise<void> {
		await this._runCells(this.cells.get());
	}


	/**
	 * Adds a new cell to the notebook at the specified index.
	 * @param type The type of cell to add (`CellKind`)
	 * @param index The position where the cell should be inserted
	 * @throws Error if no language is set for the notebook
	 */
	addCell(type: CellKind, index: number): void {
		this._assertTextModel();

		if (!this.language) {
			throw new Error(localize('noLanguage', "No language for notebook"));
		}

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';
		const synchronous = true;
		const endSelections: ISelectionState = { kind: SelectionStateType.Index, focus: { start: index, end: index + 1 }, selections: [{ start: index, end: index + 1 }] };
		const focusAfterInsertion = {
			start: index,
			end: index + 1
		};
		textModel.applyEdits([
			{
				editType: CellEditType.Replace,
				index,
				count: 0,
				cells: [
					{
						cellKind: type,
						language: this.language,
						mime: undefined,
						outputs: [],
						metadata: undefined,
						source: ''
					}
				]
			}
		],
			synchronous,
			{
				kind: SelectionStateType.Index,
				focus: focusAfterInsertion,
				selections: [focusAfterInsertion]
			},
			() => endSelections,
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();
	}

	/**
	 * Inserts a new code cell above or below the reference cell (or selected cell if no reference is provided).
	 * @param aboveOrBelow Whether to insert the cell above or below the reference
	 * @param referenceCell Optional reference cell. If not provided, uses the currently selected cell
	 */
	insertCodeCellAndFocusContainer(aboveOrBelow: 'above' | 'below', referenceCell?: IPositronNotebookCell): void {
		let index: number | undefined;

		this._assertTextModel();

		if (referenceCell) {
			const cellIndex = referenceCell.index;
			index = cellIndex >= 0 ? cellIndex : undefined;
		} else {
			index = getSelectedCell(this.selectionStateMachine.state.get())?.index;
		}

		if (index === undefined) {
			return;
		}

		this.addCell(CellKind.Code, index + (aboveOrBelow === 'above' ? 0 : 1));
	}

	/**
	 * Deletes a single cell from the notebook.
	 * @param cellToDelete The cell to delete. If not provided, deletes the currently selected cell
	 */
	deleteCell(cellToDelete?: IPositronNotebookCell): void {
		const cell = cellToDelete ?? getSelectedCell(this.selectionStateMachine.state.get());

		if (!cell) {
			return;
		}
		this.deleteCells([cell]);
	}


	/**
	 * Deletes multiple cells from the notebook.
	 * @param cellsToDelete Array of cells to delete
	 */
	deleteCells(cellsToDelete: IPositronNotebookCell[]): void {
		this._assertTextModel();

		if (cellsToDelete.length === 0) {
			return;
		}

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';

		// Get indices and sort in descending order to avoid index shifting
		const cellIndices = cellsToDelete
			.map(cell => cell.index)
			.filter(index => index >= 0)
			.sort((a, b) => b - a);

		if (cellIndices.length === 0) {
			return;
		}

		// Calculate where focus should go after deletion
		const lowestDeletedIndex = Math.min(...cellIndices);

		// Create delete edits for each cell
		const edits: ICellReplaceEdit[] = cellIndices.map(index => ({
			editType: CellEditType.Replace,
			index,
			count: 1,
			cells: []
		}));

		// Find the cell that will be at the position of the first (lowest index) deleted cell
		const nextCellAfterContainingSelection = textModel.cells[lowestDeletedIndex + cellIndices.length] ?? undefined;
		const focusRange = {
			start: lowestDeletedIndex,
			end: lowestDeletedIndex + 1
		};

		textModel.applyEdits(
			edits,
			true,
			{ kind: SelectionStateType.Index, focus: focusRange, selections: [focusRange] },
			() => {
				if (nextCellAfterContainingSelection) {
					const cellIndex = textModel.cells.findIndex(cell => cell.handle === nextCellAfterContainingSelection.handle);
					return { kind: SelectionStateType.Index, focus: { start: cellIndex, end: cellIndex + 1 }, selections: [{ start: cellIndex, end: cellIndex + 1 }] };
				} else {
					if (textModel.length) {
						const lastCellIndex = textModel.length - 1;
						return { kind: SelectionStateType.Index, focus: { start: lastCellIndex, end: lastCellIndex + 1 }, selections: [{ start: lastCellIndex, end: lastCellIndex + 1 }] };

					} else {
						return { kind: SelectionStateType.Index, focus: { start: 0, end: 0 }, selections: [{ start: 0, end: 0 }] };
					}
				}
			},
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();
	}


	/**
	 * Sets the cell that is currently being edited.
	 * @param cell The cell to set as editing, or undefined to clear editing state
	 */
	setEditingCell(cell: IPositronNotebookCell | undefined): void {
		if (cell === undefined) {
			return;
		}
		this.selectionStateMachine.selectCell(cell, CellSelectionType.Edit);
	}

	/**
	 * Checks if the notebook contains a specific code editor.
	 * @param editor The code editor to check for
	 * @returns True if the editor belongs to one of the notebook's cells, false otherwise
	 */
	hasCodeEditor(editor: ICodeEditor): boolean {
		for (const cell of this.cells.get()) {
			if (cell.editor && cell.editor === editor) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Attaches the notebook view to a DOM container.
	 * @param container The DOM element to render the notebook into
	 */
	async attachView(container: HTMLElement, scopedContextKeyService: IScopedContextKeyService) {
		this.detachView();
		this._container = container;
		this.contextManager.setContainer(container, scopedContextKeyService);

		this._setupKeyboardNavigation(container);
		this._logService.info(this.id, 'attachView');
	}

	/**
	 * Gets the base cell editor options for the given language.
	 * If they don't exist yet, they will be created.
	 * @param language The language to get the options for.
	 */
	getBaseCellEditorOptions(language: string): IBaseCellEditorOptions {
		const existingOptions = this._baseCellEditorOptions.get(language);

		if (existingOptions) {
			return existingOptions;
		}

		const options = new BaseCellEditorOptions({
			onDidChangeModel: this.onDidChangeModel,
			hasModel: <() => this is IActiveNotebookEditorDelegate>(() => Boolean(this.textModel)),
			onDidChangeOptions: this._onDidChangeOptions.event,
			isReadOnly: this.isReadOnly,
		}, this.notebookOptions, this.configurationService, language);
		this._baseCellEditorOptions.set(language, options);
		return options;
	}


	/**
	 * Gets the current state of the editor. This should
	 * fully determine the view we see.
	 */
	getEditorViewState(): INotebookEditorViewState {
		return {
			editingCells: {},
			cellLineNumberStates: {},
			editorViewStates: {},
			collapsedInputCells: {},
			collapsedOutputCells: {},
			selectedKernelId: this.kernel.get()?.id,
		};
	}

	/**
	 * Detaches the notebook view from its container and cleans up resources.
	 */
	detachView(): void {
		this._container = undefined;
		this._logService.info(this.id, 'detachView');
		this._clearKeyboardNavigation?.();
		this._notebookOptions?.dispose();
		this._notebookOptions = undefined;
	}

	/**
	 * Closes the notebook instance and disposes of all resources.
	 */
	close(): void {
		this._logService.info(this.id, 'Closing a notebook instance');
		this.dispose();
	}

	// #endregion

	// =============================================================================================
	// #region Private Methods



	private _assertTextModel(): asserts this is IPositronNotebookInstanceRequiredTextModel {
		if (this.textModel === undefined) {
			throw new Error('No text model for notebook');
		}
	}

	/**
	 * Helper to determine if the given URI is the same as the notebook's associated with
	 * this instance.
	 * @param uri Uri to check against the notebook's uri
	 * @returns True if the uri is the same as the notebook's uri, false otherwise.
	 */
	private _isThisNotebook(uri: URI): boolean {
		return isEqual(uri, this._input.resource);
	}

	private _selectKernelForNotebook(model: NotebookTextModel, viewState?: INotebookEditorViewState): void {
		// If the view state specified a kernel, try to select it
		const selectedKernelId = viewState?.selectedKernelId;
		if (selectedKernelId) {
			const matching = this.notebookKernelService.getMatchingKernel(model);
			const kernel = matching.all.find(k => k.id === viewState.selectedKernelId);
			if (kernel) {
				this.notebookKernelService.selectKernelForNotebook(kernel, model);
				return;
			}
		}

		// If we still haven't selected a kernel, and there's a single suggested kernel, select it.
		const matching = this.notebookKernelService.getMatchingKernel(model);
		if (!matching.selected && matching.suggestions.length === 1) {
			this.notebookKernelService.selectKernelForNotebook(matching.suggestions[0], model);
		}
	}

	/**
	 * Method to sync the editor cells with the current cells in the model.
	 */
	private _syncCells() {
		this._assertTextModel();
		const modelCells = this.textModel.cells;

		const cellModelToCellMap = new Map(
			this.cells.get().map(cell => [cell.cellModel, cell])
		);

		const newlyAddedCells: IPositronNotebookCell[] = [];

		const cells = modelCells.map(cell => {
			const existingCell = cellModelToCellMap.get(cell);
			if (existingCell) {
				// Remove cell from map so we know it's been used.
				cellModelToCellMap.delete(cell);
				return existingCell;
			}
			const newCell = createNotebookCell(cell, this, this._instantiationService);
			newlyAddedCells.push(newCell);

			return newCell;
		});

		if (newlyAddedCells.length === 1) {
			// If we've only added one cell, we can set it as the selected cell in edit mode.
			this.selectionStateMachine.selectCell(newlyAddedCells[0], CellSelectionType.Edit);
			// Defer focus request to next tick to allow React to mount the editor component.
			// Without this, requestEditorFocus() fires before the editor exists, and the
			// autorun in CellEditorMonacoWidget won't be able to focus a non-existent editor.
			setTimeout(() => {
				newlyAddedCells[0].requestEditorFocus();
			}, 0);
		}

		// Dispose of any cells that were not reused.
		cellModelToCellMap.forEach(cell => cell.dispose());

		this.cells.set(cells, undefined);
	}

	/**
	 * Internal method to run cells, used by other cell running methods.
	 * @param cells Cells to run
	 * @returns
	 */
	private async _runCells(cells: IPositronNotebookCell[]): Promise<void> {
		this._logService.info(this.id, '_runCells');

		this._assertTextModel();

		// Make sure we have a kernel to run the cells.
		if (this.kernelStatus.get() !== KernelStatus.Connected) {
			this._logService.info(this.id, 'No kernel connected, attempting to connect');
			// Attempt to connect to the kernel
			await this._commandService.executeCommand(
				SELECT_KERNEL_ID_POSITRON,
				{ forceDropdown: false } satisfies SelectPositronNotebookKernelContext
			);
		}

		const hasExecutions = [...cells].some(cell => Boolean(this.notebookExecutionStateService.getCellExecution(cell.uri)));

		if (hasExecutions) {
			this.notebookExecutionService.cancelNotebookCells(this.textModel, Array.from(cells).map(c => c.cellModel as NotebookCellTextModel));
			return;
		}

		await this.notebookExecutionService.executeNotebookCells(this.textModel, Array.from(cells).map(c => c.cellModel as NotebookCellTextModel), this._contextKeyService);
	}


	/**
	 * Setup keyboard navigation for the current notebook.
	 * @param container The main containing node the notebook is rendered into
	 */
	private _setupKeyboardNavigation(container: HTMLElement) {
		// Add some keyboard navigation for cases not covered by the keybindings. I'm not sure if
		// there's a way to do this directly with keybindings but this feels acceptable due to the
		// ubiquity of the enter key and escape keys for these types of actions.
		const onKeyDown = (event: KeyboardEvent) => {
			const { key, shiftKey, ctrlKey, metaKey } = event;
			if (key === 'Enter' && !(ctrlKey || metaKey || shiftKey)) {
				// Only intercept Enter if we're NOT already in edit mode
				// When already editing, let the event pass through to Monaco
				const currentState = this.selectionStateMachine.state.get();
				if (currentState.type !== SelectionState.EditingSelection) {
					event.preventDefault();
					event.stopPropagation();
					this.selectionStateMachine.enterEditor().catch(err => {
						this._logService.error(this.id, 'Error entering editor:', err);
					});
				}
			} else if (key === 'Escape') {
				this.selectionStateMachine.exitEditor();
			}
		};

		this._container?.addEventListener('keydown', onKeyDown);

		this._clearKeyboardNavigation = () => {
			this._container?.removeEventListener('keydown', onKeyDown);
		};
	}

	/**
	 * Clears the output of a specific cell in the notebook.
	 * @param cell The cell to clear outputs from. If not provided, uses the currently selected cell.
	 * @param skipContentEvent If true, won't fire the content change event (useful for batch operations)
	 */
	clearCellOutput(cell?: IPositronNotebookCell, skipContentEvent: boolean = false): void {
		this._assertTextModel();

		const targetCell = cell ?? getSelectedCell(this.selectionStateMachine.state.get());
		if (!targetCell) {
			return;
		}

		const cellIndex = targetCell.index;
		if (cellIndex === -1) {
			return;
		}

		const computeUndoRedo = !this.isReadOnly;
		this.textModel.applyEdits([{
			editType: CellEditType.Output,
			index: cellIndex,
			outputs: [],
			append: false
		}], true, undefined, () => undefined, undefined, computeUndoRedo);

		if (!skipContentEvent) {
			this._onDidChangeContent.fire();
		}
	}

	/**
	 * Show a notebook console for this instance.
	 */
	showNotebookConsole(): void {
		this._positronConsoleService.showNotebookConsole(this.uri, true);
	}

	/**
	 * Clears the outputs of all cells in the notebook.
	 */
	clearAllCellOutputs(): void {
		this._assertTextModel();

		try {
			const computeUndoRedo = !this.isReadOnly;

			// Clear outputs from all cells
			this.textModel.cells.forEach((cell, index) => {
				this.clearCellOutput(this.cells.get()[index], true);
			});

			// Clear execution metadata for non-executing cells
			const clearExecutionMetadataEdits = this.textModel.cells.map((cell, index) => {
				const runState = this.notebookExecutionStateService.getCellExecution(cell.uri)?.state;
				if (runState !== NotebookCellExecutionState.Executing) {
					return {
						editType: CellEditType.PartialInternalMetadata,
						index,
						internalMetadata: {
							runStartTime: null,
							runStartTimeAdjustment: null,
							runEndTime: null,
							executionOrder: null,
							lastRunSuccess: null
						}
					};
				}
				return undefined;
			}).filter((edit): edit is ICellEditOperation & {
				editType: CellEditType.PartialInternalMetadata;
				index: number;
				internalMetadata: {
					runStartTime: null;
					runStartTimeAdjustment: null;
					runEndTime: null;
					executionOrder: null;
					lastRunSuccess: null;
				};
			} => !!edit);

			if (clearExecutionMetadataEdits.length) {
				this.textModel.applyEdits(clearExecutionMetadataEdits, true, undefined, () => undefined, undefined, computeUndoRedo);
			}

		} finally {
			// Fire a single content change event
			this._onDidChangeContent.fire();
		}
	}


	// #endregion

	// =============================================================================================
	// #region Clipboard Methods

	/**
	 * Internal clipboard for storing cells with full fidelity
	 */
	private _clipboardCells: ICellDto2[] = [];

	/**
	 * Flag to track if the clipboard contains cut cells (vs copied cells)
	 */
	private _isClipboardCut: boolean = false;

	/**
	 * Copies the specified cells to the clipboard.
	 * @param cells The cells to copy. If not provided, copies the currently selected cells
	 */
	copyCells(cells?: IPositronNotebookCell[]): void {
		const cellsToCopy = cells || getSelectedCells(this.selectionStateMachine.state.get());

		if (cellsToCopy.length === 0) {
			return;
		}

		// Store internally for full-fidelity paste
		this._clipboardCells = cellsToCopy.map(cell => cellToCellDto2(cell));
		this._isClipboardCut = false;

		// Also write to system clipboard as text
		const clipboardText = serializeCellsToClipboard(cellsToCopy);
		this._clipboardService.writeText(clipboardText);

		// Log for debugging
		this._logService.debug(`Copied ${cellsToCopy.length} cells to clipboard`);
	}

	/**
	 * Cuts the specified cells to the clipboard (copies then deletes them).
	 * @param cells The cells to cut. If not provided, cuts the currently selected cells
	 */
	cutCells(cells?: IPositronNotebookCell[]): void {
		const cellsToCut = cells || getSelectedCells(this.selectionStateMachine.state.get());

		if (cellsToCut.length === 0) {
			return;
		}

		// Copy cells first
		this.copyCells(cellsToCut);
		this._isClipboardCut = true;

		// Delete the cells (this handles selection and focus automatically)
		this.deleteCells(cellsToCut);
	}

	/**
	 * Pastes cells from the clipboard at the specified index.
	 * @param index The position to paste cells at. If not provided, pastes after the last selected cell
	 */
	pasteCells(index?: number): void {
		if (!this.canPaste()) {
			return;
		}

		this._assertTextModel();

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';
		const pasteIndex = index ?? this.getInsertionIndex();
		const cellCount = this._clipboardCells.length;

		// Use textModel.applyEdits to properly create and register cells
		const synchronous = true;
		const endSelections: ISelectionState = {
			kind: SelectionStateType.Index,
			focus: { start: pasteIndex, end: pasteIndex + cellCount },
			selections: [{ start: pasteIndex, end: pasteIndex + cellCount }]
		};
		const focusAfterInsertion = {
			start: pasteIndex,
			end: pasteIndex + cellCount
		};

		textModel.applyEdits([
			{
				editType: CellEditType.Replace,
				index: pasteIndex,
				count: 0,
				cells: this._clipboardCells
			}
		],
			synchronous,
			{
				kind: SelectionStateType.Index,
				focus: focusAfterInsertion,
				selections: [focusAfterInsertion]
			},
			() => endSelections, undefined, computeUndoRedo
		);

		// If this was a cut operation, clear the clipboard
		if (this._isClipboardCut) {
			this._clipboardCells = [];
			this._isClipboardCut = false;
		}

		this._onDidChangeContent.fire();
	}

	/**
	 * Pastes cells from the clipboard above the first selected cell.
	 */
	pasteCellsAbove(): void {
		const selection = getSelectedCells(this.selectionStateMachine.state.get());
		if (selection.length > 0) {
			const firstSelectedIndex = selection[0].index;
			this.pasteCells(firstSelectedIndex);
		} else {
			this.pasteCells(0);
		}
	}

	/**
	 * Checks if there are cells available to paste from the clipboard.
	 * @returns True if cells can be pasted, false otherwise
	 */
	canPaste(): boolean {
		return this._clipboardCells.length > 0;
	}


	// Helper method to get insertion index
	private getInsertionIndex(): number {
		const selections = getSelectedCells(this.selectionStateMachine.state.get());
		if (selections.length > 0) {
			const lastSelectedIndex = selections[selections.length - 1].index;
			return lastSelectedIndex + 1;
		}
		return this.cells.get().length;
	}

	// #endregion
}

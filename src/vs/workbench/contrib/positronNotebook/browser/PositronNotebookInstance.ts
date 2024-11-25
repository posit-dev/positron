/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IActiveNotebookEditorDelegate, IBaseCellEditorOptions, INotebookEditorCreationOptions, INotebookEditorViewState } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookOptions } from 'vs/workbench/contrib/notebook/browser/notebookOptions';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellEditType, CellKind, ICellReplaceEdit, ISelectionState, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookExecutionService } from 'vs/workbench/contrib/notebook/common/notebookExecutionService';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { createNotebookCell } from './PositronNotebookCells/createNotebookCell';
import { PositronNotebookEditorInput } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorInput';
import { BaseCellEditorOptions } from './BaseCellEditorOptions';
import * as DOM from 'vs/base/browser/dom';
import { IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { CellSelectionType, SelectionStateMachine } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';
import { PositronNotebookContextKeyManager } from 'vs/workbench/services/positronNotebook/browser/ContextKeysManager';
import { IPositronNotebookService } from 'vs/workbench/services/positronNotebook/browser/positronNotebookService';
import { IPositronNotebookInstance, KernelStatus } from '../../../services/positronNotebook/browser/IPositronNotebookInstance';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { disposableTimeout } from 'vs/base/common/async';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { SELECT_KERNEL_ID_POSITRON, SelectPositronNotebookKernelContext } from './SelectPositronNotebookKernelAction';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { ILanguageRuntimeSession, IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { isEqual } from 'vs/base/common/resources';
import { IPositronWebviewPreloadService } from 'vs/workbench/services/positronWebviewPreloads/browser/positronWebviewPreloadService';

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
	static _instanceMap: Map<string, PositronNotebookInstance> = new Map();

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

		const pathOfNotebook = input.resource.toString();
		const existingInstance = PositronNotebookInstance._instanceMap.get(pathOfNotebook);
		if (existingInstance) {
			// Update input
			existingInstance._input = input;
			// Make sure we're starting with a fresh view
			existingInstance.detachView();
			existingInstance._creationOptions = creationOptions;
			return existingInstance;
		}

		const instance = instantiationService.createInstance(PositronNotebookInstance, input, creationOptions);
		PositronNotebookInstance._instanceMap.set(pathOfNotebook, instance);
		return instance;
	}

	// #endregion

	// =============================================================================================
	// #region Private Properties

	/**
	 * Internal cells that we use to manage the state of the notebook
	 */
	private _cells: IPositronNotebookCell[] = [];

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
	private _textModel: NotebookTextModel | undefined = undefined;

	/**
	 * Internal event emitter for when the editor's options change.
	 */
	private readonly _onDidChangeOptions = this._register(new Emitter<void>());

	// #region NotebookModel
	/**
	 * Model for the notebook contents. Note the difference between the NotebookTextModel and the
	 * NotebookViewModel.
	 */
	private readonly _onDidChangeModel = this._register(new Emitter<NotebookTextModel | undefined>());

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

	// =============================================================================================
	// #region Public Properties

	/**
	 * Unique identifier for the notebook instance. Currently just the notebook URI as a string.
	 */
	private _id: string;

	/**
	 * User facing cells wrapped in an observerable for the UI to react to changes
	 */
	cells: ISettableObservable<IPositronNotebookCell[]>;
	selectedCells: ISettableObservable<IPositronNotebookCell[]> = observableValue<IPositronNotebookCell[]>('positronNotebookSelectedCells', []);
	editingCell: ISettableObservable<IPositronNotebookCell | undefined, void> = observableValue<IPositronNotebookCell | undefined>('positronNotebookEditingCell', undefined);
	selectionStateMachine: SelectionStateMachine;
	contextManager: PositronNotebookContextKeyManager;

	/**
	 * Status of kernel for the notebook.
	 */
	kernelStatus: ISettableObservable<KernelStatus>;

	/**
	 * Current runtime for the notebook.
	 */
	currentRuntime: ISettableObservable<ILanguageRuntimeSession | undefined, void>;

	/**
	 * Language for the notebook.
	 */
	private _language: string | undefined;

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
		return this._textModel;
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
		if (this._language) {
			return this._language;
		}

		// Try to get language from kernel
		if (this._textModel) {
			const kernel = this.notebookKernelService.getSelectedOrSuggestedKernel(this._textModel);
			if (kernel) {
				this._language = kernel.supportedLanguages[0];
				return this._language;
			}
		}

		// Fallback to a default language
		return 'plaintext';
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
		@IPositronWebviewPreloadService private readonly _webviewPreloadService: IPositronWebviewPreloadService,
	) {
		super();

		this._setupNotebookTextModel();

		this._id = _input.uniqueId;
		this.cells = observableValue<IPositronNotebookCell[]>('positronNotebookCells', this._cells);
		this.kernelStatus = observableValue<KernelStatus>('positronNotebookKernelStatus', KernelStatus.Uninitialized);
		this.currentRuntime = observableValue<ILanguageRuntimeSession | undefined>('positronNotebookCurrentRuntime', undefined);

		this.contextManager = this._instantiationService.createInstance(PositronNotebookContextKeyManager);
		this._positronNotebookService.registerInstance(this);

		this.selectionStateMachine = this._register(
			this._instantiationService.createInstance(SelectionStateMachine)
		);


		this._register(
			this.notebookKernelService.onDidChangeSelectedNotebooks((e) => {
				// If this is our notebook, update the kernel status as needed.
				if (!this._isThisNotebook(e.notebook)) { return; }

				this._assertTextModel();
				// Select the kernel
				const kernel = this.notebookKernelService.getSelectedOrSuggestedKernel(this.textModel);

				if (!kernel) {
					this.kernelStatus.set(KernelStatus.Disconnected, undefined);
					return;
				}

				this._logService.info(this.id, `Selecting kernel ${kernel.id} for notebook`);
				this.notebookKernelService.selectKernelForNotebook(kernel, this.textModel);
			})
		);

		// Listen for a runtime session to be started up that's attached to this notebook
		this._register(
			this.runtimeSessionService.onDidStartRuntime((session) => {
				if (session.metadata.notebookUri && this._isThisNotebook(session.metadata.notebookUri)) {
					this.currentRuntime.set(session, undefined);
					this.kernelStatus.set(KernelStatus.Connected, undefined);

					session.onDidEndSession(() => {
						this.currentRuntime.set(undefined, undefined);
						this.kernelStatus.set(KernelStatus.Disconnected, undefined);
					});
				}
			})
		);

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
		PositronNotebookInstance._instanceMap.delete(this.uri.toString());

		super.dispose();
		this.detachView();
	}

	// #endregion

	// =============================================================================================
	// #region Public Methods

	async runCells(cells: IPositronNotebookCell[]): Promise<void> {
		if (!cells) {
			throw new Error(localize('noCells', "No cells to run"));
		}
		await this._runCells(cells);
	}

	async runAllCells(): Promise<void> {
		await this._runCells(this._cells);
	}


	addCell(type: CellKind, index: number): void {
		this._assertTextModel();

		if (!this.language) {
			throw new Error(localize('noLanguage', "No language for notebook"));
		}
		const synchronous = true;
		const pushUndoStop = true;
		const endSelections: ISelectionState = { kind: SelectionStateType.Index, focus: { start: index, end: index + 1 }, selections: [{ start: index, end: index + 1 }] };
		const focusAfterInsertion = {
			start: index,
			end: index + 1
		};
		this.textModel.applyEdits([
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
			() => endSelections, undefined, pushUndoStop && !this.isReadOnly
		);

		this._onDidChangeContent.fire();
	}

	insertCodeCellAndFocusContainer(aboveOrBelow: 'above' | 'below'): void {
		const indexOfSelectedCell = this.selectionStateMachine.getIndexOfSelectedCell();
		if (indexOfSelectedCell === null) {
			return;
		}

		this.addCell(CellKind.Code, indexOfSelectedCell + (aboveOrBelow === 'above' ? 0 : 1));
	}

	deleteCell(cellToDelete?: IPositronNotebookCell): void {
		this._assertTextModel();

		const cell = cellToDelete ?? this.selectionStateMachine.getSelectedCell();

		if (!cell) {
			return;
		}

		const textModel = this.textModel;
		// TODO: Hook up readOnly to the notebook actual value
		const readOnly = false;
		const computeUndoRedo = !readOnly || textModel.viewType === 'interactive';
		const cellIndex = textModel.cells.indexOf(cell.cellModel as NotebookCellTextModel);

		const edits: ICellReplaceEdit = {
			editType: CellEditType.Replace, index: cellIndex, count: 1, cells: []
		};

		const nextCellAfterContainingSelection = textModel.cells[cellIndex + 1] ?? undefined;
		const focusRange = {
			start: cellIndex,
			end: cellIndex + 1
		};

		textModel.applyEdits([edits], true, { kind: SelectionStateType.Index, focus: focusRange, selections: [focusRange] }, () => {
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
		}, undefined, computeUndoRedo);

		this._onDidChangeContent.fire();
	}


	setEditingCell(cell: IPositronNotebookCell | undefined): void {
		if (cell === undefined) {
			return;
		}
		this.selectionStateMachine.selectCell(cell, CellSelectionType.Edit);
	}

	async attachView(container: HTMLElement) {
		this.detachView();
		this._container = container;
		this.contextManager.setContainer(container);

		const notifyOfModelChange = true;

		if (notifyOfModelChange) {
			this._onDidChangeModel.fire(this._textModel);
		}

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
			onDidChangeModel: this._onDidChangeModel.event,
			hasModel: <() => this is IActiveNotebookEditorDelegate>(() => Boolean(this._textModel)),
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
		// TODO: Implement logic here.
		return {
			editingCells: {},
			cellLineNumberStates: {},
			editorViewStates: {},
			collapsedInputCells: {},
			collapsedOutputCells: {},
		};
	}

	detachView(): void {
		this._container = undefined;
		this._logService.info(this.id, 'detachView');
		this._clearKeyboardNavigation?.();
		this._notebookOptions?.dispose();
		this._notebookOptions = undefined;
		this._detachModel();
	}

	close(): void {
		console.log('Closing a notebook instance');
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


	/**
	 * Handle logic associated with the text model for notebook. This
	 * includes setting up listeners for changes to the model and
	 * setting up the initial state of the notebook.
	 */
	private async _setupNotebookTextModel() {
		const model = await this._input.resolve();
		if (model === null) {
			throw new Error(
				localize(
					'fail.noModel',
					'Failed to find a model for view type {0}.',
					this._input.viewType
				)
			);
		}

		this._textModel = model.notebook;

		this._modelStore.add(
			this._textModel.onDidChangeContent((e) => {
				// Check if cells are in the same order by comparing references
				this._assertTextModel();
				const newCells = this.textModel.cells;

				if (
					// If there are the same number of cells...
					newCells.length === this._cells.length &&
					// ... and they are in the same order...
					newCells.every((cell, i) => this._cells[i].cellModel === cell)
				) {
					// ... then we don't need to sync the cells.
					return;
				}

				this._onDidChangeContent.fire();
			})
		);

		this._onDidChangeContent.fire();
	}

	/**
	 * Method to sync the editor cells with the current cells in the model.
	 */
	private _syncCells() {
		this._assertTextModel();
		const modelCells = this.textModel.cells;

		const cellModelToCellMap = new Map(
			this._cells.map(cell => [cell.cellModel, cell])
		);

		const newlyAddedCells: IPositronNotebookCell[] = [];

		this._cells = modelCells.map(cell => {
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
			// If we've only added one cell, we can set it as the selected cell.
			this._register(disposableTimeout(() => {
				this.selectionStateMachine.selectCell(newlyAddedCells[0], CellSelectionType.Edit);
				newlyAddedCells[0].focusEditor();
			}, 0));
		}

		// Dispose of any cells that were not reused.
		cellModelToCellMap.forEach(cell => cell.dispose());

		this.cells.set(this._cells, undefined);
		this.selectionStateMachine.setCells(this._cells);
	}

	/**
	 * Internal method to run cells, used by other cell running methods.
	 * @param cells Cells to run
	 * @returns
	 */
	private async _runCells(cells: IPositronNotebookCell[]): Promise<void> {
		// Filter so we're only working with code cells.
		const codeCells = cells;
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

		for (const cell of codeCells) {
			if (cell.isCodeCell()) {
				cell.executionStatus.set('running', undefined);
			}
		}

		const hasExecutions = [...cells].some(cell => Boolean(this.notebookExecutionStateService.getCellExecution(cell.uri)));

		if (hasExecutions) {
			this.notebookExecutionService.cancelNotebookCells(this.textModel, Array.from(cells).map(c => c.cellModel as NotebookCellTextModel));
			return;
		}

		await this.notebookExecutionService.executeNotebookCells(this.textModel, Array.from(cells).map(c => c.cellModel as NotebookCellTextModel), this._contextKeyService);
		for (const cell of codeCells) {
			if (cell.isCodeCell()) {
				cell.executionStatus.set('idle', undefined);
			}
		}
	}


	/**
	 * Setup keyboard navigation for the current notebook.
	 * @param container The main containing node the notebook is rendered into
	 */
	private _setupKeyboardNavigation(container: HTMLElement) {
		// Add some keyboard navigation for cases not covered by the keybindings. I'm not sure if
		// there's a way to do this directly with keybindings but this feels acceptable due to the
		// ubiquity of the enter key and escape keys for these types of actions.
		const onKeyDown = ({ key, shiftKey, ctrlKey, metaKey }: KeyboardEvent) => {
			if (key === 'Enter' && !(ctrlKey || metaKey || shiftKey)) {
				this.selectionStateMachine.enterEditor();
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
	 * Remove and cleanup the current model for notebook.
	 */
	private _detachModel() {
		this._logService.info(this.id, 'detachModel');
		this._modelStore.clear();
	}

	// #endregion
}


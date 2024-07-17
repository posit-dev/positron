/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { insertCellAtIndex } from 'vs/workbench/contrib/notebook/browser/controller/cellOperations';
import { IActiveNotebookEditorDelegate, IBaseCellEditorOptions, INotebookEditorCreationOptions, INotebookEditorViewState, INotebookViewCellsUpdateEvent } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookOptions } from 'vs/workbench/contrib/notebook/browser/notebookOptions';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModelImpl';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellEditType, CellKind, ICellReplaceEdit, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookExecutionService } from 'vs/workbench/contrib/notebook/common/notebookExecutionService';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { createNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
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

interface IPositronNotebookInstanceRequiredViewModel extends IPositronNotebookInstance {
	viewModel: NotebookViewModel;
}
interface IPositronNotebookInstanceRequiredTextModel extends IPositronNotebookInstance {
	textModel: NotebookTextModel;
}

export class PositronNotebookInstance extends Disposable implements IPositronNotebookInstance {

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
			existingInstance._creationOptions = creationOptions;
			return existingInstance;
		}

		const instance = instantiationService.createInstance(PositronNotebookInstance, input, creationOptions);
		PositronNotebookInstance._instanceMap.set(pathOfNotebook, instance);
		return instance;
	}

	static _instanceMap: Map<string, PositronNotebookInstance> = new Map();


	/**
	 * Value to keep track of what instance number.
	 * Used for keeping track in the logs.
	 */
	static count = 0;

	private _identifier: string = `Positron Notebook | NotebookInstance(${PositronNotebookInstance.count++}) |`;

	/**
	 * Internal cells that we use to manage the state of the notebook
	 */
	private _cells: IPositronNotebookCell[] = [];

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

	private language: string | undefined = undefined;

	/**
	 * A set of disposables that are linked to a given model
	 * that need to be cleaned up when the model is changed.
	 */
	private readonly _modelStore = this._register(new DisposableStore());

	/**
	 * Store of disposables.
	 */
	private readonly _localStore = this._register(new DisposableStore());

	private _container: HTMLElement | undefined = undefined;

	/**
	 * Is the instance connected to an editor as indicated by having an associated container object?
	 */
	get connectedToEditor(): boolean {
		return Boolean(this._container);
	}
	/**
	 * Callback to clear the keyboard navigation listeners. Set when listeners are attached.
	 */
	private _clearKeyboardNavigation: (() => void) | undefined = undefined;

	/**
	 * Key-value map of language to base cell editor options for cells of that language.
	 */
	private _baseCellEditorOptions: Map<string, IBaseCellEditorOptions> = new Map();

	/**
	 * Mirrored cell state listeners from the notebook model.
	 */
	private _localCellStateListeners: DisposableStore[] = [];

	get uri(): URI {
		return this._input.resource;
	}

	/**
	 * View model for the notebook.
	 */
	private _viewModel: NotebookViewModel | undefined = undefined;

	/**
	 * Returns view model. Type of unknown is used to deal with type import rules. Should be type-cast to NotebookViewModel.
	 */
	get viewModel(): NotebookViewModel | undefined {
		return this._viewModel;
	}

	private assertViewModel(): asserts this is IPositronNotebookInstanceRequiredViewModel {
		if (this._viewModel === undefined) {
			throw new Error('No view model for notebook');
		}
	}

	/**
	 * Get the current `NotebookTextModel` for the editor.
	 */
	get textModel() {
		return this._viewModel?.notebookDocument;
	}

	private assertTextModel(): asserts this is IPositronNotebookInstanceRequiredTextModel {
		if (this.textModel === undefined) {
			throw new Error('No text model for notebook');
		}
	}


	/**
	 * Internal event emitter for when the editor's options change.
	 */
	private readonly _onDidChangeOptions = this._register(new Emitter<void>());
	/**
	 * Event emitter for when the editor's options change.
	 */
	readonly onDidChangeOptions: Event<void> = this._onDidChangeOptions.event;

	/**
	 * Internal event emitter for when the editor's decorations change.
	 */
	private readonly _onDidChangeDecorations = this._register(new Emitter<void>());
	/**
	 * Event emitter for when the editor's decorations change.
	 */
	readonly onDidChangeDecorations: Event<void> = this._onDidChangeDecorations.event;

	/**
	 * Internal event emitter for when the cells of the current view model change.
	 */
	private readonly _onDidChangeViewCells = this._register(new Emitter<INotebookViewCellsUpdateEvent>());
	/**
	 * Event emitter for when the cells of the current view model change.
	 */
	readonly onDidChangeViewCells: Event<INotebookViewCellsUpdateEvent> = this._onDidChangeViewCells.event;

	// #region NotebookModel
	/**
	 * Model for the notebook contents. Note the difference between the NotebookTextModel and the
	 * NotebookViewModel.
	 */
	private readonly _onWillChangeModel = this._register(new Emitter<NotebookTextModel | undefined>());
	/**
	 * Fires an event when the notebook model for the editor is about to change. The argument is the
	 * outgoing `NotebookTextModel` model.
	 */
	readonly onWillChangeModel: Event<NotebookTextModel | undefined> = this._onWillChangeModel.event;
	private readonly _onDidChangeModel = this._register(new Emitter<NotebookTextModel | undefined>());

	/**
	 * Fires an event when the notebook model for the editor has changed. The argument is the new
	 * `NotebookTextModel` model.
	 */
	readonly onDidChangeModel: Event<NotebookTextModel | undefined> = this._onDidChangeModel.event;

	/**
	 * Keep track of if this editor has been disposed.
	 */
	isDisposed: boolean = false;

	constructor(
		private _input: PositronNotebookEditorInput,
		private _creationOptions: INotebookEditorCreationOptions | undefined,
		@ICommandService private readonly _commandService: ICommandService,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
		@INotebookExecutionStateService private readonly notebookExecutionStateService: INotebookExecutionStateService,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@ILogService private readonly _logService: ILogService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService,
	) {
		super();

		this.cells = observableValue<IPositronNotebookCell[]>('positronNotebookCells', this._cells);
		this.kernelStatus = observableValue<KernelStatus>('positronNotebookKernelStatus', KernelStatus.Uninitialized);

		this._setupNotebookTextModel();

		this.contextManager = this._instantiationService.createInstance(PositronNotebookContextKeyManager);
		this.selectionStateMachine = this._register(this._instantiationService.createInstance(SelectionStateMachine));

		this._positronNotebookService.registerInstance(this);

		this._register(
			this.notebookKernelService.onDidChangeSelectedNotebooks((e) => {
				// If this is our notebook, update the kernel status as needed.
				const isThisNotebook = e.notebook.path === this._input.resource.path;
				if (!isThisNotebook) { return; }

				this.assertTextModel();
				// Select the kernel
				const kernel = this.notebookKernelService.getSelectedOrSuggestedKernel(this.textModel);

				if (!kernel) {
					this.kernelStatus.set(KernelStatus.Disconnected, undefined);
					return;
				}

				this.notebookKernelService.selectKernelForNotebook(kernel, this.textModel);

				console.log('Kernel changed for notebook', e);
				const hasKernel = e.newKernel !== undefined;
				this.kernelStatus.set(hasKernel ? KernelStatus.Connected : KernelStatus.Disconnected, undefined);
			})
		);

		this._logService.info(this._identifier, 'constructor');
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
		this._logService.info(this._identifier, 'Generating new notebook options');

		this._notebookOptions = this._creationOptions?.options ?? new NotebookOptions(
			DOM.getActiveWindow(),
			this.isReadOnly,
			undefined,
			this.configurationService,
			this.notebookExecutionStateService,
			this._codeEditorService
		);

		return this._notebookOptions;
	}

	/**
	 * Options for how the notebook should be displayed. Currently not really used but will be as
	 * notebook gets fleshed out.
	 */
	private _notebookOptions: NotebookOptions | undefined;


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

		const notebookModel = model.notebook;

		const fillCells = () => {

			const cellModelToCellMap = new Map(
				this._cells.map(cell => [cell.cellModel, cell])
			);

			const newlyAddedCells: IPositronNotebookCell[] = [];

			// Update cells with new cells
			this._cells = notebookModel.cells.map(cell => {
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

			this.language = notebookModel.cells[0].language;
			this.cells.set(this._cells, undefined);
			this.selectionStateMachine.setCells(this._cells);
		};

		fillCells();

		this.assertTextModel();

		// TODO: Make sure this is cleaned up properly.
		this._modelStore.add(this.textModel);
		this._modelStore.add(
			this.textModel.onDidChangeContent((e) => {
				// Only update cells if the number of cells has changed. Aka we've added or removed
				// cells. There's a chance this is not smart enough. E.g. it may be possible to
				// swap cells in the notebook and this would not catch that.
				const numOldCells = this._cells.length;
				const numNewCells = notebookModel.cells.length;

				if (numOldCells === numNewCells) {
					return;
				}

				fillCells();
			})
		);
	}

	async runCells(cells: IPositronNotebookCell[]): Promise<void> {

		if (!cells) {
			throw new Error(localize('noCells', "No cells to run"));
		}
		await this._runCells(cells);
	}

	async runAllCells(): Promise<void> {
		await this._runCells(this._cells);
	}

	/**
	 * Internal method to run cells, used by other cell running methods.
	 * @param cells Cells to run
	 * @returns
	 */
	private async _runCells(cells: IPositronNotebookCell[]): Promise<void> {
		// Filter so we're only working with code cells.
		const codeCells = cells;
		this._logService.info(this._identifier, '_runCells');

		this.assertTextModel();

		// Make sure we have a kernel to run the cells.
		if (this.kernelStatus.get() !== KernelStatus.Connected) {
			this._logService.info(this._identifier, 'No kernel connected, attempting to connect');
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

	addCell(type: CellKind, index: number): void {
		this.assertViewModel();

		if (!this.language) {
			throw new Error(localize('noLanguage', "No language for notebook"));
		}
		const synchronous = true;
		const pushUndoStop = true;
		insertCellAtIndex(
			this.viewModel,
			index,
			'',
			this.language,
			type,
			undefined,
			[],
			synchronous,
			pushUndoStop
		);
	}

	insertCodeCellAndFocusContainer(aboveOrBelow: 'above' | 'below'): void {
		const indexOfSelectedCell = this.selectionStateMachine.getIndexOfSelectedCell();
		if (indexOfSelectedCell === null) {
			return;
		}

		this.addCell(CellKind.Code, indexOfSelectedCell + (aboveOrBelow === 'above' ? 0 : 1));
	}

	deleteCell(cellToDelete?: IPositronNotebookCell): void {
		this.assertTextModel();

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

	}

	/**
	 * Set the currently selected cells for notebook instance
	 * @param cellOrCells The cell or cells to set as selected
	 */
	setSelectedCells(cells: IPositronNotebookCell[]): void {
		this.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
	}

	deselectCell(cell: IPositronNotebookCell): void {
		this.selectionStateMachine.deselectCell(cell);
	}

	setEditingCell(cell: IPositronNotebookCell | undefined): void {
		if (cell === undefined) {
			return;
		}
		this.selectionStateMachine.selectCell(cell, CellSelectionType.Edit);
	}

	async attachView(viewModel: NotebookViewModel, container: HTMLElement, viewState?: INotebookEditorViewState) {
		// Make sure we're detethered from existing views. (Useful when we're swapping to a new
		// window and the old window still exists)

		this.detachView();

		this._container = container;

		this.contextManager.setContainer(container);

		const alreadyHasModel = this._viewModel !== undefined && this._viewModel.equal(viewModel.notebookDocument);
		if (alreadyHasModel) {
			// No need to do anything if the model is already set.
			return;
		}

		const notifyOfModelChange = true;

		if (notifyOfModelChange) {
			// Fire on will change with old model
			this._onWillChangeModel.fire(this._viewModel?.notebookDocument);
		}

		this._viewModel = viewModel;

		if (notifyOfModelChange) {
			// Fire on did change with new model
			this._onDidChangeModel.fire(this._viewModel?.notebookDocument);
		}

		// Bring the view model back to the state it was in when the view state was saved.
		this._viewModel?.restoreEditorViewState(viewState);

		if (this._viewModel) {
			this._localStore.add(this._viewModel.onDidChangeViewCells(e => {
				this._onDidChangeViewCells.fire(e);
			}));
		}

		this._setupKeyboardNavigation(container);

		this._logService.info(this._identifier, 'attachView');
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
		this._logService.info(this._identifier, 'detachModel');
		// Clear store of disposables
		this._localStore.clear();

		// Dispose of all cell state listeners from the outgoing model
		dispose(this._localCellStateListeners);

		this._viewModel?.dispose();
		this._viewModel = undefined;
	}

	// #endregion

	/**
	 * Type guard to check if the editor has a model.
	 * @returns True if the editor has a model, false otherwise.
	 */
	hasModel(): this is IActiveNotebookEditorDelegate {
		return Boolean(this._viewModel);
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
			hasModel: this.hasModel,
			onDidChangeOptions: this.onDidChangeOptions,
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
		this._logService.info(this._identifier, 'detachView');
		this._clearKeyboardNavigation?.();
		this._notebookOptions?.dispose();
		this._detachModel();
		this._localStore.clear();
	}

	override dispose() {

		this._logService.info(this._identifier, 'dispose');
		this._positronNotebookService.unregisterInstance(this);

		super.dispose();
		this.detachView();
	}
}


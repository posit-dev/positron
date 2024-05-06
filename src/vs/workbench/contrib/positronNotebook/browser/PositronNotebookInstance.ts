/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
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
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
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




export class PositronNotebookInstance extends Disposable implements IPositronNotebookInstance {
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
	private _modelStore = this._register(new DisposableStore());

	/**
	 * Store of disposables.
	 */
	private _localStore = this._register(new DisposableStore());

	private _textModel: NotebookTextModel | undefined = undefined;
	private _viewModel: NotebookViewModel | undefined = undefined;

	private _container: HTMLElement | undefined = undefined;

	/**
	 * Callback to clear the keyboard navigation listeners. Set when listeners are attached.
	 */
	private _clearKeyboardNavigation: (() => void) | undefined = undefined;

	/**
	 * Key-value map of language to base cell editor options for cells of that language.
	 */
	private _baseCellEditorOptions: Map<string, IBaseCellEditorOptions> = new Map();

	readonly isReadOnly: boolean;

	/**
	 * Mirrored cell state listeners from the notebook model.
	 */
	private _localCellStateListeners: DisposableStore[] = [];

	get uri(): URI {
		return this._input.resource;
	}

	/**
	 * Returns view model. Type of unknown is used to deal with type import rules. Should be type-cast to NotebookViewModel.
	 */
	get viewModel(): NotebookViewModel | undefined {
		return this._viewModel;
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
		public _input: PositronNotebookEditorInput,
		public readonly creationOptions: INotebookEditorCreationOptions | undefined,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
		@INotebookExecutionStateService private readonly notebookExecutionStateService: INotebookExecutionStateService,
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

		this.isReadOnly = this.creationOptions?.isReadOnly ?? false;

		this.setupNotebookTextModel();

		this.contextManager = this._instantiationService.createInstance(PositronNotebookContextKeyManager);
		this.selectionStateMachine = this._instantiationService.createInstance(SelectionStateMachine);

		this._positronNotebookService.registerInstance(this);

		this._logService.info(this._identifier, 'constructor');
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

		this._notebookOptions = this.creationOptions?.options ?? new NotebookOptions(
			DOM.getActiveWindow(),
			this.configurationService,
			this.notebookExecutionStateService,
			this._codeEditorService,
			this.isReadOnly
		);

		return this._notebookOptions;
	}

	/**
	 * Options for how the notebook should be displayed. Currently not really used but will be as
	 * notebook gets fleshed out.
	 */
	private _notebookOptions: NotebookOptions | undefined;


	private async setupNotebookTextModel() {
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
					newlyAddedCells[0].select(CellSelectionType.Edit);
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

		this._textModel = notebookModel;

		// TODO: Make sure this is cleaned up properly.
		this._modelStore.add(this._textModel);
		this._modelStore.add(
			this._textModel.onDidChangeContent((e) => {
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

		if (!this._textModel) {
			throw new Error(localize('noModel', "No model"));
		}

		this._trySetupKernel();

		for (const cell of codeCells) {
			if (cell.isCodeCell()) {
				cell.executionStatus.set('running', undefined);
			}
		}

		const hasExecutions = [...cells].some(cell => Boolean(this.notebookExecutionStateService.getCellExecution(cell.uri)));

		if (hasExecutions) {
			this.notebookExecutionService.cancelNotebookCells(this._textModel, Array.from(cells).map(c => c.cellModel as NotebookCellTextModel));
			return;
		}

		await this.notebookExecutionService.executeNotebookCells(this._textModel, Array.from(cells).map(c => c.cellModel as NotebookCellTextModel), this._contextKeyService);
		for (const cell of codeCells) {
			if (cell.isCodeCell()) {
				cell.executionStatus.set('idle', undefined);
			}
		}
	}

	addCell(type: CellKind, index: number): void {
		if (!this._viewModel) {
			throw new Error(localize('noViewModel', "No view model for notebook"));
		}

		if (!this.language) {
			throw new Error(localize('noLanguage', "No language for notebook"));
		}
		const synchronous = true;
		const pushUndoStop = true;
		insertCellAtIndex(
			this._viewModel,
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
		if (!this._textModel) {
			throw new Error(localize('noModelForDelete', "No model for notebook to delete cell from"));
		}

		const cell = cellToDelete ?? this.selectionStateMachine.getSelectedCell();

		if (!cell) {
			return;
		}

		const textModel = this._textModel;
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
	 * Get the current `NotebookTextModel` for the editor.
	 */
	get textModel() {
		return this._viewModel?.notebookDocument;
	}

	/**
	 * Type guard to check if the editor has a model.
	 * @returns True if the editor has a model, false otherwise.
	 */
	hasModel(): this is IActiveNotebookEditorDelegate {
		return Boolean(this._viewModel);
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

		const onKeyDown = ({ key, shiftKey, ctrlKey, metaKey }: KeyboardEvent) => {

			if (key === 'Enter' && !(ctrlKey || metaKey || shiftKey)) {
				this.selectionStateMachine.enterEditor();
			} else if (key === 'Escape') {
				this.selectionStateMachine.exitEditor();
				// Arrow keys are used in conjunction with shift to create multi-selections. Plain arrow
				// key movement is handled by the `list.focusUp` and `list.focusDown` commands.
			} else if (key === 'ArrowUp' && shiftKey) {
				this.selectionStateMachine.moveUp(true);
			} else if (key === 'ArrowDown' && shiftKey) {
				this.selectionStateMachine.moveDown(true);
			}

		};

		this._container?.addEventListener('keydown', onKeyDown);

		this._clearKeyboardNavigation = () => {
			this._container?.removeEventListener('keydown', onKeyDown);
		};
	}

	/**
	 * Remove and cleanup the current model for notebook.
]	 */
	private _detachModel() {
		this._logService.info(this._identifier, 'detachModel');
		// Clear store of disposables
		this._localStore.clear();

		// Dispose of all cell state listeners from the outgoing model
		dispose(this._localCellStateListeners);

		this._viewModel?.dispose();
		this._viewModel = undefined;
	}

	/**
	 * Attempt to connect to the kernel for running notebook code.
	 * Eventually this will be replaced with a more robust kernel selection system.
	 */
	private async _trySetupKernel(): Promise<void> {
		const kernelStatus = this.kernelStatus.get();
		if (kernelStatus === KernelStatus.Connected || kernelStatus === KernelStatus.Connecting) {
			return;
		}
		this.kernelStatus.set(KernelStatus.Connecting, undefined);
		// How long we wait before trying to attach the kernel again if we fail to find one.
		const KERNEL_RETRY_DELAY = 2000;

		// How many times we attempt to attach the kernel before giving up.
		const KERNEL_RETRY_COUNT = 3;

		let lastError: unknown;
		for (let tryCount = 0; tryCount < KERNEL_RETRY_COUNT; tryCount++) {

			this._logService.info(this._identifier, `trySetupKernel (#${tryCount})`);

			const kernelAttempt = this._lookForKernel();

			if (kernelAttempt.success) {
				this._logService.info(this._identifier, 'Successfully located kernel');

				this.kernelStatus.set(KernelStatus.Connected, undefined);

				return;
			}

			lastError = kernelAttempt.msg;

			// Wait for a bit before trying again.
			await new Promise(resolve => setTimeout(resolve, KERNEL_RETRY_DELAY));
		}

		this.kernelStatus.set(KernelStatus.Errored, undefined);

		this._logService.error(
			this._identifier,
			localize('failedToFindKernel', "Failed to locate kernel for file '{0}'.", this._viewModel?.uri.path),
			lastError
		);
	}

	/**
	 * Look for and attach a kernel to the notebook if possible.
	 * @returns result object with success status and message if failed.
	 */
	private _lookForKernel(): { success: true } | { success: false; msg: string } {
		if (!this._viewModel) {
			throw new Error('No view model');
		}

		const kernelMatches = this.notebookKernelService.getMatchingKernel(this._viewModel.notebookDocument);

		// Make sure we actually have kernels that have matched
		if (kernelMatches.all.length === 0) {
			// Throw localized error explaining that there are no kernels that match the notebook
			// language.
			return {
				success: false,
				msg: localize('noKernel', "No kernel for file '{0}' found.", this._viewModel.uri.path)
			};
		}

		const positronKernels = kernelMatches.all.filter(k => k.extension.value === 'vscode.positron-notebook-controllers');

		const LANGUAGE_FOR_KERNEL = 'python';

		const kernelForLanguage = positronKernels.find(k => k.supportedLanguages.includes(LANGUAGE_FOR_KERNEL));

		if (!kernelForLanguage) {
			return {
				success: false,
				msg: localize('noKernelForLanguage', "No kernel for language '{0}' found.", LANGUAGE_FOR_KERNEL)
			};
		}

		// Link kernel with notebook
		this.notebookKernelService.selectKernelForNotebook(kernelForLanguage, this._viewModel.notebookDocument);

		return { success: true };
	}


	// #endregion

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


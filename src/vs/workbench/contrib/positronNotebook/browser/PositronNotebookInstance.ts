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
import { insertCellAtIndex } from 'vs/workbench/contrib/notebook/browser/controller/cellOperations';
import { IActiveNotebookEditorDelegate, IBaseCellEditorOptions, INotebookEditorCreationOptions, INotebookEditorViewState, INotebookViewCellsUpdateEvent } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookOptions } from 'vs/workbench/contrib/notebook/browser/notebookOptions';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModelImpl';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellEditType, CellKind, ICellReplaceEdit, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookExecutionService } from 'vs/workbench/contrib/notebook/common/notebookExecutionService';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { PositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { PositronNotebookEditorInput } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorInput';
import { BaseCellEditorOptions } from './BaseCellEditorOptions';
import * as DOM from 'vs/base/browser/dom';

const cellTypeToKind = {
	'code': CellKind.Code,
	'markdown': CellKind.Markup,
};

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
	cells: ISettableObservable<PositronNotebookCell[]>;

	/**
	 * The currently selected cells. Typically a single cell but can be multiple cells.
	 */
	selectedCells: PositronNotebookCell[];

	/**
	 * Has the notebook instance been disposed?
	 */
	isDisposed: boolean;

	// Methods for interacting with the notebook

	/**
	 * Run the given cells
	 * @param cells The cells to run
	 */
	runCells(cells: PositronNotebookCell[]): Promise<void>;

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
	addCell(type: keyof typeof cellTypeToKind, index: number): void;

	/**
	 * Delete a cell from the notebook
	 */
	deleteCell(cell: PositronNotebookCell): void;

	/**
	 * Attach a view model to this instance
	 * @param viewModel View model for the notebook
	 * @param viewState Optional view state for the notebook
	 */
	setViewModel(viewModel: NotebookViewModel, viewState?: INotebookEditorViewState): void;

	/**
	 * Detach the current model from the notebook
	 */
	detachModel(): void;
}

export class PositronNotebookInstance extends Disposable implements IPositronNotebookInstance {

	selectedCells: PositronNotebookCell[] = [];

	/**
	 * Internal cells that we use to manage the state of the notebook
	 */
	private _cells: PositronNotebookCell[] = [];

	/**
	 * User facing cells wrapped in an observerable for the UI to react to changes
	 */
	cells: ISettableObservable<PositronNotebookCell[]>;

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


	/**
	 * Key-value map of language to base cell editor options for cells of that language.
	 */
	private _baseCellEditorOptions: Map<string, IBaseCellEditorOptions> = new Map();


	/**
	 * Options for how the notebook should be displayed. Currently not really used but will be as
	 * notebook gets fleshed out.
	 */
	private readonly _notebookOptions: NotebookOptions;

	/**
	 * Gets the notebook options for the editor.
	 * Exposes the private internal notebook options as a get only property.
	 */
	get notebookOptions() {
		return this._notebookOptions;
	}
	readonly isReadOnly: boolean;


	/**
	 * Mirrored cell state listeners from the notebook model.
	 */
	private _localCellStateListeners: DisposableStore[] = [];
	// private readonly _scopedContextKeyService: IContextKeyService;

	get uri(): URI {
		return this._input.resource;
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
		readonly creationOptions: INotebookEditorCreationOptions | undefined,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
		@INotebookExecutionStateService private readonly notebookExecutionStateService: INotebookExecutionStateService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ICodeEditorService codeEditorService: ICodeEditorService
	) {
		super();

		this.cells = observableValue<PositronNotebookCell[]>('positronNotebookCells', this._cells);

		this.isReadOnly = creationOptions?.isReadOnly ?? false;

		this._notebookOptions = creationOptions?.options ?? new NotebookOptions(DOM.getActiveWindow(), this.configurationService, this.notebookExecutionStateService, codeEditorService, this.isReadOnly);

		this.setupNotebookTextModel();
	}


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

			// dispose old cells
			this._cells.forEach(cell => cell.dispose());

			// Update cells with new cells
			this._cells = notebookModel.cells.map(cell => this._instantiationService.createInstance(PositronNotebookCell, cell, this));


			this.language = notebookModel.cells[0].language;
			this.cells.set(this._cells, undefined);
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

	async runCells(cells: PositronNotebookCell[]): Promise<void> {

		if (!cells) {
			throw new Error(localize('noCells', "No cells to run"));
		}
		await this._runCells(cells);
	}

	async runAllCells(): Promise<void> {
		await this._runCells(this._cells);
	}

	async runSelectedCells(): Promise<void> {
		await this._runCells(this.selectedCells);
	}

	/**
	 * Internal method to run cells, used by other cell running methods.
	 * @param cells Cells to run
	 * @returns
	 */
	private async _runCells(cells: PositronNotebookCell[]): Promise<void> {
		if (!this._textModel) {
			throw new Error(localize('noModel', "No model"));
		}

		for (const cell of cells) {
			cell.executionStatus.set('running', undefined);
		}

		const hasExecutions = [...cells].some(cell => Boolean(this.notebookExecutionStateService.getCellExecution(cell.uri)));

		if (hasExecutions) {
			this.notebookExecutionService.cancelNotebookCells(this._textModel, Array.from(cells).map(c => c.viewModel));
			return;
		}

		await this.notebookExecutionService.executeNotebookCells(this._textModel, Array.from(cells).map(c => c.viewModel), this._contextKeyService);
		for (const cell of cells) {
			cell.executionStatus.set('idle', undefined);
		}
	}

	addCell(type: 'code' | 'markdown', index: number): void {
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
			cellTypeToKind[type],
			undefined,
			[],
			synchronous,
			pushUndoStop
		);
	}

	deleteCell(cell: PositronNotebookCell): void {
		if (!this._textModel) {
			throw new Error(localize('noModelForDelete', "No model for notebook to delete cell from"));
		}

		const textModel = this._textModel;
		// TODO: Hook up readOnly to the notebook actual value
		const readOnly = false;
		const computeUndoRedo = !readOnly || textModel.viewType === 'interactive';
		const cellIndex = textModel.cells.indexOf(cell.viewModel);

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


	async setViewModel(viewModel: NotebookViewModel, viewState?: INotebookEditorViewState) {

		// Confusingly the .equals() method for the NotebookViewModel takes a NotebookTextModel, not
		// a NotebookViewModel. This is because the NotebookViewModel is just a wrapper around the
		// NotebookTextModel... I guess?
		if (this._viewModel === undefined || !this._viewModel.equal(viewModel.notebookDocument)) {
			// Make sure we're working with a fresh model state
			this.detachModel();

			// In the vscode implementation they have a separate _attachModel method that is called
			// but we just inline it here because it's confusing to have both a setModel and
			// attachModel methods when the attachModel method is only called from setModel.

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

			// Update read only status of notebook. Why here?
			this._notebookOptions.updateOptions(this.isReadOnly);

			// Bring the view model back to the state it was in when the view state was saved.
			this._viewModel?.restoreEditorViewState(viewState);

			if (this._viewModel) {
				this._localStore.add(this._viewModel.onDidChangeViewCells(e => {
					this._onDidChangeViewCells.fire(e);
				}));
			}

			// Get the kernel up and running for the notebook.
			this.setupKernel();

		} else {
			throw new Error(localize('modelAlreadySet', "Model already set"));
		}
	}

	/**
	 * Remove and cleanup the current model for notebook.
	 * TODO: Flesh out rest of method once other components are implemented.
	 */
	detachModel() {
		// Clear store of disposables
		this._localStore.clear();

		// Dispose of all cell state listeners from the outgoing model
		dispose(this._localCellStateListeners);

		this._viewModel?.dispose();
		this._viewModel = undefined;
	}


	/**
	 * Connect to the kernel for running notebook code.
	 */
	private setupKernel() {
		if (!this._viewModel) {
			throw new Error('No view model');
		}

		const kernelMatches = this.notebookKernelService.getMatchingKernel(this._viewModel.notebookDocument);


		// Make sure we actually have kernels that have matched
		if (kernelMatches.all.length === 0) {
			// Throw localized error explaining that there are no kernels that match the notebook
			// language.
			throw new Error(localize('noKernel', "No kernel for file '{0}' found.", this._viewModel.uri.path));
		}

		const positronKernels = kernelMatches.all.filter(k => k.extension.value === 'vscode.positron-notebook-controllers');

		const LANGUAGE_FOR_KERNEL = 'python';

		const kernelForLanguage = positronKernels.find(k => k.supportedLanguages.includes(LANGUAGE_FOR_KERNEL));

		if (!kernelForLanguage) {
			throw new Error(localize('noKernelForLanguage', "No kernel for language '{0}' found.", LANGUAGE_FOR_KERNEL));
		}

		// Link kernel with notebook
		this.notebookKernelService.selectKernelForNotebook(kernelForLanguage, this._viewModel.notebookDocument);
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
		}, this._notebookOptions, this.configurationService, language);
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

	override dispose() {
		super.dispose();
		this.detachModel();
	}
}


/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';

import { PixelRatio } from 'vs/base/browser/browser';
import { ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { insertCellAtIndex } from 'vs/workbench/contrib/notebook/browser/controller/cellOperations';
import { IActiveNotebookEditorDelegate, IBaseCellEditorOptions, INotebookEditorCreationOptions, INotebookEditorViewState, INotebookViewCellsUpdateEvent } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookOptions } from 'vs/workbench/contrib/notebook/browser/notebookOptions';
import { NotebookLayoutChangedEvent } from 'vs/workbench/contrib/notebook/browser/notebookViewEvents';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModelImpl';
import { ViewContext } from 'vs/workbench/contrib/notebook/browser/viewModel/viewContext';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellEditType, CellKind, ICellReplaceEdit, NOTEBOOK_EDITOR_CURSOR_BOUNDARY, NOTEBOOK_EDITOR_CURSOR_LINE_BOUNDARY, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NOTEBOOK_CELL_LIST_FOCUSED } from 'vs/workbench/contrib/notebook/common/notebookContextKeys';
import { INotebookExecutionService } from 'vs/workbench/contrib/notebook/common/notebookExecutionService';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { NotebookInstanceProvider } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { PositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { PositronNotebookEditorInput } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorInput';
import { ServicesProvider } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { BaseCellEditorOptions } from './BaseCellEditorOptions';
import { PositronNotebookComponent } from './PositronNotebookComponent';



const cellTypeToKind = {
	'code': CellKind.Code,
	'markdown': CellKind.Markup,
};

/**
 * A headless instance that controls the complexity of the notebook.
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
	 * The current execution status for the notebook. This is derived via the cells status
	 */
	// executionStatus: IPositronNotebookCell['executionStatus'];


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
	 * TODO: Explain exactly what and why this exists
	 */
	private _localStore = this._register(new DisposableStore());

	private _textModel: NotebookTextModel | undefined = undefined;
	private _viewModel: NotebookViewModel | undefined = undefined;

	private _baseElement: HTMLElement | undefined;

	/**
		 * Key-value map of language to base cell editor options for cells of that language.
		 */
	private _baseCellEditorOptions: Map<string, IBaseCellEditorOptions> = new Map();

	/**
	 * Containing node for the iframe/webview containing the outputs of notebook cells
	 */
	private _outputOverlayContainer?: HTMLElement;

	/**
	 * An object containing notebook options, an event dispatcher, and a function to get base cell
	 * editor options.
	*/
	private _viewContext: ViewContext;

	/**
	 *
	 */
	private readonly _notebookOptions: NotebookOptions;

	/**
	 * Gets the notebook options for the editor.
	 * Exposes the private internal notebook options as a get only property.
	 */
	get notebookOptions() {
		return this._notebookOptions;
	}
	private readonly _readOnly: boolean;
	private _fontInfo: FontInfo | undefined;
	private _dimension?: DOM.Dimension;


	/**
	 * Mirrored cell state listeners from the notebook model.
	 */
	private _localCellStateListeners: DisposableStore[] = [];
	private readonly scopedInstantiationService: IInstantiationService;
	public readonly scopedContextKeyService: IContextKeyService;

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
	 * Gets or sets the PositronReactRenderer for the PositronNotebook component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;


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
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		this.cells = observableValue<PositronNotebookCell[]>('positronNotebookCells', this._cells);

		this._readOnly = creationOptions?.isReadOnly ?? false;

		this._notebookOptions = creationOptions?.options ?? new NotebookOptions(this.configurationService, this.notebookExecutionStateService, this._readOnly);

		this._viewContext = new ViewContext(
			this._notebookOptions,
			new NotebookEventDispatcher(),
			language => this.getBaseCellEditorOptions(language)
		);

		// Setup the container that will hold the outputs of notebook cells
		this._outputOverlayContainer = document.createElement('div');

		// Create a new context service that has the output overlay container as the root element.
		this.scopedContextKeyService = this.contextKeyService.createScoped(this._outputOverlayContainer);

		// Make sure that all things instantiated have a scoped context key service injected.
		this.scopedInstantiationService = this._instantiationService.createChild(
			new ServiceCollection([IContextKeyService, this.scopedContextKeyService])
		);

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

		if (this.scopedContextKeyService === undefined) {
			throw new Error(localize('noContext', "No scoped context key service"));
		}

		await this.notebookExecutionService.executeNotebookCells(this._textModel, Array.from(cells).map(c => c.viewModel), this.scopedContextKeyService);
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


	// /**
	//  * Setter for viewModel so we can (optionally) fire events when it changes.
	//  */
	// private _setViewModel(value: NotebookViewModel, notifyOfModelChange: boolean = true) {
	// 	if (notifyOfModelChange) {
	// 		// Fire on will change with old model
	// 		this._onWillChangeModel.fire(this._viewModel?.notebookDocument);
	// 	}

	// 	// Update model to new setting
	// 	this._viewModel = value;

	// 	if (notifyOfModelChange) {
	// 		// Fire on did change with new model
	// 		this._onDidChangeModel.fire(this._viewModel?.notebookDocument);
	// 	}
	// }

	/**
	 * Passthrough getter so that we can avoid needing to use the private field.
	 */
	getViewModel() {
		return this._viewModel;
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


	async setModel(textModel: NotebookTextModel, viewState?: INotebookEditorViewState) {

		// Confusingly the .equals() method for the NotebookViewModel takes a NotebookTextModel, not
		// a NotebookViewModel. This is because the NotebookViewModel is just a wrapper around the
		// NotebookTextModel... I guess?
		if (this._viewModel === undefined || !this._viewModel.equal(textModel)) {
			// Make sure we're working with a fresh model state
			this._detachModel();

			// In the vscode implementation they have a separate _attachModel method that is called
			// but we just inline it here because it's confusing to have both a setModel and
			// attachModel methods when the attachModel method is only called from setModel.

			const notifyOfModelChange = true;

			if (notifyOfModelChange) {
				// Fire on will change with old model
				this._onWillChangeModel.fire(this._viewModel?.notebookDocument);
			}

			// Update model to new setting
			this._viewModel = this.scopedInstantiationService.createInstance(
				NotebookViewModel,
				textModel.viewType,
				textModel,
				this._viewContext,
				this.getLayoutInfo(),
				{ isReadOnly: this._readOnly }
			);

			if (notifyOfModelChange) {
				// Fire on did change with new model
				this._onDidChangeModel.fire(this._viewModel?.notebookDocument);
			}


			// Emit an event into the view context for layout change so things can get initialized
			// properly.
			this._viewContext.eventDispatcher.emit(
				[new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]
			);

			// Update read only status of notebook. Why here?
			this._notebookOptions.updateOptions(this._readOnly);

			// Bring the view model back to the state it was in when the view state was saved.
			this.getViewModel()?.restoreEditorViewState(viewState);

			if (this._viewModel) {
				this._localStore.add(this._viewModel.onDidChangeViewCells(e => {
					this._onDidChangeViewCells.fire(e);
				}));
			}

			// Get the kernel up and running for the notebook.
			this.setupKernel();


			// TODO: Finish implementing this.
		} else {

		}
	}


	/**
	 * Connect to the kernel for running notebook code.
	 */
	private setupKernel() {

		const viewModel = this.getViewModel();

		if (!viewModel) {
			throw new Error('No view model');
		}

		const kernelMatches = this.notebookKernelService.getMatchingKernel(viewModel.notebookDocument);


		// Make sure we actually have kernels that have matched
		if (kernelMatches.all.length === 0) {
			// Throw localized error explaining that there are no kernels that match the notebook
			// language.
			throw new Error(localize('noKernel', "No kernel for file '{0}' found.", viewModel.uri.path));
		}

		const positronKernels = kernelMatches.all.filter(k => k.extension.value === 'vscode.positron-notebook-controllers');

		const LANGUAGE_FOR_KERNEL = 'python';

		const kernelForLanguage = positronKernels.find(k => k.supportedLanguages.includes(LANGUAGE_FOR_KERNEL));

		if (!kernelForLanguage) {
			throw new Error(localize('noKernelForLanguage', "No kernel for language '{0}' found.", LANGUAGE_FOR_KERNEL));
		}

		// Link kernel with notebook
		this.notebookKernelService.selectKernelForNotebook(kernelForLanguage, viewModel.notebookDocument);


	}


	/**
	 * Remove and cleanup the current model for notebook.
	 * TODO: Flesh out rest of method once other components are implemented.
	 */
	private _detachModel() {
		// Clear store of disposables
		this._localStore.clear();

		// Dispose of all cell state listeners from the outgoing model
		dispose(this._localCellStateListeners);

		// Once we've got the cell list object running. It will need to have the model detached here.
		// this._list.detachViewModel();

		this._viewModel?.dispose();
		this._viewModel = undefined;
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
			isReadOnly: this._readOnly,
		}, this._notebookOptions, this.configurationService, language);
		this._baseCellEditorOptions.set(language, options);
		return options;
	}


	/**
	 * Gather info about editor layout such as width, height, and scroll behavior.
	 * @returns The current layout info for the editor.
	 */
	private getLayoutInfo(): NotebookLayoutInfo {
		// if (!this._list) {
		// 	throw new Error('Editor is not initalized successfully');
		// }

		if (!this._fontInfo) {
			const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
			this._fontInfo = FontMeasurements.readFontInfo(BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.value));
		}

		return {
			width: this._dimension?.width ?? 0,
			height: this._dimension?.height ?? 0,
			scrollHeight: 0,
			// TODO: Implement this
			// scrollHeight: this._list?.getScrollHeight() ?? 0,
			fontInfo: this._fontInfo!,
			stickyHeight: 0,
			// TODO: Implement this
			// stickyHeight: this._notebookStickyScroll?.getCurrentStickyHeight() ?? 0
		};
	}


	/**
	 * Gets the PositronReactRenderer for the PositronNotebook component.
	 * Will create it if it doesn't exist.
	 */
	get positronReactRenderer() {
		if (this._positronReactRenderer) {
			return this._positronReactRenderer;
		}

		if (!this._baseElement) {
			throw new Error('Base element is not set.');
		}

		this._positronReactRenderer = new PositronReactRenderer(this._baseElement);

		return this._positronReactRenderer;
	}

	disposeReactRenderer() {
		this._positronReactRenderer?.dispose();
		this._positronReactRenderer = undefined;
	}

	/**
	 * Setup various context keys that are used by notebooks.
	 */
	setupContextKeyService() {
		const contextKeyService = this.scopedContextKeyService;
		NOTEBOOK_CELL_LIST_FOCUSED.bindTo(contextKeyService).set(true);
		const notebookEditorCursorAtBoundaryContext = NOTEBOOK_EDITOR_CURSOR_BOUNDARY.bindTo(contextKeyService);
		notebookEditorCursorAtBoundaryContext.set('none');
		const notebookEditorCursorAtLineBoundaryContext = NOTEBOOK_EDITOR_CURSOR_LINE_BOUNDARY.bindTo(contextKeyService);
		notebookEditorCursorAtLineBoundaryContext.set('none');
	}

	renderReact({
		size,
		baseElement
	}: {
		size: ISettableObservable<ISize>;
		baseElement: HTMLElement;
	}) {
		this._baseElement = baseElement;

		this.positronReactRenderer.render(

			<NotebookInstanceProvider instance={this}>
				<ServicesProvider services={{
					notebookWidget: this,
					configurationService: this.configurationService,
					instantiationService: this._instantiationService,
					textModelResolverService: this.textModelResolverService,
					sizeObservable: size,
					scopedContextKeyProviderCallback: container => this.scopedContextKeyService.createScoped(container)
				}}>
					<PositronNotebookComponent />
				</ServicesProvider>
			</NotebookInstanceProvider>
		);
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
		this._detachModel();
		this.disposeReactRenderer();
	}
}


interface NotebookLayoutInfo {
	width: number;
	height: number;
	scrollHeight: number;
	fontInfo: FontInfo;
	stickyHeight: number;
}

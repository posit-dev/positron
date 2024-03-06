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
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IActiveNotebookEditorDelegate, IBaseCellEditorOptions, INotebookEditorCreationOptions, INotebookEditorViewState, INotebookViewCellsUpdateEvent } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookOptions } from 'vs/workbench/contrib/notebook/browser/notebookOptions';
import { NotebookLayoutChangedEvent } from 'vs/workbench/contrib/notebook/browser/notebookViewEvents';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModelImpl';
import { ViewContext } from 'vs/workbench/contrib/notebook/browser/viewModel/viewContext';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { NOTEBOOK_EDITOR_CURSOR_BOUNDARY, NOTEBOOK_EDITOR_CURSOR_LINE_BOUNDARY } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NOTEBOOK_CELL_LIST_FOCUSED } from 'vs/workbench/contrib/notebook/common/notebookContextKeys';
import { INotebookExecutionService } from 'vs/workbench/contrib/notebook/common/notebookExecutionService';
import { INotebookCellExecution, INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { INotebookKernel, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { ContextKeyProvider } from 'vs/workbench/contrib/positronNotebook/browser/ContextKeyServiceProvider';
import { ServicesProvider } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { OptionalObservable } from 'vs/workbench/contrib/positronNotebook/common/utils/observeValue';
import { BaseCellEditorOptions } from './BaseCellEditorOptions';
import { PositronNotebookComponent } from './PositronNotebookComponent';
import { PositronNotebookEditorInput } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorInput';
import { NotebookInstanceProvider } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';


// Things currently omitted in the name of getting something working quicker:
// - Contributions

/**
 * Observable value for the notebook editor.
 */
export type NotebookViewModelObservable = OptionalObservable<
	NotebookViewModel
>;

export type NotebookKernelObservable = OptionalObservable<
	INotebookKernel
>;


type CellExecutionStatus = INotebookCellExecution | undefined;
export type CellExecutionStatusCallback = (cell: NotebookCellTextModel) => CellExecutionStatus;

export class PositronNotebookWidget extends Disposable
// implements INotebookEditor
{

	_baseElement: HTMLElement;
	_size: ISettableObservable<ISize>;
	_input: PositronNotebookEditorInput;

	/**
	 * Containing node for the iframe/webview containing the outputs of notebook cells
	 */
	_outputOverlayContainer?: HTMLElement;

	/**
	 * Store of disposables.
	 * TODO: Explain exactly what and why this exists
	 */
	private _localStore = this._register(new DisposableStore());

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
	private readonly instantiationService: IInstantiationService;
	public readonly scopedContextKeyService: IContextKeyService;

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


	constructor(
		{ size, input, baseElement }: {
			size: ISettableObservable<ISize>;
			input: PositronNotebookEditorInput;
			baseElement: HTMLElement;
		},
		readonly creationOptions: INotebookEditorCreationOptions | undefined,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
		@INotebookExecutionStateService private readonly notebookExecutionStateService: INotebookExecutionStateService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@IModelService private readonly _modelService: IModelService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this._size = size;
		this._input = input;
		this._baseElement = baseElement;


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
		this.scopedContextKeyService = contextKeyService.createScoped(this._outputOverlayContainer);

		// Make sure that all things instantiated have a scoped context key service injected.
		this.instantiationService = instantiationService.createChild(
			new ServiceCollection([IContextKeyService, this.scopedContextKeyService])
		);

		function watchForModelAdded(e: ITextModel) {
			console.log('model added', e);
		}

		this._register(this._modelService.onModelAdded(watchForModelAdded));


		// Logic to watch for kernels being added as available.
		// this._register(
		// 	this.notebookKernelService.onDidAddKernel(() => {
		// 		console.log('Kernel added');
		// 		const kernels = this.notebookKernelService.getMatchingKernel(this.getViewModel()!.notebookDocument);
		// 		const kernelList = kernels.all;

		// 		console.log('kernels', kernelList);
		// 	})
		// );



	}

	// TODO: Implement this
	// WIP to implement contributions. Currently paused due to contribution constructors needing the
	// widget to implement the INotebookEditor interface.
	//
	// setupContributions() {
	// 	let contributions: INotebookEditorContributionDescription[];
	// 	if (Array.isArray(this.creationOptions.contributions)) {
	// 		contributions = this.creationOptions.contributions;
	// 	} else {
	// 		contributions = NotebookEditorExtensionsRegistry.getEditorContributions();
	// 	}
	// 	for (const desc of contributions) {
	// 		let contribution: INotebookEditorContribution | undefined;
	// 		try {
	// 			contribution = this.instantiationService.createInstance(desc.ctor, this);
	// 		} catch (err) {
	// 			onUnexpectedError(err);
	// 		}
	// 		if (contribution) {
	// 			if (!this._contributions.has(desc.id)) {
	// 				this._contributions.set(desc.id, contribution);
	// 			} else {
	// 				contribution.dispose();
	// 				throw new Error(`DUPLICATE notebook editor contribution: '${desc.id}'`);
	// 			}
	// 		}
	// 	}

	// }

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

	_notebookViewModel?: NotebookViewModel;

	/**
	 * Setter for viewModel so we can (optionally) fire events when it changes.
	 */
	setViewModel(value: NotebookViewModel, notifyOfModelChange: boolean = true) {
		if (notifyOfModelChange) {
			// Fire on will change with old model
			this._onWillChangeModel.fire(this._notebookViewModel?.notebookDocument);
		}

		// Update model to new setting
		this._notebookViewModel = value;

		if (notifyOfModelChange) {
			// Fire on did change with new model
			this._onDidChangeModel.fire(this._notebookViewModel?.notebookDocument);
		}
	}

	/**
	 * Passthrough getter so that we can avoid needing to use the private field.
	 */
	getViewModel() {
		return this._notebookViewModel;
	}


	/**
	 * Get the current `NotebookTextModel` for the editor.
	 */
	get textModel() {
		return this._notebookViewModel?.notebookDocument;
	}

	/**
	 * Type guard to check if the editor has a model.
	 * @returns True if the editor has a model, false otherwise.
	 */
	hasModel(): this is IActiveNotebookEditorDelegate {
		return Boolean(this._notebookViewModel);
	}


	async setModel(textModel: NotebookTextModel, viewState?: INotebookEditorViewState) {

		// Confusingly the .equals() method for the NotebookViewModel takes a NotebookTextModel, not
		// a NotebookViewModel. This is because the NotebookViewModel is just a wrapper around the
		// NotebookTextModel... I guess?
		if (this._notebookViewModel === undefined || !this._notebookViewModel.equal(textModel)) {
			// Make sure we're working with a fresh model state
			this._detachModel();

			// In the vscode implementation they have a separate _attachModel method that is called
			// but we just inline it here because it's confusing to have both a setModel and
			// attachModel methods when the attachModel method is only called from setModel.

			this.setViewModel(
				this.instantiationService.createInstance(
					NotebookViewModel,
					textModel.viewType,
					textModel,
					this._viewContext,
					this.getLayoutInfo(),
					{ isReadOnly: this._readOnly }
				),
			);

			// Emit an event into the view context for layout change so things can get initialized
			// properly.
			this._viewContext.eventDispatcher.emit(
				[new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]
			);

			// Update read only status of notebook. Why here?
			this._notebookOptions.updateOptions(this._readOnly);

			// Bring the view model back to the state it was in when the view state was saved.
			this.getViewModel()?.restoreEditorViewState(viewState);


			const viewModel = this._notebookViewModel;
			if (viewModel) {
				this._localStore.add(viewModel.onDidChangeViewCells(e => {
					this._onDidChangeViewCells.fire(e);
				}));
				this._input.positronNotebookInstance.attachViewModel(viewModel);
			}

			// Get the kernel up and running for the notebook.
			this.setupKernel();


			// TODO: Finish implementing this.
		} else {

		}
	}

	executionServiceObservable: OptionalObservable<INotebookExecutionService> = observableValue(
		'execution-service',
		undefined
	);

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


		this.executionServiceObservable.set(this.notebookExecutionService, undefined);
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

		this._notebookViewModel?.dispose();
		this._notebookViewModel = undefined;

		// Once the webview for outputs is set up we'll need to clean them up here as well.
		// this._webview?.dispose();
		// this._webview?.element.remove();
		// this._webview = null;

		// this._list.clear();

	}

	// #endregion




	/**
	 * Keep track of if this editor has been disposed.
	 */
	isDisposed: boolean = false;






	/**
	 * Key-value map of language to base cell editor options for cells of that language.
	 */
	_baseCellEditorOptions: Map<string, IBaseCellEditorOptions> = new Map();

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
	 * Setup font info and assign to private variable
	 */
	private _generateFontInfo(): void {
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this._fontInfo = FontMeasurements.readFontInfo(BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.value));
	}

	/**
	 * Gather info about editor layout such as width, height, and scroll behavior.
	 * @returns The current layout info for the editor.
	 */
	getLayoutInfo(): NotebookLayoutInfo {
		// if (!this._list) {
		// 	throw new Error('Editor is not initalized successfully');
		// }

		if (!this._fontInfo) {
			this._generateFontInfo();
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
	 * Gets or sets the PositronReactRenderer for the PositronNotebook component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;


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

	renderReact() {

		this.positronReactRenderer.render(

			<NotebookInstanceProvider instance={this._input.positronNotebookInstance}>
				<ServicesProvider services={{
					notebookWidget: this,
					configurationService: this.configurationService,
					instantiationService: this.instantiationService,
					textModelResolverService: this.textModelResolverService,
					sizeObservable: this._size,
				}}>
					<ContextKeyProvider contextKeyServiceProvider={container => this.scopedContextKeyService.createScoped(container)} >
						<PositronNotebookComponent />
					</ContextKeyProvider>
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

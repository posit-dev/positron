/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';

import { PixelRatio } from 'vs/base/browser/pixelRatio';
import { ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { observableValue } from 'vs/base/common/observableInternal/base';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfiguration';
import { localize } from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import {
	EditorPaneSelectionChangeReason,
	IEditorMemento,
	IEditorOpenContext,
	IEditorPaneSelectionChangeEvent
} from 'vs/workbench/common/editor';
import {
	INotebookEditorOptions,
	INotebookEditorViewState
} from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookLayoutChangedEvent } from 'vs/workbench/contrib/notebook/browser/notebookViewEvents';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModelImpl';
import { ViewContext } from 'vs/workbench/contrib/notebook/browser/viewModel/viewContext';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { NotebookInstanceProvider } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { PositronNotebookComponent } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookComponent';
import { ServicesProvider } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import {
	GroupsOrder,
	IEditorGroupsService
} from 'vs/workbench/services/editor/common/editorGroupsService';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput';



interface NotebookLayoutInfo {
	width: number;
	height: number;
	scrollHeight: number;
	fontInfo: FontInfo;
	stickyHeight: number;
}

/**
 * Key for the memoized view state.
 */
const POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY =
	'NotebookEditorViewState';


export class PositronNotebookEditor extends EditorPane {
	_parentDiv: HTMLElement | undefined;

	/**
	 * A disposable store for disposables attached to the editor instance.
	 */
	private readonly _instanceDisposableStore = this._register(
		new DisposableStore()
	);

	//#region Editor State
	/**
	 * Stores the viewstate of the notebook. Used to restore the editor when it is reopened or
	 * moved do a different position in the editor.
	 */
	private readonly _editorMemento: IEditorMemento<INotebookEditorViewState>;

	private _saveEditorViewState(input?: PositronNotebookEditorInput) {
		// Save view state into momento
		if (
			this.group &&
			input instanceof PositronNotebookEditorInput
		) {
			const state = this.getInput().notebookInstance?.getEditorViewState();
			if (!state) {
				throw new Error('Cant save state. Notebook instance is not set.');
			}
			this._editorMemento.saveEditorState(this.group, input.resource, state);
		}
	}

	private _loadNotebookEditorViewState(
		input: PositronNotebookEditorInput
	): INotebookEditorViewState | undefined {
		let result: INotebookEditorViewState | undefined;
		if (this.group) {
			result = this._editorMemento.loadEditorState(this.group, input.resource);
		}
		if (result) {
			return result;
		}
		// when we don't have a view state for the group/input-tuple then we try to use an existing
		// editor for the same resource. (Comment copied from vs-notebooks implementation)
		for (const group of this._editorGroupService.getGroups(
			GroupsOrder.MOST_RECENTLY_ACTIVE
		)) {
			if (
				group.activeEditorPane !== this &&
				group.activeEditorPane instanceof PositronNotebookEditor &&
				group.activeEditor?.matches(input)
			) {
				return group.activeEditorPane.notebookInstance?.getEditorViewState();
			}
		}
		return;
	}

	protected override saveState(): void {
		this._saveEditorViewState();
		super.saveState();
	}

	override getViewState(): INotebookEditorViewState | undefined {
		if (!(this.input instanceof PositronNotebookEditorInput)) {
			return undefined;
		}
		this._saveEditorViewState();
		return this.notebookInstance?.getEditorViewState();
	}

	//#endregion Editor State

	/**
	 * Event emitter for letting the IDE know that there has been a selection change in the
	 * editor.
	 */
	private readonly _onDidChangeSelection = this._register(
		new Emitter<IEditorPaneSelectionChangeEvent>()
	);
	/**
	 * Event that fires when the editor's selection changes. This lets the IDE know
	 * that the selection, or what the user is currently editing, has changed. E.g. when the
	 * cursor has been moved in a cell.
	 */
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	/**
	 * Size as an observable so it can be lazily passed into the React component.
	 */
	private _size = observableValue<ISize>('size', { width: 0, height: 0 });

	// Getter for notebook instance to avoid having to cast the input every time.
	get notebookInstance() {
		return (this.input as PositronNotebookEditorInput)?.notebookInstance;
	}

	protected override createEditor(parent: HTMLElement): void {
		const myDiv = parent.ownerDocument.createElement('div');
		myDiv.style.display = 'relative';
		this._parentDiv = myDiv;


		// Create a new context service that has the output overlay container as the root element.
		this._scopedContextKeyService = this.contextKeyService.createScoped(myDiv);

		// Make sure that all things instantiated have a scoped context key service injected.
		this._scopedInstantiationService = this._instantiationService.createChild(
			new ServiceCollection([IContextKeyService, this._scopedContextKeyService])
		);

		parent.appendChild(myDiv);
	}




	override layout(
		dimension: DOM.Dimension,
		position?: DOM.IDomPosition | undefined
	): void {
		if (!this._parentDiv) {
			return;
		}
		DOM.size(this._parentDiv, dimension.width, dimension.height);

		this._size.set(dimension, undefined);
	}

	override async setInput(
		input: PositronNotebookEditorInput,
		options: INotebookEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
		noRetry?: boolean
	): Promise<void> {
		this._input = input;
		// Eventually this will probably need to be implemented like the vs notebooks
		// which uses a notebookWidgetService to manage the instances. For now, we'll
		// just create the instance directly.
		if (this._parentDiv === undefined) {
			throw new Error(
				'Parent div is undefined. This should have been created in createEditor.'
			);
		}


		// We're setting the options on the input here so that the input can resolve the model
		// without having to pass the options to the resolve method.
		input.editorOptions = options;

		await super.setInput(input, options, context, token);

		const model = await input.resolve(options);

		if (model === null) {
			throw new Error(
				localize(
					'fail.noModel',
					'Failed to find a model for view type {0}.',
					input.viewType
				)
			);
		}

		// Trigger the selection change event when the notebook was edited.
		this._instanceDisposableStore.add(
			model.notebook.onDidChangeContent(() =>
				this._onDidChangeSelection.fire({
					reason: EditorPaneSelectionChangeReason.EDIT
				})
			)
		);

		const viewState =
			options?.viewState ?? this._loadNotebookEditorViewState(input);


		if (input.notebookInstance === undefined) {
			throw new Error(
				'Notebook instance is undefined. This should have been created in the constructor.'
			);
		}

		this._renderReact();

		const viewModel = this.getViewModel(model.notebook);

		input.notebookInstance.setViewModel(viewModel, viewState);
	}

	override clearInput(): void {
		// Clear the input observable.
		this._input = undefined;

		if (this.notebookInstance) {
			this._saveEditorViewState();
		}

		// Call the base class's method.
		super.clearInput();
	}


	getInput(): PositronNotebookEditorInput {
		if (!this._input) {
			throw new Error('Input is not set.');
		}

		return this._input as PositronNotebookEditorInput;
	}

	getViewModel(textModel: NotebookTextModel) {

		const notebookInstance = this.getInput().notebookInstance;
		if (!notebookInstance) {
			throw new Error('Notebook instance is not set.');
		}

		if (!this._scopedInstantiationService) {
			throw new Error('Scoped instantiation service is not set. Make sure the editor has been created.');
		}

		const notebookOptions = notebookInstance.notebookOptions;


		const viewContext = new ViewContext(
			notebookOptions,
			new NotebookEventDispatcher(),
			language => notebookInstance.getBaseCellEditorOptions(language)
		);

		// Update model to new setting
		const viewModel = this._scopedInstantiationService.createInstance(
			NotebookViewModel,
			textModel.viewType,
			textModel,
			viewContext,
			this.getLayoutInfo(),
			{ isReadOnly: notebookInstance.isReadOnly }
		);



		// Emit an event into the view context for layout change so things can get initialized
		// properly.
		viewContext.eventDispatcher.emit(
			[new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]
		);

		return viewModel;

	}

	private _fontInfo: FontInfo | undefined;
	private _dimension?: DOM.Dimension;
	/**
	 * Gather info about editor layout such as width, height, and scroll behavior.
	 * @returns The current layout info for the editor.
	 */
	private getLayoutInfo(): NotebookLayoutInfo {


		if (!this._fontInfo) {
			const editorOptions = this._configurationService.getValue<IEditorOptions>('editor');
			//TODO: Get this as the active window and get it from DOM
			const activeWindow = DOM.getActiveWindow();
			this._fontInfo = FontMeasurements.readFontInfo(activeWindow, BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.getInstance(DOM.getActiveWindow()).value));
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

		if (!this._parentDiv) {
			throw new Error('Base element is not set.');
		}

		this._positronReactRenderer = new PositronReactRenderer(this._parentDiv);

		return this._positronReactRenderer;
	}


	private _disposeReactRenderer() {
		this._positronReactRenderer?.dispose();
		this._positronReactRenderer = undefined;
	}

	private _renderReact() {

		const notebookInstance = (this.input as PositronNotebookEditorInput)?.notebookInstance;

		if (!notebookInstance) {
			throw new Error('Notebook instance is not set.');
		}

		if (!this._parentDiv) {
			throw new Error('Base element is not set.');
		}
		// Create a new context service that has the output overlay container as the root element.
		const scopedContextKeyService = this.contextKeyService.createScoped(this._parentDiv);


		this.positronReactRenderer.render(

			<NotebookInstanceProvider instance={notebookInstance}>
				<ServicesProvider services={{
					notebookWidget: notebookInstance,
					configurationService: this._configurationService,
					instantiationService: this._instantiationService,
					textModelResolverService: this._textModelResolverService,
					sizeObservable: this._size,
					scopedContextKeyProviderCallback: container => scopedContextKeyService.createScoped(container)
				}}>
					<PositronNotebookComponent />
				</ServicesProvider>
			</NotebookInstanceProvider>
		);
	}

	private _scopedContextKeyService?: IContextKeyService;
	private _scopedInstantiationService?: IInstantiationService;

	constructor(
		@IClipboardService readonly _clipboardService: IClipboardService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService
		private readonly _editorGroupService: IEditorGroupsService,
		@ITextResourceConfigurationService
		configurationService: ITextResourceConfigurationService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITextModelService private readonly _textModelResolverService: ITextModelService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,

	) {
		// Call the base class's constructor.
		super(
			PositronNotebookEditorInput.EditorID,
			telemetryService,
			themeService,
			storageService
		);

		this._editorMemento = this.getEditorMemento<INotebookEditorViewState>(
			this._editorGroupService,
			configurationService,
			POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY
		);


	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {

		this.notebookInstance?.detachModel();

		this._disposeReactRenderer();

		// Call the base class's dispose method.
		super.dispose();
	}
}

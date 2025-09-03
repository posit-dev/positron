/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { PixelRatio } from '../../../../base/browser/pixelRatio.js';
import { ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { FontMeasurements } from '../../../../editor/browser/config/fontMeasurements.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { BareFontInfo, FontInfo } from '../../../../editor/common/config/fontInfo.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import {
	EditorPaneSelectionChangeReason,
	IEditorMemento,
	IEditorOpenContext,
	IEditorPaneSelectionChangeEvent
} from '../../../common/editor.js';
import {
	INotebookEditorOptions,
	INotebookEditorViewState
} from '../../notebook/browser/notebookBrowser.js';
import { NotebookLayoutChangedEvent, NotebookLayoutInfo } from '../../notebook/browser/notebookViewEvents.js';
import { NotebookEventDispatcher } from '../../notebook/browser/viewModel/eventDispatcher.js';
import { NotebookViewModel } from '../../notebook/browser/viewModel/notebookViewModelImpl.js';
import { ViewContext } from '../../notebook/browser/viewModel/viewContext.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { NotebookInstanceProvider } from './NotebookInstanceProvider.js';
import { PositronNotebookComponent } from './PositronNotebookComponent.js';
import { EnvironentProvider } from './EnvironmentProvider.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { NotebookVisibilityProvider } from './NotebookVisibilityContext.js';
import { observableValue } from '../../../../base/common/observable.js';
import { PositronNotebookEditorControl } from './PositronNotebookEditorControl.js';


/*
interface NotebookLayoutInfo {
	width: number;
	height: number;
	scrollHeight: number;
	fontInfo: FontInfo;
	stickyHeight: number;
}
	*/

/**
 * Key for the memoized view state.
 */
const POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY =
	'NotebookEditorViewState';



export class PositronNotebookEditor extends EditorPane {
	static readonly ID = 'workbench.editor.positronNotebook';

	/**
	 * Value to keep track of what instance of the editor this is.
	 * Used for keeping track of the editor in the logs.
	 */
	static count = 0;

	private _identifier = `Positron Notebook | Editor(${PositronNotebookEditor.count++}) |`;

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

	/**
	 * The editor control, used by other features to access the code editor widget of the selected cell.
	 */
	private readonly _control = this._register(new MutableDisposable<PositronNotebookEditorControl>());

	private _scopedContextKeyService?: IContextKeyService;
	private _scopedInstantiationService?: IInstantiationService;

	constructor(
		readonly _group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService
		private readonly _editorGroupService: IEditorGroupsService,
		@ITextResourceConfigurationService
		configurationService: ITextResourceConfigurationService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
	) {
		// Call the base class's constructor.
		super(
			PositronNotebookEditor.ID,
			_group,
			telemetryService,
			themeService,
			storageService
		);

		this._editorMemento = this.getEditorMemento<INotebookEditorViewState>(
			this._editorGroupService,
			configurationService,
			POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY
		);

		this._logService.info('PositronNotebookEditor created.');

	}


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

	// private _loadNotebookEditorViewState(
	// 	input: PositronNotebookEditorInput
	// ): INotebookEditorViewState | undefined {
	// 	let result: INotebookEditorViewState | undefined;
	// 	if (this.group) {
	// 		result = this._editorMemento.loadEditorState(this.group, input.resource);
	// 	}
	// 	if (result) {
	// 		return result;
	// 	}
	// 	// when we don't have a view state for the group/input-tuple then we try to use an existing
	// 	// editor for the same resource. (Comment copied from vs-notebooks implementation)
	// 	for (const group of this._editorGroupService.getGroups(
	// 		GroupsOrder.MOST_RECENTLY_ACTIVE
	// 	)) {
	// 		if (
	// 			group.activeEditorPane !== this &&
	// 			group.activeEditorPane instanceof PositronNotebookEditor &&
	// 			group.activeEditor?.matches(input)
	// 		) {
	// 			return group.activeEditorPane.notebookInstance?.getEditorViewState();
	// 		}
	// 	}
	// 	return;
	// }

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

	/**
	 * Observable tracking if the editor is currently visible
	 */
	private readonly _isVisible = observableValue<boolean>('isVisible', false);


	// Getter for notebook instance to avoid having to cast the input every time.
	get notebookInstance() {
		return this.input && (this.input as PositronNotebookEditorInput)?.notebookInstance;
	}

	protected override setEditorVisible(visible: boolean): void {
		this._isVisible.set(visible, undefined);
		super.setEditorVisible(visible);
	}

	protected override createEditor(parent: HTMLElement): void {

		this._logService.info(this._identifier, 'createEditor');
		this._parentDiv = DOM.$('.positron-notebook-container');
		parent.appendChild(this._parentDiv);
		this._parentDiv.style.display = 'relative';

		// Create a new context service that has the output overlay container as the root element.
		this._scopedContextKeyService = this.contextKeyService.createScoped(this._parentDiv);

		// Make sure that all things instantiated have a scoped context key service injected.
		this._scopedInstantiationService = this._instantiationService.createChild(
			new ServiceCollection([IContextKeyService, this._scopedContextKeyService])
		);

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
		this._logService.info(this._identifier, 'setInput');


		this._input = input;
		// Eventually this will probably need to be implemented like the vs notebooks
		// which uses a notebookWidgetService to manage the instances. For now, we'll
		// just create the instance directly.
		if (this._parentDiv === undefined) {
			throw new Error(
				'Parent div is undefined. This should have been created in createEditor.'
			);
		}

		if (input.notebookInstance === undefined) {
			throw new Error(
				'Notebook instance is undefined. This should have been created in the constructor.'
			);
		}

		// We're setting the options on the input here so that the input can resolve the model
		// without having to pass the options to the resolve method.
		input.editorOptions = options;

		// Update the editor control given the notebook instance.
		// This has to be done before we `await super.setInput` since that fires events
		// with listeners that call `this.getControl()` expecting an up-to-date control
		// i.e. with `activeCodeEditor` being the editor of the selected cell in the notebook.
		this._control.value = new PositronNotebookEditorControl(input.notebookInstance);

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

		this._renderReact();

		input.notebookInstance.attachView(this._parentDiv);
	}

	override clearInput(): void {
		this._logService.info(this._identifier, 'clearInput');

		if (this.notebookInstance && this._parentDiv) {
			this.notebookInstance.detachView();
			console.log('isVisible', this._isVisible.get());
		}

		if (this.notebookInstance) {
			this._saveEditorViewState();
			this.notebookInstance.detachView();
		}

		// Clear the input observable.
		this._input = undefined;

		// Clear the editor control.
		this._control.clear();

		this._disposeReactRenderer();

		// Call the base class's method.
		super.clearInput();
	}

	// TODO: Called when a cell URI is opened but its notebook editor pane is already open i.e. the cell editorinput matches the existing notebook one
	//       Should then focus/reveal the cell
	override async setOptions(options: INotebookEditorOptions | undefined): Promise<void> {
		super.setOptions(options);
		if (options) {
			this.notebookInstance?.setOptions(options);
		}
	}

	getInput(): PositronNotebookEditorInput {
		if (!this._input) {
			throw new Error('Input is not set.');
		}

		return this._input as PositronNotebookEditorInput;
	}

	getViewModel(textModel: NotebookTextModel) {
		this._logService.info(this._identifier, 'getViewModel');

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

	override getControl() {
		return this._control.value;
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
			listViewOffsetTop: 0
		};
	}

	/**
	 * Gets or sets the PositronReactRenderer for the PositronNotebook component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

	/**
	 * Disposes the PositronReactRenderer for the PositronNotebook component.
	 */
	private _disposeReactRenderer() {
		this._logService.info(this._identifier, 'disposeReactRenderer');

		if (this._positronReactRenderer) {
			this._positronReactRenderer.dispose();
			this._positronReactRenderer = undefined;
		}
	}

	private _renderReact() {
		this._logService.info(this._identifier, 'renderReact');

		const notebookInstance = (this.input as PositronNotebookEditorInput)?.notebookInstance;

		if (!notebookInstance) {
			throw new Error('Notebook instance is not set.');
		}

		if (!this._parentDiv) {
			throw new Error('Base element is not set.');
		}

		// Create a new context service that has the output overlay container as the root element.
		const scopedContextKeyService = this.contextKeyService.createScoped(this._parentDiv);

		const reactRenderer: PositronReactRenderer = this._positronReactRenderer ?? new PositronReactRenderer(this._parentDiv);

		reactRenderer.render(
			<NotebookVisibilityProvider isVisible={this._isVisible}>
				<NotebookInstanceProvider instance={notebookInstance}>
					<EnvironentProvider environmentBundle={{
						size: this._size,
						scopedContextKeyProviderCallback: container => scopedContextKeyService.createScoped(container),
					}}>
						<PositronNotebookComponent />
					</EnvironentProvider>
				</NotebookInstanceProvider>
			</NotebookVisibilityProvider>
		);
	}


	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		this._logService.info(this._identifier, 'dispose');
		this.notebookInstance?.detachView();

		this._disposeReactRenderer();

		// Call the base class's dispose method.
		super.dispose();
	}
}

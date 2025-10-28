/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import {
	EditorPaneSelectionChangeReason,
	IEditorOpenContext,
	IEditorPaneSelectionChangeEvent
} from '../../../common/editor.js';
import {
	INotebookEditorOptions,
	INotebookEditorViewState
} from '../../notebook/browser/notebookBrowser.js';
import { NotebookInstanceProvider } from './NotebookInstanceProvider.js';
import { PositronNotebookComponent } from './PositronNotebookComponent.js';
import { EnvironentProvider } from './EnvironmentProvider.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { NotebookVisibilityProvider } from './NotebookVisibilityContext.js';
import { observableValue } from '../../../../base/common/observable.js';
import { PositronNotebookEditorControl } from './PositronNotebookEditorControl.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { AbstractEditorWithViewState } from '../../../browser/parts/editor/editorWithViewState.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { isEqual } from '../../../../base/common/resources.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';


/**
 * Key for the memoized view state.
 */
const POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY =
	'PositronNotebookEditorViewState';



export class PositronNotebookEditor extends AbstractEditorWithViewState<INotebookEditorViewState> {
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

	protected override _input: PositronNotebookEditorInput | undefined;

	private _containerScopedContextKeyService: IScopedContextKeyService | undefined;

	/**
	 * The editor control, used by other features to access the code editor widget of the selected cell.
	 */
	private readonly _control = this._register(new MutableDisposable<PositronNotebookEditorControl>());

	constructor(
		readonly _group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IStorageService storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IEditorService editorService: IEditorService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		// Call the base class's constructor.
		super(
			POSITRON_NOTEBOOK_EDITOR_ID,
			_group,
			POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY,
			telemetryService,
			instantiationService,
			storageService,
			textResourceConfigurationService,
			themeService,
			editorService,
			editorGroupService,
		);

		this._logService.debug('PositronNotebookEditor created.');

	}

	//#region AbstractEditorWithViewState implementation

	/**
	 * The actual method to provide for gathering the view state
	 * object for the control.
	 *
	 * @param resource the expected `URI` for the view state. This
	 * should be used as a way to ensure the view state in the
	 * editor control is matching the resource expected, for example
	 * by comparing with the underlying model (this was a fix for
	 * https://github.com/microsoft/vscode/issues/40114).
	 */
	protected override computeEditorViewState(resource: URI): INotebookEditorViewState | undefined {
		if (this.notebookInstance &&
			this.notebookInstance.textModel &&
			isEqual(this.notebookInstance.textModel.uri, resource)) {
			return this.notebookInstance.getEditorViewState();
		}
		return undefined;
	}

	/**
	 * Whether view state should be associated with the given input.
	 * Subclasses need to ensure that the editor input is expected
	 * for the editor.
	 */
	protected override tracksEditorViewState(input: EditorInput): boolean {
		return input instanceof PositronNotebookEditorInput;
	}

	/**
	 * Whether view state should be tracked even when the editor is
	 * disposed.
	 *
	 * Subclasses should override this if the input can be restored
	 * from the resource at a later point, e.g. if backed by files.
	 */
	protected override tracksDisposedEditorViewState(): boolean {
		return true;
	}

	/**
	 * Asks to return the `URI` to associate with the view state.
	 */
	protected override toEditorViewStateResource(input: EditorInput): URI | undefined {
		return input.resource;
	}

	//#endregion AbstractEditorWithViewState implementation

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
	private readonly _size = observableValue<ISize>('size', { width: 0, height: 0 });

	/**
	 * Observable tracking if the editor is currently visible
	 */
	private readonly _isVisible = observableValue<boolean>('isVisible', false);


	// Getter for notebook instance to avoid having to cast the input every time.
	get notebookInstance() {
		return this._input?.notebookInstance;
	}

	protected override setEditorVisible(visible: boolean): void {
		this._isVisible.set(visible, undefined);
		super.setEditorVisible(visible);
	}

	protected override createEditor(parent: HTMLElement): void {

		this._logService.debug(this._identifier, 'createEditor');
		this._parentDiv = DOM.$('.positron-notebook-container');
		parent.appendChild(this._parentDiv);
		this._parentDiv.style.display = 'relative';
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
		this._logService.debug(this._identifier, 'setInput');


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

		// Update the editor control given the notebook instance.
		// This has to be done before we `await super.setInput` since that fires events
		// with listeners that call `this.getControl()` expecting an up-to-date control
		// i.e. with `activeCodeEditor` being the editor of the selected cell in the notebook.
		const { notebookInstance } = input;
		this._control.value = new PositronNotebookEditorControl(notebookInstance);

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

		// Set the notebook instance model
		notebookInstance.setModel(model.notebook, options?.viewState);

		// Trigger the selection change event when the notebook was edited.
		this._instanceDisposableStore.add(
			model.notebook.onDidChangeContent(() =>
				this._onDidChangeSelection.fire({
					reason: EditorPaneSelectionChangeReason.EDIT
				})
			)
		);

		const scopedContextKeyService = this._renderReact();

		notebookInstance.attachView(this._parentDiv, scopedContextKeyService);
	}

	/**
	 * Called when this composite should receive keyboard focus.
	 */
	override focus(): void {
		super.focus();

		// Drive focus into the notebook instance based on selection state
		if (this.notebookInstance) {
			this.notebookInstance.grabFocus();
		}
	}

	override clearInput(): void {
		this._logService.debug(this._identifier, 'clearInput');

		if (this.notebookInstance) {
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

	override async setOptions(options: INotebookEditorOptions | undefined): Promise<void> {
		// Called when the editor is already open and receives new options.
		// Should update the editor to reflect the given options,
		// such as selecting or revealing a cell or range in a cell editor.

		super.setOptions(options);

		// Pass the options to the notebook instance
		if (this.notebookInstance) {
			this.notebookInstance.setOptions(options);
		}
	}

	override getControl() {
		return this._control.value;
	}

	/**
	 * Gets or sets the PositronReactRenderer for the PositronNotebook component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

	/**
	 * Disposes the PositronReactRenderer for the PositronNotebook component.
	 */
	private _disposeReactRenderer() {
		this._logService.debug(this._identifier, 'disposeReactRenderer');

		if (this._positronReactRenderer) {
			this._positronReactRenderer.dispose();
			this._positronReactRenderer = undefined;
		}

		// Dispose of the scoped context key service
		this._containerScopedContextKeyService?.dispose();
		this._containerScopedContextKeyService = undefined;
	}

	private _renderReact(): IScopedContextKeyService {
		this._logService.debug(this._identifier, 'renderReact');

		if (!this.notebookInstance) {
			throw new Error('Notebook instance is not set.');
		}

		if (!this._parentDiv) {
			throw new Error('Base element is not set.');
		}

		// Set the editor container for focus tracking
		this.notebookInstance.setEditorContainer(this._parentDiv);

		// Create a scoped context key service rooted at the notebook container so cell scopes inherit it.
		const scopedContextKeyService = this._containerScopedContextKeyService = this.contextKeyService.createScoped(this._parentDiv);

		// Create renderer if it doesn't exist, otherwise reuse existing renderer
		if (!this._positronReactRenderer) {
			this._positronReactRenderer = new PositronReactRenderer(this._parentDiv);
		}
		const reactRenderer = this._positronReactRenderer;

		reactRenderer.render(
			<NotebookVisibilityProvider isVisible={this._isVisible}>
				<NotebookInstanceProvider instance={this.notebookInstance}>
					<EnvironentProvider environmentBundle={{
						size: this._size,
						scopedContextKeyProviderCallback: container => scopedContextKeyService.createScoped(container),
					}}>
						<PositronNotebookComponent />
					</EnvironentProvider>
				</NotebookInstanceProvider>
			</NotebookVisibilityProvider>
		);

		return scopedContextKeyService;
	}


	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		this._logService.debug(this._identifier, 'dispose');
		this.notebookInstance?.detachView();

		this._disposeReactRenderer();

		// Call the base class's dispose method.
		super.dispose();
	}
}

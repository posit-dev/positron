/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import * as React from 'react';

import { ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { observableValue } from 'vs/base/common/observableInternal/base';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfiguration';
import { localize } from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
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
import {
	GroupsOrder,
	IEditorGroupsService
} from 'vs/workbench/services/editor/common/editorGroupsService';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput';
import { PositronNotebookInstance } from './PositronNotebookInstance';
import { NotebookInstanceProvider } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { ServicesProvider } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { PositronNotebookComponent } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookComponent';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

/**
 * Key for the memoized view state.
 */
const POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY =
	'NotebookEditorViewState';


export class PositronNotebookEditor extends EditorPane {
	_parentDiv: HTMLElement | undefined;

	/**
	 * The main UI center of command for the notebooks. The logic for syncing react main UI and the
	 * outputs go here. The original vs notebooks used a borrow value here but we're using the plain
	 * instance itself. I think we can get away with this because we are making our rendering logic
	 * pure with React and thus don't need to save all the work of setting up the dom nodes etc that
	 * the imperitive style notebook editor does.
	 */
	private _notebookInstance: PositronNotebookInstance | undefined;

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
			this._notebookInstance &&
			input instanceof PositronNotebookEditorInput
		) {
			if (this._notebookInstance.isDisposed) {
				return;
			}

			const state = this._notebookInstance.getEditorViewState();
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
				return group.activeEditorPane._notebookInstance?.getEditorViewState();
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
		return this._notebookInstance?.getEditorViewState();
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


	protected override createEditor(parent: HTMLElement): void {
		const myDiv = parent.ownerDocument.createElement('div');
		myDiv.style.display = 'relative';
		this._parentDiv = myDiv;


		parent.appendChild(myDiv);
	}

	override clearInput(): void {
		// Clear the input observable.
		this._input = undefined;

		if (this._notebookInstance) {
			this._saveEditorViewState();
		}

		// Call the base class's method.
		super.clearInput();
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
		input.notebookInstance.setModel(model.notebook, viewState);
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


	disposeReactRenderer() {
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
		// Dispose of the notebook instance.
		this._notebookInstance?.dispose();

		this.disposeReactRenderer();

		// Call the base class's dispose method.
		super.dispose();
	}
}

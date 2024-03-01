/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';

import { ISize } from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import {
	observableValue
} from 'vs/base/common/observableInternal/base';
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
import { PositronNotebookWidget } from './PositronNotebookWidget';

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
	 * widget itself. I think we can get away with this because we are making our rendering logic
	 * pure with React and thus don't need to save all the work of setting up the dom nodes etc that
	 * the imperitive style notebook editor does.
	 */
	private _notebookWidget: PositronNotebookWidget | undefined;

	/**
	 * A disposable store for disposables attached to the editor widget.
	 */
	private readonly _widgetDisposableStore = this._register(
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
			this._notebookWidget &&
			input instanceof PositronNotebookEditorInput
		) {
			if (this._notebookWidget.isDisposed) {
				return;
			}

			const state = this._notebookWidget.getEditorViewState();
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
				return group.activeEditorPane._notebookWidget?.getEditorViewState();
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
		return this._notebookWidget?.getEditorViewState();
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

	// /**
	//  * Input as an observable so it can be lazily passed into the React component.
	//  */
	// private _inputObservable: InputObservable = observableValue(
	// 	'input',
	// 	undefined
	// );

	protected override createEditor(parent: HTMLElement): void {
		const myDiv = parent.ownerDocument.createElement('div');
		myDiv.style.display = 'relative';
		this._parentDiv = myDiv;

		parent.appendChild(myDiv);
	}

	override clearInput(): void {
		// Clear the input observable.
		(this._input as PositronNotebookEditorInput)?.positronNotebookInstance.detachFromEditor();
		this._input = undefined;

		if (this._notebookWidget) {
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
		// which uses a notebookWidgetService to manage the widgets. For now, we'll
		// just create the widget directly.
		if (this._parentDiv === undefined) {
			throw new Error(
				'Parent div is undefined. This should have been created in createEditor.'
			);
		}

		input.positronNotebookInstance.attachToEditor(this);

		this._notebookWidget = this._instantiationService.createInstance(
			PositronNotebookWidget,
			{
				size: this._size,
				input,
				baseElement: this._parentDiv,
			},
			undefined
		);

		this._notebookWidget.renderReact();
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
		this._widgetDisposableStore.add(
			model.notebook.onDidChangeContent(() =>
				this._onDidChangeSelection.fire({
					reason: EditorPaneSelectionChangeReason.EDIT
				})
			)
		);

		const viewState =
			options?.viewState ?? this._loadNotebookEditorViewState(input);


		this._notebookWidget?.setModel(model.notebook, viewState);

	}

	constructor(
		@IClipboardService readonly _clipboardService: IClipboardService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService
		private readonly _editorGroupService: IEditorGroupsService,
		@ITextResourceConfigurationService
		configurationService: ITextResourceConfigurationService,
		@IInstantiationService
		private readonly _instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService
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
		// Dispose of the notebook widget.
		this._notebookWidget?.dispose();

		// Call the base class's dispose method.
		super.dispose();
	}
}

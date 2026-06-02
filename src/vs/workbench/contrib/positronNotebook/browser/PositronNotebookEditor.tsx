/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneSelectionChangeReason, IEditorOpenContext, IEditorPaneSelectionChangeEvent } from '../../../common/editor.js';
import { INotebookEditorOptions } from '../../notebook/browser/notebookBrowser.js';
import { IPositronNotebookEditorOptions, IPositronNotebookViewState } from './positronNotebookEditorTypes.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { PositronNotebookEditorControl } from './PositronNotebookEditorControl.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { AbstractEditorWithViewState } from '../../../browser/parts/editor/editorWithViewState.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { isEqual } from '../../../../base/common/resources.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';


/**
 * Key for the memoized view state.
 */
const POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY =
	'PositronNotebookEditorViewState';


export class PositronNotebookEditor extends AbstractEditorWithViewState<IPositronNotebookViewState> {
	/**
	 * Value to keep track of what instance of the editor this is.
	 * Used for keeping track of the editor in the logs.
	 */
	static count = 0;

	private _identifier = `Positron Notebook | Editor(${PositronNotebookEditor.count++}) |`;

	protected override _input: PositronNotebookEditorInput | undefined;

	/**
	 * Expose the notebook's scoped context to the editor pane so that `when`
	 * clauses for menus and `precondition` clauses for actions on the editor
	 * action bar can resolve notebook scoped context keys (e.g. NOTEBOOK_KERNEL).
	 */
	override get scopedContextKeyService(): IContextKeyService | undefined {
		return this._notebookInstance?.scopedContextKeyService;
	}

	/**
	 * The editor control, used by other features to access the code editor widget of the selected cell.
	 */
	private _control: PositronNotebookEditorControl | undefined;

	constructor(
		readonly _group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IStorageService storageService: IStorageService,
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
	protected override computeEditorViewState(resource: URI): IPositronNotebookViewState | undefined {
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

	private _notebookInstance: PositronNotebookInstance | undefined;

	get notebookInstance() {
		return this._notebookInstance;
	}

	protected override setEditorVisible(visible: boolean): void {
		super.setEditorVisible(visible);

		if (visible) {
			this._notebookInstance?.onVisible();
		} else {
			this._notebookInstance?.onHide();
		}
	}

	protected override createEditor(parent: HTMLElement): void {
		this._logService.debug(this._identifier, 'createEditor');

		this._notebookInstance = this.instantiationService.createInstance(
			PositronNotebookInstance,
			// TODO: Make container an arg and remove attachView.
			// parent,
			this._identifier,
			'jupyter-notebook',
			undefined,
		);

		// Trigger the selection change event when the notebook is edited.
		this._register(this._notebookInstance.onDidChangeContent(() =>
			this._onDidChangeSelection.fire({
				reason: EditorPaneSelectionChangeReason.EDIT
			})
		));

		// This has to be done before we `await super.setInput` since that fires events
		// with listeners that call `this.getControl()` expecting an up-to-date control
		// i.e. with `activeCodeEditor` being the editor of the selected cell in the notebook.
		// TODO: Can we remove a separate editor control and use the notebook instance?
		this._control = new PositronNotebookEditorControl(this._notebookInstance);
	}

	override layout(
		dimension: DOM.Dimension,
		position?: DOM.IDomPosition | undefined
	): void {
		this._notebookInstance?.layout(dimension);
	}

	override async setInput(
		input: PositronNotebookEditorInput,
		options: IPositronNotebookEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
		noRetry?: boolean
	): Promise<void> {
		this._logService.debug(this._identifier, 'setInput');

		// We're setting the options on the input here so that the input can resolve the model
		// without having to pass the options to the resolve method.
		input.editorOptions = options;

		// Load saved view state (e.g. scroll position) from either:
		// - options.viewState: passed explicitly when the editor is moved between groups
		// - loadEditorViewState: loaded from persisted storage (e.g. after reload)
		const viewState = options?.viewState
			?? this.loadEditorViewState(input, context);

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
		this._notebookInstance?.setModel(model.notebook);

		this._notebookInstance?.restoreEditorViewState(viewState);
	}

	/**
	 * Called when this composite should receive keyboard focus.
	 */
	override focus(): void {
		super.focus();

		// Drive focus into the notebook instance based on selection state
		if (this.notebookInstance) {
			this.notebookInstance.focus();
		}
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
		return this._control;
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		this._logService.debug(this._identifier, 'dispose');

		this._notebookInstance?.dispose();

		// Call the base class's dispose method.
		super.dispose();
	}
}

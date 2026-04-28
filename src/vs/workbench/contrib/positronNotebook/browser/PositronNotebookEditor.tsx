/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { NotebookRenderCache } from './notebookRenderCache.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
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
import { INotebookEditorOptions } from '../../notebook/browser/notebookBrowser.js';
import { IPositronNotebookEditorOptions, IPositronNotebookViewState } from './positronNotebookEditorTypes.js';
import { NotebookInstanceProvider } from './NotebookInstanceProvider.js';
import { PositronNotebookComponent } from './PositronNotebookComponent.js';
import { EnvironentProvider } from './EnvironmentProvider.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { NotebookErrorBoundary } from './NotebookErrorBoundary.js';
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
import { PositronNotebookInstance } from './PositronNotebookInstance.js';


/**
 * Key for the memoized view state.
 */
const POSITRON_NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY =
	'PositronNotebookEditorViewState';

/** Maximum number of notebook renders cached per pane. */
const MAX_CACHED_RENDERS = 3;


export class PositronNotebookEditor extends AbstractEditorWithViewState<IPositronNotebookViewState> {
	/**
	 * Value to keep track of what instance of the editor this is.
	 * Used for keeping track of the editor in the logs.
	 */
	static count = 0;

	private _identifier = `Positron Notebook | Editor(${PositronNotebookEditor.count++}) |`;

	/**
	 * Top-level container for the entire notebook editor.
	 * Contains both the notebook content and contributions.
	 */
	private _editorContainer: HTMLElement | undefined;

	/**
	 * Stable "shell" element that hosts the currently-active per-entry notebook
	 * container. Created once in createEditor() and reused for the life of the
	 * pane. The actual React tree is rendered into a per-entry child container
	 * that is reparented in and out of this shell as the pane receives
	 * setInput/clearInput.
	 * Child of _editorContainer.
	 */
	private _notebookShell: HTMLElement | undefined;

	/**
	 * Overlay container for contributions (like find widget) to render into,
	 * allowing them to maintain their own separate React roots.
	 * Sibling to _notebookShell, child of _editorContainer.
	 * Inherits scoped context keys from _editorContainer.
	 * Hidden when switching notebooks to prevent stale widgets from showing.
	 */
	private _overlayContainer: HTMLElement | undefined;

	/**
	 * A disposable store for disposables attached to the editor instance.
	 */
	private readonly _instanceDisposableStore = this._register(
		new DisposableStore()
	);

	/**
	 * Active scroll restoration loop, if any. Set on cache-hit setInput
	 * (where the React tree is reused and useScrollRestoration's mount-time
	 * consume does not re-run). Auto-disposed when replaced by the next
	 * setInput, when clearInput parks the cached container off-DOM, or
	 * when the editor itself is disposed.
	 */
	private readonly _scrollRestoration = this._register(new MutableDisposable<IDisposable>());

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

		this._register(this._group.onDidCloseEditor(e => {
			if (!(e.editor instanceof PositronNotebookEditorInput)) {
				return;
			}
			this._renderCache.removeByUri(e.editor.resource);
		}));

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

		// Create the top-level editor container
		this._editorContainer = DOM.$('.positron-notebook-editor');
		parent.appendChild(this._editorContainer);

		// Create the stable shell that hosts the active per-entry notebook
		// container. The shell stays in the DOM for the life of the pane; the
		// per-entry container is reparented in and out of it. The per-entry
		// container itself is created lazily by _renderFreshForInput() on
		// cache miss, so we don't create one here.
		this._notebookShell = DOM.$('.positron-notebook-shell');
		this._editorContainer.appendChild(this._notebookShell);

		// Create the overlay container for widgets (find, etc)
		this._overlayContainer = DOM.$('.positron-notebook-overlay-container');
		this._editorContainer.appendChild(this._overlayContainer);

		// Create a scoped context key service rooted at the editor container so contributions inherit it.
		this._containerScopedContextKeyService = this._register(this.contextKeyService.createScoped(this._editorContainer));
	}

	override layout(
		dimension: DOM.Dimension,
		position?: DOM.IDomPosition | undefined
	): void {
		if (!this._editorContainer) {
			return;
		}
		DOM.size(this._editorContainer, dimension.width, dimension.height);

		this._size.set(dimension, undefined);
	}

	override async setInput(
		input: PositronNotebookEditorInput,
		options: IPositronNotebookEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
		noRetry?: boolean
	): Promise<void> {
		this._logService.debug(this._identifier, 'setInput');


		this._input = input;
		if (this._editorContainer === undefined) {
			throw new Error(
				'Editor container is undefined. This should have been created in createEditor.'
			);
		}

		// We're setting the options on the input here so that the input can resolve the model
		// without having to pass the options to the resolve method.
		input.editorOptions = options;

		// Load saved view state (e.g. scroll position) from either:
		// - options.viewState: passed explicitly when the editor is moved between groups
		// - loadEditorViewState: loaded from persisted storage (e.g. after reload)
		const viewState = options?.viewState
			?? this.loadEditorViewState(input, context);
		const { notebookInstance } = input;

		// Update the editor control given the notebook instance.
		// This has to be done before we `await super.setInput` since that fires events
		// with listeners that call `this.getControl()` expecting an up-to-date control
		// i.e. with `activeCodeEditor` being the editor of the selected cell in the notebook.
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
		notebookInstance.setModel(model.notebook);

		// Trigger the selection change event when the notebook was edited.
		this._instanceDisposableStore.add(
			model.notebook.onDidChangeContent(() =>
				this._onDidChangeSelection.fire({
					reason: EditorPaneSelectionChangeReason.EDIT
				})
			)
		);

		// Cache hit: reuse the existing renderer + container + live Monaco editors.
		// This is the fast path that skips all editor recreation.
		const cachedRender = this._renderCache.get(input.resource);
		if (cachedRender) {
			this._notebookShell!.appendChild(cachedRender.container);
			notebookInstance.attachView(
				cachedRender.container,
				this._containerScopedContextKeyService!,
				this._overlayContainer!,
				this._editorContainer,
			);
			notebookInstance.restoreEditorViewState(viewState);
			// Reattaching the cached container resets its scrollTop. The cached
			// React tree does not re-mount, so useScrollRestoration's mount-time
			// consume does not re-run -- drive restoration imperatively.
			this._scrollRestoration.value = notebookInstance.applyRestoredScrollPosition();
			return;
		}

		// Cache miss: render fresh. The cache evicts the least-recently-used
		// entry on add() if it is already at capacity.
		this._renderFreshForInput(input);
		notebookInstance.restoreEditorViewState(viewState);
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

		const notebookInstance = this._input?.notebookInstance;

		// Call super first so that AbstractEditorWithViewState can save the
		// editor view state (e.g. scroll position) while the input and the
		// DOM are still alive. The base class reads view state via
		// computeEditorViewState() which needs the notebook instance and
		// its cells container to still be accessible.
		super.clearInput();

		// Stop any in-flight scroll restoration before parking the container.
		// Otherwise the loop keeps running and writing scrollTop on a
		// detached element until it times out.
		this._scrollRestoration.clear();

		// Park all cached containers off-DOM. The React trees and Monaco editors
		// inside them stay alive; we only remove the containers from their parents
		// so the pane looks empty.
		for (const entry of this._renderCache.entries()) {
			entry.container.remove();
		}

		// Detach the notebook instance so contributions (e.g. the find
		// controller) still see the attach/detach lifecycle transitions they
		// rely on today.
		notebookInstance?.detachView();

		this._control.clear();
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
	 * The per-pane notebook render cache. Each evicted entry has its renderer
	 * disposed and container removed from the DOM. The shared
	 * PositronNotebookInstance is detached only when its container observable
	 * still points at the evicted entry's container -- this guards against
	 * cross-group moves where the target pane has already re-attached the
	 * shared instance to its own container before the source pane's eviction
	 * runs.
	 */
	private readonly _renderCache = new NotebookRenderCache(MAX_CACHED_RENDERS, entry => {
		entry.renderer.dispose();
		entry.container.remove();
		const instance = PositronNotebookInstance._instanceMap.get(entry.uri);
		if (instance && instance.isAttachedTo(entry.container)) {
			instance.detachView();
		}
	});

	/**
	 * Render the Positron notebook component tree into the given renderer.
	 * The renderer is owned by the cache entry; this helper only performs the
	 * React render call itself.
	 */
	private _renderNotebookInto(renderer: PositronReactRenderer): void {
		this._logService.debug(this._identifier, 'renderNotebook');

		if (!this.notebookInstance) {
			throw new Error('Notebook instance is not set.');
		}

		if (!this._editorContainer) {
			throw new Error('Editor container is not set.');
		}

		const scopedContextKeyService = this._containerScopedContextKeyService;
		if (!scopedContextKeyService) {
			throw new Error('Scoped context key service is not set.');
		}

		// Set the editor container for focus tracking.
		this.notebookInstance.setEditorContainer(this._editorContainer);

		renderer.render(
			<NotebookErrorBoundary
				componentName='PositronNotebookComponent'
				level='editor'
				logService={this._logService}
				onReload={() => {
					// Evict all cache entries and force the next setInput to
					// render fresh. Any state inside the React trees is gone by
					// definition when the user asked to reload.
					this._renderCache.clear();
					if (this._input) {
						this._renderFreshForInput(this._input);
					}
				}}
			>
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
			</NotebookErrorBoundary>
		);
	}

	/**
	 * Create a fresh cache entry (DOM container + renderer + React mount) for
	 * the given input, attach the shared notebook instance to the new
	 * container, and install the entry as the current cached render.
	 *
	 * Callers must have already disposed any existing cache entry.
	 */
	private _renderFreshForInput(input: PositronNotebookEditorInput): void {
		if (!this._notebookShell) {
			throw new Error('Notebook shell is not set.');
		}
		if (!this._containerScopedContextKeyService) {
			throw new Error('Scoped context key service is not set.');
		}
		if (!this._editorContainer) {
			throw new Error('Editor container is not set.');
		}
		if (!this._overlayContainer) {
			throw new Error('Overlay container is not set.');
		}

		const container = DOM.$('.positron-notebook-container');
		container.tabIndex = -1;
		this._notebookShell.appendChild(container);

		input.notebookInstance.attachView(
			container,
			this._containerScopedContextKeyService,
			this._overlayContainer,
			this._editorContainer,
		);

		const renderer = new PositronReactRenderer(container);
		this._renderCache.add({ uri: input.resource, container, renderer });
		this._renderNotebookInto(renderer);
	}


	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		this._logService.debug(this._identifier, 'dispose');

		this._renderCache.clear();

		// Call the base class's dispose method.
		super.dispose();
	}
}

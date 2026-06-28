/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IActiveNotebookEditorDelegate, IBaseCellEditorOptions, ICellViewModel, INotebookCellOverlayChangeAccessor, INotebookDeltaDecoration, INotebookEditorCreationOptions, INotebookEditorOptions, INotebookViewZoneChangeAccessor } from '../../notebook/browser/notebookBrowser.js';
import { NotebookLayoutInfo } from '../../notebook/browser/notebookViewEvents.js';
import { NotebookOptions } from '../../notebook/browser/notebookOptions.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { CellEditType, CellKind, ICellEditOperation, ISelectionState, SelectionStateType, ICellReplaceEdit, NotebookCellExecutionState, ICellDto2, diff } from '../../notebook/common/notebookCommon.js';
import { INotebookExecutionService } from '../../notebook/common/notebookExecutionService.js';
import { INotebookExecutionStateService } from '../../notebook/common/notebookExecutionStateService.js';
import { createNotebookCell } from './PositronNotebookCells/createNotebookCell.js';
import { BaseCellEditorOptions } from './BaseCellEditorOptions.js';
import * as DOM from '../../../../base/browser/dom.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType, getActiveCell, getEditingCell, getSelectedCells, SelectionState, SelectionStateMachine, toCellRanges } from '../../../contrib/positronNotebook/browser/selectionMachine.js';
import { NotebookContextKeyManager } from './NotebookContextKeyManager.js';
import { IPositronNotebookService } from './positronNotebookService.js';
import { EditorLayoutMetadata, IDeletionSentinel, IPositronNotebookInstance, IPositronNotebookResolvedScrollPosition, NotebookKernelStatus, NotebookOperationType } from './IPositronNotebookInstance.js';
import { POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY } from '../common/positronNotebookConfig.js';
import { getAssistantSettings } from '../common/notebookAssistantMetadata.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { SELECT_KERNEL_ID_POSITRON } from '../common/positronNotebookCommon.js';
import { INotebookKernelService } from '../../notebook/common/notebookKernelService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeService, RuntimeStartupPhase, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { isEqual } from '../../../../base/common/resources.js';
import { IPositronWebviewPreloadService } from '../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { autorunDelta, IObservable, observableValue, runOnChange } from '../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { cellToCellDto2 } from './cellClipboardUtils.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { isNotebookLanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSession.js';
import { RuntimeNotebookKernel } from '../../runtimeNotebookKernel/browser/runtimeNotebookKernel.js';
import { ICellRange } from '../../notebook/common/notebookRange.js';
import { IExtensionApiCellViewModel, IContextKeysNotebookViewCellsUpdateEvent, ContextKeysNotebookViewCellsSplice, IPositronCellViewModel, IPositronActiveNotebookEditor, IChatEditingNotebookViewModel, IChatEditingCellViewModel } from './IPositronNotebookEditor.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { PositronActionBarHoverManager } from '../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { IPositronNotebookContribution, PositronNotebookExtensionsRegistry } from './positronNotebookExtensions.js';
import { FontMeasurements } from '../../../../editor/browser/config/fontMeasurements.js';
import { PixelRatio } from '../../../../base/browser/pixelRatio.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { FontInfo } from '../../../../editor/common/config/fontInfo.js';
import { createBareFontInfoFromRawSettings } from '../../../../editor/common/config/fontInfoFromSettings.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IPositronNotebookViewState, IPositronNotebookScrollPosition } from './positronNotebookEditorTypes.js';
import { ISize } from '../../../../base/browser/positronReactRenderer.js';
import { PositronNotebookEditorRenderer } from './PositronNotebookEditorRenderer.js';
import { NotebookEditorContextKeys } from '../../notebook/browser/viewParts/notebookEditorWidgetContextKeys.js';
import { getWindow } from '../../../../base/browser/dom.js';
import { CellEditorPool } from './CellEditorPool.js';

interface IPositronNotebookInstanceRequiredTextModel extends IPositronNotebookInstance {
	textModel: NotebookTextModel;
}

function kernelStatusForStartupPhase(phase: RuntimeStartupPhase): NotebookKernelStatus {
	switch (phase) {
		case RuntimeStartupPhase.Initializing:
		case RuntimeStartupPhase.AwaitingTrust:
		case RuntimeStartupPhase.NewFolderTasks:
		case RuntimeStartupPhase.Reconnecting:
		case RuntimeStartupPhase.Starting:
		case RuntimeStartupPhase.LoadingCache:
			return NotebookKernelStatus.Discovering;
		case RuntimeStartupPhase.Discovering:
		case RuntimeStartupPhase.Complete:
			return NotebookKernelStatus.Unselected;
	}
}


/**
 * Implementation of IPositronNotebookInstance that handles the core notebook functionality
 * and state management. This class serves as the bridge between the UI and the underlying
 * notebook model.
 *
 * Key responsibilities:
 * - Manages notebook cell state and execution
 * - Handles kernel connectivity
 * - Coordinates selection and editing states
 * - Manages the lifecycle of the notebook view
 */
export class PositronNotebookInstance extends Disposable implements IPositronNotebookInstance {

	// =============================================================================================
	// #region Private Properties

	/**
	 * A set of disposables that are linked to a given model
	 * that need to be cleaned up when the model is changed.
	 */
	private readonly _modelStore = this._register(new DisposableStore());

	/**
	 * The scroll position resolved by the last call to `restoreEditorViewState`.
	 * Read by the React component on mount to restore the scroll position.
	 */
	private _restoredScrollPosition: IPositronNotebookResolvedScrollPosition | undefined;

	/**
	 * Observable of the size of the notebook editor container.
	 */
	public readonly size = observableValue<ISize>('size', { width: 0, height: 0 });

	/**
	 * Observable tracking if the editor is currently visible
	 */
	public readonly isVisible = observableValue<boolean>('isVisible', false);

	/**
	 * Bumped on every `restoreEditorViewState` call. The notebook React
	 * component subscribes to this so its scroll-restoration layout effect
	 * re-fires on cache-hit setInput, where the React tree is reused.
	 */
	private readonly _restoreScrollPositionRequest = observableValue<number>('restoreScrollPositionRequest', 0);
	readonly restoreScrollPositionRequest: IObservable<number> = this._restoreScrollPositionRequest;

	/**
	 * The DOM element that contains the cells for the notebook.
	 */
	private _cellsContainer: HTMLElement | undefined = undefined;

	/**
	 * Key-value map of language to base cell editor options for cells of that language.
	 */
	private _baseCellEditorOptions: Map<string | undefined, IBaseCellEditorOptions> = new Map();

	/**
	 * Cached font information for the notebook editor.
	 * Lazily generated on first access to getLayoutInfo().
	 */
	private _fontInfo: FontInfo | undefined;

	/**
	 * Model for the notebook contents.
	 */
	private readonly _textModel = observableValue<NotebookTextModel | undefined>('positronNotebookTextModel', undefined);

	/**
	 * Internal event emitter for when the editor's options change.
	 */
	private readonly _onDidChangeOptions = this._register(new Emitter<void>());

	// #region NotebookModel
	/**
	 * Model for the notebook contents. Note the difference between the NotebookTextModel and the
	 * NotebookViewModel.
	 */
	readonly onDidChangeModel = Event.fromObservable(this._textModel, this._store);

	/**
	 * Options for how the notebook should be displayed. Currently not really used but will be as
	 * notebook gets fleshed out.
	 */
	private _notebookOptions: NotebookOptions | undefined;

	/**
	 * Keep track of if this editor has been disposed.
	 */
	private _isDisposed: boolean = false;
	// #endregion

	get currentContainer(): HTMLElement | undefined {
		// TODO: Should this be the parentContainer or view container?
		return this._renderer.notebookContainer;
	}

	get overlayContainer(): HTMLElement {
		return this._renderer.overlayContainer;
	}

	getFocusedCell(): IPositronNotebookCell | null {
		if (!this.currentContainer) {
			return null;
		}

		const activeElement = this.currentContainer.ownerDocument.activeElement;
		if (!activeElement || !this.currentContainer.contains(activeElement)) {
			return null;
		}

		// Find which cell contains the focused element
		return this.cells.get().find(cell => cell.container?.contains(activeElement)) ?? null;
	}

	/**
	 * Event emitter for when the text model changes.
	 */
	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent = this._onDidChangeContent.event;

	/**
	 * Event emitter for when the cells container is scrolled
	 */
	private readonly _onDidScrollCellsContainer = this._register(new Emitter<void>());
	readonly onDidScrollCellsContainer = this._onDidScrollCellsContainer.event;

	/**
	 * Tracks the current operation type (paste, undo, redo, etc.) to provide
	 * context for automatic behaviors like entering edit mode on cell addition.
	 */
	private _currentOperation: NotebookOperationType | undefined = undefined;

	private readonly _contributions = this._register(new DisposableMap<string, IPositronNotebookContribution>());

	/**
	 * Observable list of deletion sentinels.
	 * Sentinels are shown where cells were deleted and provide an undo button.
	 */
	private readonly _deletionSentinels = observableValue<IDeletionSentinel[]>('deletionSentinels', []);
	readonly deletionSentinels = this._deletionSentinels;

	private readonly _renderer: PositronNotebookEditorRenderer;

	// =============================================================================================
	// #region Public Properties

	public readonly scopedContextKeyService: IScopedContextKeyService;
	public readonly scopedInstantiationService: IInstantiationService;

	/**
	 * The DOM element that contains the cells for the notebook.
	 */
	get cellsContainer(): HTMLElement | undefined {
		return this._cellsContainer;
	}

	/**
	 * Sets the DOM element that contains the cells for the notebook.
	 * @param container The container element to set, or null to clear
	 */
	setCellsContainer(container: HTMLElement | null): void {
		if (!container) {
			this._cellsContainer = undefined;
			return;
		}

		this._cellsContainer = container;
	}

	/**
	 * Returns the top of a cell relative to the cells container.
	 */
	getCellTop(cell: IPositronNotebookCell): number | undefined {
		const container = this._cellsContainer;
		if (!container || !cell.container) {
			return undefined;
		}
		const cellRect = cell.container.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		const distance = cellRect.top - containerRect.top;
		return distance + container.scrollTop;
	}

	/**
	 * Fire the scroll event for the cells container.
	 * Called by React when scroll or DOM mutations occur.
	 */
	fireScrollEvent(): void {
		this._onDidScrollCellsContainer.fire();
	}

	/**
	 * User facing cells wrapped in an observerable for the UI to react to changes
	 */
	cells;
	selectionStateMachine;
	contextManager: NotebookContextKeyManager;
	visibleRanges: ICellRange[] = [];
	hoverManager: PositronActionBarHoverManager;

	/**
	 * Status of kernel for the notebook.
	 */
	kernelStatus;

	/**
	 * The current selected notebook kernel.
	 */
	kernel = observableValue<RuntimeNotebookKernel | undefined>('positronNotebookInstanceKernel', undefined);

	runtimeSession;

	/**
	 * Language for the notebook.
	 */
	private _language;

	public readonly cellEditorPool: CellEditorPool;

	// #endregion

	// =============================================================================================

	// #region Getters and Setters

	/**
	 * Is the instance connected to an editor as indicated by having an associated container object?
	 */
	get connectedToEditor(): boolean {
		// TODO: This is always true now.
		//   It probably needs to check for a model or a specific view for that model
		//   (which doesn't yet exist)
		return Boolean(this.currentContainer);
	}

	/**
	 * Get the current `NotebookTextModel` for the editor.
	 */
	get textModel() {
		return this._textModel.get();
	}

	get isReadOnly(): boolean {
		return this._creationOptions?.isReadOnly ?? false;
	}

	/**
	 * Set the notebook's read-only state.
	 * Currently a no-op for Positron notebooks - readonly state is managed via creation options.
	 * @param _value - The read-only state to set (ignored).
	 */
	setReadOnly(_value: boolean): void {
		// No-op for Positron notebooks - readonly state managed differently
	}

	/**
	 * Find a cell view model by its handle.
	 * Returns undefined for Positron notebooks since they don't have cell view models.
	 * @param _handle - The handle of the cell to find (ignored).
	 * @returns Always undefined for Positron notebooks.
	 */
	getCellViewModelByHandle(_handle: number): ICellViewModel | undefined {
		return undefined;
	}

	/**
	 * Gets the notebook options for the editor.
	 * Exposes the private internal notebook options as a get only property.
	 */
	get notebookOptions() {

		if (this._notebookOptions) {
			return this._notebookOptions;
		}
		this._logService.debug(this.id, 'Generating new notebook options');

		this._notebookOptions = this._register(
			this.scopedInstantiationService.createInstance(NotebookOptions, DOM.getActiveWindow(), this.isReadOnly, undefined)
		);

		// Reset per-cell scrolling overrides when the global output scrolling setting
		// changes so all cells follow the new default.
		this._register(this._notebookOptions.onDidChangeOptions(e => {
			if (!e.outputScrolling) {
				return;
			}
			for (const cell of this.cells.get()) {
				if (!cell.isCodeCell()) {
					continue;
				}
				cell.resetOutputScrolling();
			}
		}));

		return this._notebookOptions;
	}

	get isDisposed(): boolean {
		return this._isDisposed;
	}

	// TODO: Not sure about having getters for these now-changing properties
	//   like language and uri.
	//   Either make methods, or rename like
	/**
	 * Gets the language for the notebook.
	 */
	get language(): string {
		return this._language.get();
	}

	get uri(): URI {
		if (!this.textModel) {
			throw new Error('PositronNotebookInstance.uri is not available, a model must be set with setModel()');
		}
		return this.textModel.uri;
	}

	// #endregion

	// =============================================================================================
	// #region Lifecycle


	/**
	 * @param id Unique identifier for the notebook instance. Currently just the notebook URI as a string.
	 * @param uri URI of the notebook resource.
	 * @param viewType The view type of the notebook.
	 * @param creationOptions Options for opening notebook.
	 */
	constructor(
		parentContainer: HTMLElement,
		public readonly id: string,
		public readonly viewType: string,
		private _creationOptions: INotebookEditorCreationOptions | undefined,
		@ICommandService private readonly _commandService: ICommandService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
		@INotebookExecutionStateService private readonly notebookExecutionStateService: INotebookExecutionStateService,
		@INotebookKernelService private readonly notebookKernelService: INotebookKernelService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
		@IPositronWebviewPreloadService private readonly _webviewPreloadService: IPositronWebviewPreloadService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();

		this._renderer = this._register(this._instantiationService.createInstance(PositronNotebookEditorRenderer));
		parentContainer.appendChild(this._renderer.container);

		// Set up focus tracking for the editor container
		const focusTracker = this._register(DOM.trackFocus(parentContainer));
		this._register(focusTracker.onDidFocus(() => {
			this._onDidFocusWidget.fire();
		}));

		// TODO: It'd be simpler if this could be scoped to the parentContainer.
		//   Would that break anything?
		this.scopedContextKeyService = this._register(this._contextKeyService.createScoped(this._renderer.container));
		this.scopedInstantiationService = this._instantiationService.createChild(
			new ServiceCollection([IContextKeyService, this.scopedContextKeyService]));

		this.cells = observableValue<IPositronNotebookCell[]>('positronNotebookCells', []);

		const { startupPhase } = this._languageRuntimeService;
		this.kernelStatus = observableValue<NotebookKernelStatus>('positronNotebookKernelStatus', kernelStatusForStartupPhase(startupPhase));
		this.runtimeSession = observableValue<ILanguageRuntimeSession | undefined>('positronNotebookRuntimeSession', undefined);

		if (this.kernelStatus.get() === NotebookKernelStatus.Discovering) {
			const d = this._register(new DisposableStore());
			// Watch for discovery to complete
			d.add(this._languageRuntimeService.onDidChangeRuntimeStartupPhase(startupPhase => {
				const kernelStatus = kernelStatusForStartupPhase(startupPhase);
				if (kernelStatus !== NotebookKernelStatus.Discovering) {
					d.dispose();
					this.kernelStatus.set(kernelStatus, undefined);
				}
			}));
			// Stop listening if we leave the preparing status from elsewhere
			// e.g. if a runtime session starts for the notebook
			d.add(runOnChange(this.kernelStatus, (kernelStatus) => {
				if (kernelStatus !== NotebookKernelStatus.Discovering) {
					d.dispose();
				}
			}));
		}

		// Invalidate font cache when editor configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor')) {
				this._fontInfo = undefined;
			}
		}));

		// Observe the current selected kernel from the notebook kernel service
		this._register(this.notebookKernelService.onDidChangeSelectedNotebooks(({ notebook }) => {
			if (this._isThisNotebook(notebook)) {
				this._refreshSelectedKernel();
			}
		}));

		// If a new kernel is selected for this notebook, attach its runtime
		this._register(runOnChange(this.kernel, (oldKernel, newKernel) => {
			if (newKernel && oldKernel) {
				this.kernelStatus.set(NotebookKernelStatus.Switching, undefined);
			}
		}));

		// Derive the notebook language from the runtime session
		this._language = this.kernel.map(
			kernel => /** @description positronNotebookLanguage */ kernel?.runtime?.languageId ?? 'plaintext'
		);

		// Attach any runtime sessions that start for the notebook
		this._register(this.runtimeSessionService.onWillStartSession(({ session }) => {
			this._maybeAttachSession(session);
		}));

		// Create the manager for Positron-specific notebook context keys
		// TODO: Do we still need this or do the NotebookEditorContextKeys
		//   work as replacements?...
		this.contextManager = this._register(
			this.scopedInstantiationService.createInstance(
				NotebookContextKeyManager, focusTracker,
			)
		);

		// Create the manager for VSCode notebook editor context keys
		// Extensions may depend on these familiar context keys
		this._register(this.scopedInstantiationService.createInstance(
			NotebookEditorContextKeys, this
		));

		// Create hover manager for notebook action button tooltips
		this.hoverManager = this._register(
			new PositronActionBarHoverManager(false, this.configurationService, this._hoverService)
		);

		this.selectionStateMachine = this._register(
			this.scopedInstantiationService.createInstance(SelectionStateMachine, this.cells)
		);

		this._register(runOnChange(this.selectionStateMachine.state, (_state) => {
			this._onDidChangeSelection.fire();
		}));

		this._webviewPreloadService.attachNotebookInstance(this);

		this._logService.debug(this.id, 'constructor');

		// Add listener for content changes to sync cells
		this._register(this.onDidChangeContent(() => {
			this._syncCells();
		}));

		this._register(autorunDelta(this.cells, ({ lastValue: oldCells, newValue: newCells }) => {
			if (!oldCells) {
				// Initial value, no event needed
				return;
			}

			// Compute the splice
			const splices = this._computeCellSplices(oldCells, newCells);

			// Fire the event if there are changes
			if (splices.length > 0) {
				this._onDidChangeViewCells.fire({ splices });
			}
		}));

		const contributions = PositronNotebookExtensionsRegistry.getNotebookContributions();
		for (const desc of contributions) {
			// TODO: Should this use the scoped instantiation service?
			const contribution = this._instantiationService.createInstance(desc.ctor, this);
			this._contributions.set(desc.id, contribution);
		}

		// TODO: Is there not a better way to do this?
		// Watch for exit-editor transitions to return focus to the focus trap
		let pendingFrame: number | undefined;
		this._register(toDisposable(() => {
			if (pendingFrame !== undefined) {
				getWindow(this.currentContainer).cancelAnimationFrame(pendingFrame);
			}
		}));
		const instance = this;
		this._register(autorunDelta(instance.selectionStateMachine.state, ({ lastValue, newValue }) => {
			if (lastValue === undefined) {
				// First run: no previous state to compare against, do nothing
				return;
			}
			// Check if we transitioned from editing to selecting a single cell
			if (!(lastValue.type === SelectionState.EditingSelection &&
				newValue.type === SelectionState.SingleSelection &&
				lastValue.active === newValue.active)) {
				return;
			}

			const cell = newValue.active;

			// TODO: This *should* no longer be possible given that instances are scoped to an editor pane?
			// Don't steal focus if the user navigated to a different editor pane
			// (e.g. clicking a cell in a side-by-side notebook).
			const activeEl = cell.container?.ownerDocument.activeElement;
			if (activeEl && !instance.currentContainer?.contains(activeEl)) {
				return;
			}

			const restoreCellFocus = () => {
				// Only focus the focus trap if the cell has outputs.
				// When there are no outputs, the focus trap has tabIndex=-1
				// (not in tab order), so focusing it would disrupt keyboard
				// navigation. In that case, focus the cell container instead.
				const currentOutputs = cell.outputs?.get() ?? [];
				const hasOutputs = currentOutputs.length > 0;
				if (hasOutputs) {
					cell.cellEditor?.focus();
				} else {
					cell.container?.focus();
				}
			};

			if (!activeEl) {
				// activeElement is transiently null during blur/focus
				// handoff. Defer to the next frame so the browser settles
				// on the actual target before we decide.
				const win = getWindow(cell.container);
				if (pendingFrame !== undefined) {
					win.cancelAnimationFrame(pendingFrame);
				}
				pendingFrame = win.requestAnimationFrame(() => {
					pendingFrame = undefined;
					// Re-check selection state: if the user moved to
					// another cell during the deferred frame, bail out.
					const currentState = instance.selectionStateMachine.state.get();
					if (currentState.type !== SelectionState.SingleSelection ||
						currentState.active !== cell) {
						return;
					}
					const resolved = cell.container?.ownerDocument.activeElement;
					if (resolved && !instance.currentContainer?.contains(resolved)) {
						return;
					}
					restoreCellFocus();
				});
				return;
			}

			restoreCellFocus();
		}));

		this.cellEditorPool = this._register(this.scopedInstantiationService.createInstance(
			CellEditorPool,
			this,
		));

		this._positronNotebookService.registerInstance(this);
	}

	//#region INotebookEditor
	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	private readonly _onDidChangeViewCells = this._register(new Emitter<IContextKeysNotebookViewCellsUpdateEvent>());
	private readonly _onDidChangeVisibleRanges = this._register(new Emitter<void>());
	private readonly _onDidFocusWidget = this._register(new Emitter<void>());

	/**
	 * Event fired when the cell selection changes.
	 */
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	/**
	 * Event fired when the visible range of cells changes.
	 */
	readonly onDidChangeVisibleRanges = this._onDidChangeVisibleRanges.event;

	/**
	 * Event fired when the notebook's view cells changes.
	 */
	readonly onDidChangeViewCells = this._onDidChangeViewCells.event;

	/**
	 * Gets the DOM node that contains the notebook editor.
	 * This is used for context key scoping and focus tracking.
	 * @returns The container HTMLElement for the notebook editor
	 * @throws Error if called before the notebook has been mounted to a DOM container
	 */
	getDomNode(): HTMLElement {
		if (!this.currentContainer) {
			throw new Error(`Requested notebook DOM node before it was mounted`);
		}
		return this.currentContainer;
	}

	/**
	 * Computes the output area dimensions for execution metadata.
	 */
	getOutputLayoutInfo(): EditorLayoutMetadata | undefined {
		if (!this.connectedToEditor || !this.currentContainer) {
			return undefined;
		}

		const domNode = this.currentContainer;
		const win = DOM.getWindow(domNode);
		const output_pixel_ratio = win.devicePixelRatio;

		// Best case: measure an existing outputs-inner element directly.
		// eslint-disable-next-line no-restricted-syntax
		const outputsInner = domNode.querySelector<HTMLElement>(
			'.positron-notebook-code-cell-outputs-inner'
		);
		if (outputsInner && outputsInner.clientWidth > 0) {
			const style = win.getComputedStyle(outputsInner);
			const paddingLeft = parseFloat(style.paddingLeft) || 0;
			const paddingRight = parseFloat(style.paddingRight) || 0;
			return {
				output_width_px: outputsInner.clientWidth - paddingLeft - paddingRight,
				output_pixel_ratio,
			};
		}

		// Fallback: compute from the cells container and intermediate
		// elements by reading their computed CSS offsets.
		const container = this.cellsContainer ?? domNode;
		if (container.clientWidth > 0) {
			const containerStyle = win.getComputedStyle(container);
			const containerPadding = (parseFloat(containerStyle.paddingLeft) || 0)
				+ (parseFloat(containerStyle.paddingRight) || 0);

			// eslint-disable-next-line no-restricted-syntax
			const cell = container.querySelector<HTMLElement>('.positron-notebook-cell');
			const cellMarginLeft = cell
				? parseFloat(win.getComputedStyle(cell).marginLeft) || 0
				: 0;

			// The outputs-inner padding is defined but may not have a
			// rendered element yet (first execution). Read from CSS if
			// an element exists; otherwise approximate from the
			// .positron-notebook-code-cell-outputs-inner rule (0.5rem
			// inline = 8px each side at default font size).
			// eslint-disable-next-line no-restricted-syntax
			const innerEl = container.querySelector<HTMLElement>(
				'.positron-notebook-code-cell-outputs-inner'
			);
			const outputPadding = innerEl
				? (parseFloat(win.getComputedStyle(innerEl).paddingLeft) || 0)
				+ (parseFloat(win.getComputedStyle(innerEl).paddingRight) || 0)
				: 16;

			const output_width_px = container.clientWidth
				- containerPadding - cellMarginLeft - outputPadding;
			if (output_width_px > 0) {
				return {
					output_width_px,
					output_pixel_ratio,
				};
			}
		}

		return undefined;
	}

	/**
	 * Event fired when the notebook editor widget or a cell editor within it gains focus.
	 */
	readonly onDidFocusWidget = this._onDidFocusWidget.event;

	hasModel(): this is IPositronActiveNotebookEditor {
		return this.textModel !== undefined;
	}

	/**
	 * Get view model for this notebook editor.
	 * Returns a minimal view model for extension API compatibility.
	 * Does not include viewCells since Positron notebooks manage cells differently.
	 */
	getViewModel(): IChatEditingNotebookViewModel {
		return {
			viewType: this.viewType,
		};
	}

	/**
	 * Get the currently active cell, if any.
	 * Positron notebooks don't have this concept, so always returns undefined.
	 */
	getActiveCell(): ICellViewModel | undefined {
		return undefined;
	}

	/**
	 * Get the currently selected cell view models.
	 * Positron notebooks don't have this concept, so always returns empty array.
	 */
	getSelectionViewModels(): ICellViewModel[] {
		return [];
	}

	/**
	 * Focus a notebook cell with the specified focus target.
	 * No-op for Positron notebooks.
	 */
	async focusNotebookCell(
		_cell: ICellViewModel,
		_focus: 'editor' | 'container' | 'output',
		_options?: { focusEditorLine?: number }
	): Promise<void> {
		// No-op for Positron notebooks
	}

	/**
	 * Reveal a range in the center of the cell editor.
	 * No-op for Positron notebooks.
	 */
	async revealRangeInCenterAsync(_cell: ICellViewModel, _range: Range): Promise<void> {
		// No-op for Positron notebooks
	}

	// ===== Decorator Compatibility Methods =====
	// These methods are needed by notebook decorators (NotebookDeletedCellDecorator,
	// NotebookInsertedCellDecorator, NotebookModifiedCellDecorator, OverlayToolbarDecorator).
	// For Positron notebooks, most return stub/no-op values since we have different UI architecture.
	// #region Decorator Compatibility

	/**
	 * Apply cell decorations to the notebook.
	 * For Positron notebooks, returns empty array (no-op).
	 * @param _oldDecorations - Decoration IDs to remove (unused)
	 * @param _newDecorations - New decorations to add (unused)
	 * @returns Empty array since Positron notebooks don't support cell decorations
	 */
	deltaCellDecorations(_oldDecorations: string[], _newDecorations: INotebookDeltaDecoration[]): string[] {
		// Positron notebooks don't support cell decorations the same way
		return [];
	}

	/**
	 * Get cells in a given range.
	 * For Positron notebooks, returns empty array (no ICellViewModel instances).
	 * @param _range - The cell range to query (unused)
	 * @returns Empty array since Positron doesn't have ICellViewModel instances
	 */
	getCellsInRange(_range?: ICellRange): ReadonlyArray<ICellViewModel> {
		// Positron notebooks don't have ICellViewModel instances
		return [];
	}

	/**
	 * Generates font information for the notebook editor.
	 * Uses the same approach as VS Code notebooks to get actual measured font metrics.
	 * Caches the result for subsequent calls.
	 * @returns The generated or cached font information
	 * @private
	 */
	private _generateFontInfo(): FontInfo {
		if (this._fontInfo) {
			return this._fontInfo;
		}

		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		const targetWindow = this.currentContainer ? DOM.getWindow(this.currentContainer) : DOM.getActiveWindow();
		this._fontInfo = FontMeasurements.readFontInfo(
			targetWindow,
			createBareFontInfoFromRawSettings(editorOptions, PixelRatio.getInstance(targetWindow).value)
		);
		return this._fontInfo;
	}

	/**
	 * Get layout information for the notebook editor.
	 * Returns actual layout dimensions and measured font information.
	 */
	getLayoutInfo(): NotebookLayoutInfo {
		return {
			width: this.currentContainer?.clientWidth ?? 0,
			height: this.currentContainer?.clientHeight ?? 0,
			scrollHeight: this._cellsContainer?.scrollHeight ?? 0,
			fontInfo: this._generateFontInfo(),
			stickyHeight: 0,
			listViewOffsetTop: 0,
		};
	}

	/**
	 * Get the height of a cell element.
	 * For Positron notebooks, returns 0 (stub).
	 * @param _cell - The cell view model (unused)
	 * @returns 0 as stub value
	 */
	getHeightOfElement(_cell: ICellViewModel): number {
		// Positron notebooks handle cell rendering differently
		return 0;
	}

	/**
	 * Get the absolute top position of a cell element.
	 * For Positron notebooks, returns 0 (stub).
	 * @param _cell - The cell view model (unused)
	 * @returns 0 as stub value
	 */
	getAbsoluteTopOfElement(_cell: ICellViewModel): number {
		// Positron notebooks handle cell rendering differently
		return 0;
	}

	/**
	 * Focus the notebook container element.
	 * For Positron notebooks, attempts to focus container if available.
	 * @param _clearSelection - Whether to clear selection (unused)
	 */
	focusContainer(_clearSelection?: boolean): void {
		// Try to focus the container if available
		this.currentContainer?.focus();
	}

	/**
	 * Reveal an offset position in the center of the viewport.
	 * For Positron notebooks, no-op.
	 * @param _offset - The offset to reveal (unused)
	 */
	revealOffsetInCenterIfOutsideViewport(_offset: number): void {
		// No-op for Positron notebooks
	}

	/**
	 * Set the focus range in the notebook.
	 * For Positron notebooks, no-op.
	 * @param _focus - The cell range to focus (unused)
	 */
	setFocus(_focus: ICellRange): void {
		// No-op for Positron notebooks - we handle focus differently
	}

	/**
	 * Modify view zones in the notebook.
	 * For Positron notebooks, no-op.
	 * @param _callback - Callback to modify view zones (unused)
	 */
	changeViewZones(_callback: (accessor: INotebookViewZoneChangeAccessor) => void): void {
		// No-op for Positron notebooks
	}

	/**
	 * Modify cell overlays in the notebook.
	 * For Positron notebooks, no-op.
	 * @param _callback - Callback to modify overlays (unused)
	 */
	changeCellOverlays(_callback: (accessor: INotebookCellOverlayChangeAccessor) => void): void {
		// No-op for Positron notebooks
	}

	// #endregion Decorator Compatibility

	setSelections(selections: ICellRange[]): void {
		// TODO: Implement this to be able to set selections via extension API vscode.NotebookEditor.selections
	}

	getLength(): number {
		return this.cells.get().length;
	}

	cellAt(index: number): IPositronCellViewModel | undefined {
		const cell = this.cells.get().at(index);
		if (cell) {
			return cell;
		}
		return undefined;
	}

	/**
	 * Reveals a range of cells in the viewport.
	 * @param range The cell range to reveal
	 */
	revealCellRangeInView(range: ICellRange): void {
		// For now, just reveal the first cell in the range
		if (range.start < this.cells.get().length) {
			const cellToReveal = this.cellAt(range.start);
			if (cellToReveal) {
				this._revealCell(cellToReveal);
			}
		}
	}

	/**
	 * Reveals a cell in the center only if it's outside the viewport.
	 * @param cell The cell to reveal
	 */
	async revealInCenterIfOutsideViewport(cell: IExtensionApiCellViewModel): Promise<void> {
		this._revealCell(cell);
	}

	/**
	 * Reveals a cell in the center of the viewport.
	 * @param cell The cell to reveal
	 */
	async revealInCenter(cell: IExtensionApiCellViewModel): Promise<void> {
		await this._revealCell(cell);
	}

	/**
	 * Reveals a cell at the top of the viewport.
	 * @param cell The cell to reveal
	 */
	async revealInViewAtTop(cell: IExtensionApiCellViewModel): Promise<void> {
		await this._revealCell(cell);
	}

	private _toPositronCell(cell: IExtensionApiCellViewModel): IPositronNotebookCell {
		for (const c of this.cells.get()) {
			if (c.handle === cell.handle) {
				return c;
			}
		}
		throw new Error(`Could not find cell to reveal, handle: ${cell.handle}`);
	}

	/**
	 * @param cell The cell to reveal
	 */
	private async _revealCell(cell: IExtensionApiCellViewModel): Promise<void> {
		await this._toPositronCell(cell).reveal({ reason: 'programmatic' });
	}
	//#endregion INotebookEditor

	override dispose() {
		this._isDisposed = true;

		this._logService.debug(this.id, 'dispose');

		this.cells.get().forEach(cell => cell.dispose());

		this._positronNotebookService.unregisterInstance(this);

		super.dispose();
	}

	// #endregion

	// =============================================================================================
	// #region Public Methods

	getId(): string {
		return this.id;
	}

	onVisible(): void {
		this.isVisible.set(true, undefined);
	}

	onHide(): void {
		this.isVisible.set(false, undefined);
	}

	layout(dimension: DOM.Dimension): void {
		this.size.set(dimension, undefined);
	}

	private _refreshSelectedKernel() {
		if (!this.textModel) {
			// No notebook model is set, unset the selected kernel.
			this.kernel.set(undefined, undefined);
			return;
		}
		const { selected } = this.notebookKernelService.getMatchingKernel({
			uri: this.textModel.uri,
			notebookType: this.textModel.viewType,
		});
		if (selected) {
			if (selected instanceof RuntimeNotebookKernel) {
				this.kernel.set(selected, undefined);
			} else {
				this._logService.warn(this.id, `Ignoring unknown kernel ${selected.id} for notebook ${this.textModel.uri}`);
			}
		} else {
			this.kernel.set(undefined, undefined);
		}
	}

	private _refreshRuntimeSession() {
		if (!this.textModel) {
			// No notebook model is set, unset the runtime session.
			this.runtimeSession.set(undefined, undefined);
			return;
		}
		const runtimeSession = this.runtimeSessionService.getNotebookSessionForNotebookUri(this.textModel.uri);
		if (runtimeSession) {
			this._maybeAttachSession(runtimeSession);
		} else {
			this.runtimeSession.set(undefined, undefined);
		}
	}

	/**
	 * Handle logic associated with the text model for notebook. This
	 * includes setting up listeners for changes to the model and
	 * setting up the initial state of the notebook.
	 */
	setModel(model: NotebookTextModel | undefined): void {
		if (this._textModel.get() === model) {
			// No change.
			return;
		}

		this._textModel.set(model, undefined);

		// Refresh the selected kernel given the new model,
		// *before* refreshing the runtime session since that
		// references the selected kernel.
		this._refreshSelectedKernel();

		// Refresh the runtime session given the new model.
		this._refreshRuntimeSession();

		this._modelStore.clear();

		if (model) {
			this._modelStore.add(model.onDidChangeContent((e) => {
				// Check if cells are in the same order by comparing references
				const newCells = model.cells;

				if (
					// If there are the same number of cells...
					newCells.length === this.cells.get().length &&
					// ... and they are in the same order...
					newCells.every((cell, i) => this.cells.get()[i].model === cell)
				) {
					// ... then we don't need to sync the cells.
					return;
				}

				// Fire content change event before syncing
				this._onDidChangeContent.fire();
			}));
		}

		this._onDidChangeContent.fire();

		// TODO: We currently differ from CodeEditorWidget in that we just rerender
		// but don't reconstruct a view. But I guess that *does* reconstruct
		// the view in React. React just does more of the work for us?
		// TODO: How do we *schedule* renders?... Does it matter?
		// TODO: Do we also want a viewModel?... What lives there?
		this._renderer.render(this);
	}

	// private _detachModel(): void {
	// 	if (this._textModel.get()) {
	// 		// TODO: Update renderer so that we create it per model...
	// 		//    And remove its dom node here...
	// 	}
	// }

	/**
	 * Sets editor options for the notebook or a specific cell.
	 * If cellOptions.resource is provided, applies options to that cell.
	 * Also handles isReadOnly option for decorator compatibility.
	 * @param options Editor options to set
	 */
	async setOptions(options: INotebookEditorOptions | undefined): Promise<void> {
		// Handle readonly state for decorator compatibility
		if (options?.isReadOnly !== undefined) {
			this.setReadOnly(options.isReadOnly);
		}

		// Apply cell options if provided
		const cellUri = options?.cellOptions?.resource;
		const cell = cellUri && this.cells.get().find(cell => isEqual(cell.uri, cellUri));
		if (cell) {
			await cell.setOptions(options);
		}
	}

	/**
	 * Runs the specified cells in the notebook.
	 * @param cells The cells to run
	 * @throws Error if no cells are provided
	 */
	async runCells(cells: IPositronNotebookCell[]): Promise<void> {
		await this._runCells(cells);
	}

	/**
	 * Runs all cells in the notebook.
	 */
	async runAllCells(): Promise<void> {
		await this._runCells(this.cells.get());
	}

	/**
	 * Adds a new cell to the notebook at the specified index.
	 * @param type The type of cell to add (`CellKind`)
	 * @param index The position where the cell should be inserted
	 * @param enterEditMode Whether to put the new cell into edit mode immediately
	 * @param content Optional content to set for the cell. Defaults to an empty string if not provided.
	 * @throws Error if no language is set for the notebook
	 */
	addCell(type: CellKind, index: number, enterEditMode: boolean, content: string = '', language?: string): void {
		this._assertTextModel();

		if (!this.language) {
			throw new Error(localize('noLanguage', "No language for notebook"));
		}

		if (enterEditMode) {
			// Set operation type to enable automatic edit mode entry for normal inserts
			this.setCurrentOperation(NotebookOperationType.InsertAndEdit);
		}

		const cellLanguage = language ?? (type === CellKind.Code ? this.language : 'markdown');

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';
		const synchronous = true;
		const endSelections: ISelectionState = { kind: SelectionStateType.Index, focus: { start: index, end: index + 1 }, selections: [{ start: index, end: index + 1 }] };
		const focusAfterInsertion = {
			start: index,
			end: index + 1
		};
		textModel.applyEdits([
			{
				editType: CellEditType.Replace,
				index,
				count: 0,
				cells: [
					{
						cellKind: type,
						language: cellLanguage,
						mime: undefined,
						outputs: [],
						metadata: undefined,
						source: content
					}
				]
			}
		],
			synchronous,
			{
				kind: SelectionStateType.Index,
				focus: focusAfterInsertion,
				selections: [focusAfterInsertion]
			},
			() => endSelections,
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();
	}

	private _insertCellAndFocusContainer(type: CellKind, aboveOrBelow: 'above' | 'below', referenceCell?: IPositronNotebookCell, language?: string): void {
		let index: number | undefined;

		this._assertTextModel();

		if (referenceCell) {
			const cellIndex = referenceCell.index;
			index = cellIndex >= 0 ? cellIndex : undefined;
		} else {
			index = getActiveCell(this.selectionStateMachine.state.get())?.index;
		}

		if (index === undefined) {
			return;
		}

		this.addCell(type, index + (aboveOrBelow === 'above' ? 0 : 1), false, '', language);
	}

	/**
	 * Inserts a new code cell above or below the reference cell (or selected cell if no reference is provided).
	 * @param aboveOrBelow Whether to insert the cell above or below the reference
	 * @param referenceCell Optional reference cell. If not provided, uses the currently selected cell
	 */
	insertCodeCellAndFocusContainer(aboveOrBelow: 'above' | 'below', referenceCell?: IPositronNotebookCell): void {
		this._insertCellAndFocusContainer(CellKind.Code, aboveOrBelow, referenceCell);
	}

	insertMarkdownCellAndFocusContainer(aboveOrBelow: 'above' | 'below', referenceCell?: IPositronNotebookCell): void {
		this._insertCellAndFocusContainer(CellKind.Markup, aboveOrBelow, referenceCell);
	}

	insertRawCellAndFocusContainer(aboveOrBelow: 'above' | 'below', referenceCell?: IPositronNotebookCell): void {
		this._insertCellAndFocusContainer(CellKind.Code, aboveOrBelow, referenceCell, 'raw');
	}

	/**
	 * Changes a cell to a different kind (code or markdown) and/or changes its language.
	 * The cell content is preserved, but outputs are cleared when converting to markdown.
	 * @param targetKind The target cell kind to convert to
	 * @param targetLanguage Optional target language. If not provided, uses notebook default for code cells or 'markdown' for markdown cells
	 * @param cellToConvert The cell to convert. If not provided, converts the currently active cell
	 */
	changeCellType(targetKind: CellKind, targetLanguage?: string, cellToConvert?: IPositronNotebookCell): void {
		const cell = cellToConvert ?? getActiveCell(this.selectionStateMachine.state.get());

		if (!cell) {
			return;
		}

		this._assertTextModel();

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';
		const cellIndex = cell.index;

		if (cellIndex < 0) {
			return;
		}

		// Get the underlying cell model to access all properties
		const cellModel = textModel.cells[cellIndex];
		if (cellModel === undefined) {
			return;
		}

		// Determine the target language
		const resolvedLanguage = targetLanguage ?? (targetKind === CellKind.Code ? this.language : 'markdown');

		// Check if we only need a language change (same cell kind)
		const needsKindChange = cell.kind !== targetKind;
		const needsLanguageChange = cellModel.language !== resolvedLanguage;

		if (!needsKindChange && !needsLanguageChange) {
			return; // Nothing to do
		}

		// Preserve selection at the same index
		const endSelections: ISelectionState = {
			kind: SelectionStateType.Index,
			focus: { start: cellIndex, end: cellIndex + 1 },
			selections: [{ start: cellIndex, end: cellIndex + 1 }]
		};

		if (needsKindChange) {
			// Replace the cell with a new cell of the target kind
			// Preserve content, metadata, and outputs (outputs survive round-trip conversions)
			textModel.applyEdits([
				{
					editType: CellEditType.Replace,
					index: cellIndex,
					count: 1,
					cells: [
						{
							cellKind: targetKind,
							language: resolvedLanguage,
							mime: undefined,
							outputs: cellModel.outputs,
							metadata: cellModel.metadata,
							source: cellModel.getValue()
						}
					]
				}
			],
				true,
				{
					kind: SelectionStateType.Index,
					focus: { start: cellIndex, end: cellIndex + 1 },
					selections: [{ start: cellIndex, end: cellIndex + 1 }]
				},
				() => endSelections,
				undefined,
				computeUndoRedo
			);
		} else {
			// Only language change needed
			textModel.applyEdits([
				{
					editType: CellEditType.CellLanguage,
					index: cellIndex,
					language: resolvedLanguage
				}
			], true, undefined, () => undefined, undefined, computeUndoRedo);
		}

		this._onDidChangeContent.fire();
	}

	/**
	 * Deletes a single cell from the notebook.
	 * @param cellToDelete The cell to delete. If not provided, deletes the currently active cell
	 */
	deleteCell(cellToDelete?: IPositronNotebookCell): void {
		const cell = cellToDelete ?? getActiveCell(this.selectionStateMachine.state.get());

		if (!cell) {
			return;
		}
		this.deleteCells([cell]);
	}

	/**
	 * Deletes multiple cells from the notebook.
	 * @param cells Array of cells to delete
	 */
	deleteCells(cells?: IPositronNotebookCell[]): void {
		const cellsToDelete = cells || getSelectedCells(this.selectionStateMachine.state.get());

		this._assertTextModel();

		if (cellsToDelete.length === 0) {
			return;
		}

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';

		// Get indices and sort in descending order to avoid index shifting
		const cellIndices = cellsToDelete
			.map(cell => cell.index)
			.filter(index => index >= 0)
			.sort((a, b) => b - a);

		if (cellIndices.length === 0) {
			return;
		}

		// Calculate where focus should go after deletion
		const lowestDeletedIndex = Math.min(...cellIndices);

		// Create delete edits for each cell
		const edits: ICellReplaceEdit[] = cellIndices.map(index => ({
			editType: CellEditType.Replace,
			index,
			count: 1,
			cells: []
		}));

		// Find the cell that will be at the position of the first (lowest index) deleted cell
		const nextCellAfterContainingSelection = textModel.cells[lowestDeletedIndex + cellIndices.length] ?? undefined;
		const focusRange = {
			start: lowestDeletedIndex,
			end: lowestDeletedIndex + 1
		};

		textModel.applyEdits(
			edits,
			true,
			{ kind: SelectionStateType.Index, focus: focusRange, selections: [focusRange] },
			() => {
				if (nextCellAfterContainingSelection !== undefined) {
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
			},
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();
	}

	/**
	 * Moves the selected cell(s) up by one position.
	 * Supports multi-cell selection - moves all selected cells as a group.
	 */
	moveCellsUp(): void {
		this._assertTextModel();

		const cellsToMove = getSelectedCells(this.selectionStateMachine.state.get());
		if (cellsToMove.length === 0) {
			return;
		}

		const firstIndex = Math.min(...cellsToMove.map(c => c.index));
		if (firstIndex <= 0) {
			return;
		}

		this.moveCells(cellsToMove, firstIndex - 1);

		// Reveal the active cell at its new position so the viewport follows the move
		const activeCell = getActiveCell(this.selectionStateMachine.state.get());
		activeCell?.reveal({ reason: 'keyboardNavigation', direction: 'up' });
	}

	/**
	 * Moves the selected cell(s) down by one position.
	 * Supports multi-cell selection - moves all selected cells as a group.
	 */
	moveCellsDown(): void {
		this._assertTextModel();

		const cellsToMove = getSelectedCells(this.selectionStateMachine.state.get());
		if (cellsToMove.length === 0) {
			return;
		}

		const allCells = this.cells.get();
		const lastIndex = Math.max(...cellsToMove.map(c => c.index));
		if (lastIndex >= allCells.length - 1) {
			return;
		}

		this.moveCells(cellsToMove, lastIndex + 2);

		// Reveal the active cell at its new position so the viewport follows the move
		const activeCell = getActiveCell(this.selectionStateMachine.state.get());
		activeCell?.reveal({ reason: 'keyboardNavigation', direction: 'down' });
	}

	/**
	 * General-purpose method to move cells to a specific index.
	 * Used by drag-and-drop operations.
	 * @param cells Array of cells to move
	 * @param targetIndex The index to move the cells to
	 */
	moveCells(cells: IPositronNotebookCell[], targetIndex: number): void {
		this._assertTextModel();

		const allCells = this.cells.get();

		// Validate inputs
		if (cells.length === 0 || targetIndex < 0 || targetIndex > allCells.length) {
			return;
		}

		// Get indices of cells to move (sorted, deduplicated)
		const indicesSet = new Set(cells.map(cell => allCells.indexOf(cell)));
		indicesSet.delete(-1);
		const indices = [...indicesSet].sort((a, b) => a - b);
		if (indices.length === 0) {
			return;
		}

		const firstIndex = indices[0];
		const lastIndex = indices[indices.length - 1];

		// Check if cells are contiguous
		const isContiguous = indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1);

		if (isContiguous) {
			// Check if move is necessary (no-op if already at target)
			if (firstIndex === targetIndex) {
				return;
			}
			const length = lastIndex - firstIndex + 1;
			// Adjust target index if moving down (account for removal of cells above target)
			const adjustedTarget = targetIndex > firstIndex ? targetIndex - length : targetIndex;
			this._applyCellMoveEdit(firstIndex, length, adjustedTarget);
			return;
		}

		// Non-contiguous selection: split into contiguous groups and move each
		// group individually. Each group uses a single Move edit that preserves
		// cell identity. Groups are processed in an order that avoids index
		// corruption: "before" groups (below the target) move bottom-to-top,
		// "after" groups (at/above the target) move top-to-bottom.
		const groups: number[][] = [];
		for (const idx of indices) {
			const lastGroup = groups[groups.length - 1];
			if (lastGroup && idx === lastGroup[lastGroup.length - 1] + 1) {
				lastGroup.push(idx);
			} else {
				groups.push([idx]);
			}
		}

		// Classify groups by their position relative to the target
		const groupsBefore: number[][] = [];
		const groupsAfter: number[][] = [];
		for (const group of groups) {
			if (group[group.length - 1] < targetIndex) {
				groupsBefore.push(group);
			} else {
				groupsAfter.push(group);
			}
		}

		// Move "before" groups down toward the target (process bottom-to-top
		// so earlier moves don't shift the indices of groups above them)
		let downTarget = targetIndex;
		for (let i = groupsBefore.length - 1; i >= 0; i--) {
			const group = groupsBefore[i];
			const firstCell = allCells[group[0]];
			const currentCells = this.cells.get();
			const fromIdx = currentCells.indexOf(firstCell);
			if (fromIdx === -1) { continue; }
			const length = group.length;
			const adjTarget = fromIdx < downTarget ? downTarget - length : downTarget;
			if (fromIdx !== adjTarget) {
				this._applyCellMoveEdit(fromIdx, length, adjTarget);
			}
			downTarget -= length;
		}

		// Move "after" groups up toward the target (process top-to-bottom
		// so earlier moves don't shift the indices of groups below them)
		let upTarget = targetIndex;
		for (const group of groupsAfter) {
			const firstCell = allCells[group[0]];
			const currentCells = this.cells.get();
			const fromIdx = currentCells.indexOf(firstCell);
			if (fromIdx === -1) { continue; }
			const length = group.length;
			const adjTarget = fromIdx < upTarget ? upTarget - length : upTarget;
			if (fromIdx !== adjTarget) {
				this._applyCellMoveEdit(fromIdx, length, adjTarget);
			}
			upTarget += length;
		}
	}

	/**
	 * Splits the currently editing cell at the cursor position(s).
	 * Supports multi-cursor: each cursor creates an additional split point.
	 */
	splitCell(): void {
		this._assertTextModel();

		const cell = getEditingCell(this.selectionStateMachine.state.get());
		if (!cell) {
			return;
		}

		const editor = cell.currentEditor;
		if (!editor) {
			return;
		}

		const editorModel = editor.getModel();
		if (!editorModel) {
			return;
		}

		const selections = editor.getSelections();
		if (!selections || selections.length === 0) {
			return;
		}

		// Use cursor start positions as split points
		const splitPoints: IPosition[] = selections.map(s => s.getStartPosition());
		const boundaries = this._splitPointsToBoundaries(splitPoints, editorModel);
		if (!boundaries || boundaries.length <= 1) {
			return;
		}

		// Extract text segments between boundary pairs
		const segments: string[] = [];
		for (let i = 1; i < boundaries.length; i++) {
			const start = boundaries[i - 1];
			const end = boundaries[i];
			const range = new Range(start.lineNumber, start.column, end.lineNumber, end.column);
			segments.push(editorModel.getValueInRange(range));
		}

		if (segments.length <= 1) {
			return;
		}

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';
		const cellIndex = cell.index;
		const cellModel = textModel.cells[cellIndex];
		if (cellModel === undefined) {
			return;
		}

		// Use a single Replace edit with all segments as the cells array.
		// This avoids edit-ordering issues: notebookTextModel.applyEdits sorts
		// multiple Replace edits by descending end index, which would interleave
		// split segments with following cells if we used separate insert edits.
		const splitCells = segments.map((source, i) => ({
			cellKind: cell.kind,
			language: cellModel.language,
			mime: cellModel.mime,
			outputs: i === 0 ? cellModel.outputs : [],
			metadata: i === 0 ? cellModel.metadata : undefined,
			internalMetadata: i === 0 ? cellModel.internalMetadata : undefined,
			collapseState: i === 0 ? cellModel.collapseState : undefined,
			source
		}));

		const focusIndex = cellIndex + 1;
		const focusRange = { start: focusIndex, end: focusIndex + 1 };
		const endSelections: ISelectionState = {
			kind: SelectionStateType.Index,
			focus: focusRange,
			selections: [focusRange]
		};

		textModel.applyEdits(
			[{
				editType: CellEditType.Replace,
				index: cellIndex,
				count: 1,
				cells: splitCells
			}],
			true,
			{
				kind: SelectionStateType.Index,
				focus: { start: cellIndex, end: cellIndex + 1 },
				selections: [{ start: cellIndex, end: cellIndex + 1 }]
			},
			() => endSelections,
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();
	}

	/**
	 * Joins all currently selected cells into a single cell.
	 * Uses the first cell's type for the merged result.
	 * When only one cell is selected, joins with the cell below (Jupyter behavior).
	 */
	joinSelectedCells(): void {
		this._assertTextModel();

		const selectedCells = getSelectedCells(this.selectionStateMachine.state.get());

		// With a single cell selected, merge with the cell below (Jupyter behavior)
		if (selectedCells.length <= 1) {
			this.joinCellBelow();
			return;
		}

		// Sort by index in document order
		const sortedCells = [...selectedCells].sort((a, b) => a.index - b.index);

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';

		// Merge content from all selected cells, using the first cell's EOL
		const firstCell = sortedCells[0];
		const firstCellModel = textModel.cells[firstCell.index];
		if (firstCellModel === undefined) {
			return;
		}
		const eol = firstCellModel.textBuffer.getEOL();
		const mergedContent = sortedCells.map(c => c.getContent()).join(eol);

		// Build edits in descending index order so deletions don't shift earlier indices
		const edits: ICellReplaceEdit[] = [];

		// Delete all selected cells except the first (descending order)
		for (let i = sortedCells.length - 1; i >= 1; i--) {
			edits.push({
				editType: CellEditType.Replace,
				index: sortedCells[i].index,
				count: 1,
				cells: []
			});
		}

		// Replace the first selected cell with the merged cell
		edits.push({
			editType: CellEditType.Replace,
			index: firstCell.index,
			count: 1,
			cells: [{
				cellKind: firstCell.kind,
				language: firstCellModel.language,
				mime: firstCellModel.mime,
				outputs: firstCellModel.outputs,
				metadata: firstCellModel.metadata,
				internalMetadata: firstCellModel.internalMetadata,
				collapseState: firstCellModel.collapseState,
				source: mergedContent
			}]
		});

		const focusRange = { start: firstCell.index, end: firstCell.index + 1 };
		const endSelections: ISelectionState = {
			kind: SelectionStateType.Index,
			focus: focusRange,
			selections: [focusRange]
		};

		textModel.applyEdits(
			edits,
			true,
			{
				kind: SelectionStateType.Index,
				focus: focusRange,
				selections: [focusRange]
			},
			() => endSelections,
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();
	}

	/**
	 * Joins the active cell with the cell above it.
	 * Both cells must be the same kind.
	 */
	joinCellAbove(): void {
		this._joinCellWithNeighbor('above');
	}

	/**
	 * Joins the active cell with the cell below it.
	 * Both cells must be the same kind.
	 */
	joinCellBelow(): void {
		this._joinCellWithNeighbor('below');
	}

	/**
	 * Joins the active cell with its neighbor in the given direction.
	 * The active cell's type is used for the merged result (Jupyter behavior).
	 * The merged cell is placed at the lower index position.
	 */
	private _joinCellWithNeighbor(direction: 'above' | 'below'): void {
		this._assertTextModel();

		const activeCell = getActiveCell(this.selectionStateMachine.state.get());
		if (!activeCell) {
			return;
		}

		const allCells = this.cells.get();
		const cellIndex = activeCell.index;

		if (direction === 'above' && cellIndex <= 0) {
			return;
		}
		if (direction === 'below' && cellIndex >= allCells.length - 1) {
			return;
		}

		const neighborIndex = direction === 'above' ? cellIndex - 1 : cellIndex + 1;

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';

		// The merged cell is placed at the lower index, but uses the active cell's type
		const keepIndex = Math.min(cellIndex, neighborIndex);
		const deleteIndex = Math.max(cellIndex, neighborIndex);
		const keepCell = allCells[keepIndex];
		const otherCell = allCells[deleteIndex];

		const activeCellModel = textModel.cells[cellIndex];
		const keepCellModel = textModel.cells[keepIndex];
		if (activeCellModel === undefined || keepCellModel === undefined) {
			return;
		}

		const eol = keepCellModel.textBuffer.getEOL();
		const mergedContent = keepCell.getContent() + eol + otherCell.getContent();

		const edits: ICellReplaceEdit[] = [
			// Delete the higher-index cell first
			{
				editType: CellEditType.Replace,
				index: deleteIndex,
				count: 1,
				cells: []
			},
			// Replace the kept cell with merged content, using active cell's type
			{
				editType: CellEditType.Replace,
				index: keepIndex,
				count: 1,
				cells: [{
					cellKind: activeCell.kind,
					language: activeCellModel.language,
					mime: activeCellModel.mime,
					outputs: activeCellModel.outputs,
					metadata: activeCellModel.metadata,
					internalMetadata: activeCellModel.internalMetadata,
					collapseState: activeCellModel.collapseState,
					source: mergedContent
				}]
			}
		];

		const focusRange = { start: keepIndex, end: keepIndex + 1 };
		const endSelections: ISelectionState = {
			kind: SelectionStateType.Index,
			focus: focusRange,
			selections: [focusRange]
		};

		textModel.applyEdits(
			edits,
			true,
			{
				kind: SelectionStateType.Index,
				focus: { start: cellIndex, end: cellIndex + 1 },
				selections: [{ start: cellIndex, end: cellIndex + 1 }]
			},
			() => endSelections,
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();
	}

	/**
	 * Shared helper for cell move operations (up, down, drag-and-drop).
	 * Applies a Move edit to the text model with undo/redo support and fires the content change event.
	 * Callers must call `_assertTextModel()` before invoking this method.
	 */
	private _applyCellMoveEdit(firstIndex: number, length: number, toIndex: number): void {
		const textModel = this.textModel!;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';
		const focusRange = { start: firstIndex, end: firstIndex + length };

		textModel.applyEdits([{
			editType: CellEditType.Move,
			index: firstIndex,
			length: length,
			newIdx: toIndex
		}],
			true,
			{
				kind: SelectionStateType.Index,
				focus: focusRange,
				selections: [focusRange]
			},
			() => ({
				kind: SelectionStateType.Index,
				focus: { start: toIndex, end: toIndex + length },
				selections: [{ start: toIndex, end: toIndex + length }]
			}),
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();
	}

	/**
	 * Converts an array of split points (cursor positions) and a text model
	 * into an array of boundary positions that define text segments.
	 * Adapted from upstream VS Code cellOperations.ts.
	 *
	 * @param splitPoints Array of cursor positions where the cell should be split
	 * @param textModel The text model of the cell being split
	 * @returns Array of boundary positions including document start and end, or undefined if invalid
	 */
	private _splitPointsToBoundaries(splitPoints: IPosition[], textModel: ITextModel): IPosition[] | undefined {
		// Sort by line then column
		const sorted = [...splitPoints].sort((a, b) => {
			if (a.lineNumber !== b.lineNumber) {
				return a.lineNumber - b.lineNumber;
			}
			return a.column - b.column;
		});

		// Normalize: if cursor is at end of a non-empty line, move to start of next line.
		// Skip empty lines (lineMaxColumn === 1) where column 1 is both start and end.
		const normalized: IPosition[] = sorted.map(p => {
			const lineMaxColumn = textModel.getLineMaxColumn(p.lineNumber);
			if (lineMaxColumn > 1 && p.column >= lineMaxColumn && p.lineNumber < textModel.getLineCount()) {
				return { lineNumber: p.lineNumber + 1, column: 1 };
			}
			return p;
		});

		// Deduplicate adjacent identical positions
		const deduped: IPosition[] = [normalized[0]];
		for (let i = 1; i < normalized.length; i++) {
			const prev = deduped[deduped.length - 1];
			const curr = normalized[i];
			if (prev.lineNumber !== curr.lineNumber || prev.column !== curr.column) {
				deduped.push(curr);
			}
		}

		// Wrap with document start and end as boundaries.
		// Do NOT deduplicate against doc start/end -- a split point at (1,1)
		// should produce an empty first segment, and a split at doc end should
		// produce an empty last segment.
		const docStart: IPosition = { lineNumber: 1, column: 1 };
		const docEnd: IPosition = {
			lineNumber: textModel.getLineCount(),
			column: textModel.getLineMaxColumn(textModel.getLineCount())
		};

		return [docStart, ...deduped, docEnd];
	}

	/**
	 * Checks if the notebook contains a specific code editor.
	 * @param editor The code editor to check for
	 * @returns True if the editor belongs to one of the notebook's cells, false otherwise
	 */
	hasCodeEditor(editor: ICodeEditor): boolean {
		for (const cell of this.cells.get()) {
			if (cell.currentEditor && cell.currentEditor === editor) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Returns an array of [cell view model, code editor] tuples for cells with attached editors.
	 * Used by chat editing integration to attach diff views to cell editors.
	 * @returns Array of tuples containing cell view model adapters and their Monaco editors
	 */
	get codeEditors(): [IChatEditingCellViewModel, ICodeEditor][] {
		return this.cells.get()
			.filter(cell => cell.currentEditor !== undefined)
			.map(cell => {
				const viewModel: IChatEditingCellViewModel = { handle: cell.handle };
				return [viewModel, cell.currentEditor!];
			});
	}

	/**
	 * Gets the base cell editor options for the given language.
	 * If they don't exist yet, they will be created.
	 * @param language The language to get the options for.
	 */
	getBaseCellEditorOptions(language?: string): IBaseCellEditorOptions {
		const existingOptions = this._baseCellEditorOptions.get(language);

		if (existingOptions) {
			return existingOptions;
		}

		const options = new BaseCellEditorOptions({
			onDidChangeModel: this.onDidChangeModel,
			hasModel: <() => this is IActiveNotebookEditorDelegate>(() => Boolean(this.textModel)),
			onDidChangeOptions: this._onDidChangeOptions.event,
			isReadOnly: this.isReadOnly,
		}, this.notebookOptions, this.configurationService, language);
		this._baseCellEditorOptions.set(language, options);
		return options;
	}

	getContribution<T extends IPositronNotebookContribution>(id: string): T | undefined {
		return this._contributions.get(id) as T;
	}

	/**
	 * Gets the current selected cells.
	 * @returns An array of cell ranges, where each range represents a group of consecutive selected cells.
	 */
	getSelections(): ICellRange[] {
		return toCellRanges(this.selectionStateMachine.state.get());
	}

	/**
	 * Returns the scroll position resolved by the last call to
	 * `restoreEditorViewState` and clears it so subsequent mounts (e.g. error
	 * boundary reloads) don't restore a stale position.
	 */
	consumeRestoredScrollPosition(): IPositronNotebookResolvedScrollPosition | undefined {
		const pos = this._restoredScrollPosition;
		this._restoredScrollPosition = undefined;
		return pos;
	}

	/**
	 * Restore editor view state such as scroll position.
	 */
	restoreEditorViewState(viewState: IPositronNotebookViewState | undefined): void {
		const cells = this.cells.get();
		const anchor = viewState?.scrollPosition;
		this._restoredScrollPosition = anchor && anchor.cellIndex < cells.length
			? { cell: cells[anchor.cellIndex], offsetFromCell: anchor.offsetFromCell }
			: undefined;
		this._restoreScrollPositionRequest.set(this._restoreScrollPositionRequest.get() + 1, undefined);
	}

	/**
	 * Synchronously snap scrollTop to the position last set by
	 * `restoreEditorViewState`, without consuming it. The editor calls this
	 * on the cache-hit reattach path so the user never sees a paint at
	 * scrollTop=0 between appendChild and the React layout effect that
	 * runs the rAF refinement loop.
	 */
	snapToRestoredScrollPosition(): void {
		const container = this._cellsContainer;
		if (!container) { return; }
		const scrollPosition = this._restoredScrollPosition;
		if (!scrollPosition) { return; }
		const cellTop = this.getCellTop(scrollPosition.cell);
		if (cellTop === undefined) { return; }
		container.scrollTop = cellTop + scrollPosition.offsetFromCell;
	}

	/**
	 * Gets the current state of the editor. This should
	 * fully determine the view we see.
	 */
	getEditorViewState(): IPositronNotebookViewState | undefined {
		if (!this._cellsContainer || !this._cellsContainer.isConnected) {
			return undefined;
		}

		return {
			scrollPosition: this._getScrollPosition(),
		};
	}

	/**
	 * Finds the first cell at least partially visible in the viewport and
	 * returns its index plus the pixel offset from its top to scrollTop.
	 */
	private _getScrollPosition(): IPositronNotebookScrollPosition | undefined {
		const container = this._cellsContainer;
		if (!container) {
			return undefined;
		}
		const scrollTop = container.scrollTop;
		const cells = this.cells.get();

		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];
			if (!cell.container) {
				continue;
			}
			const cellTop = this.getCellTop(cell);
			if (cellTop !== undefined && cellTop + cell.container.offsetHeight > scrollTop) {
				return {
					cellIndex: i,
					offsetFromCell: scrollTop - cellTop,
				};
			}
		}

		// Scrolled past all cells (e.g. into trailing add-cell controls).
		// Anchor to the last cell so the position is still persisted.
		for (let i = cells.length - 1; i >= 0; i--) {
			const cell = cells[i];
			if (!cell.container) {
				continue;
			}
			const cellTop = this.getCellTop(cell);
			if (cellTop !== undefined) {
				return {
					cellIndex: i,
					offsetFromCell: scrollTop - cellTop,
				};
			}
		}

		return undefined;
	}

	/** Whether this instance's view is currently attached to `container`. */
	isAttachedTo(container: HTMLElement): boolean {
		return this.currentContainer === container;
	}

	/**
	 * Closes the notebook instance and disposes of all resources.
	 */
	close(): void {
		this._logService.debug(this.id, 'Closing a notebook instance');
		this.dispose();
	}

	// #endregion

	/**
	 * Returns an array of NotebookViewCellsSplice tuples [start, deleteCount, insertedCells].
	 * @param oldCells The previous cell array
	 * @param newCells The new cell array
	 * @returns Array of splice operations
	 */
	private _computeCellSplices(oldCells: IPositronNotebookCell[], newCells: IPositronNotebookCell[]): ContextKeysNotebookViewCellsSplice[] {
		// Create a Set for quick contains checking
		const oldCellsSet = new Set(oldCells);

		// Use the diff algorithm to compute multiple splices for non-contiguous changes
		const splices = diff(
			oldCells,
			newCells,
			(cell) => oldCellsSet.has(cell),
			(a, b) => a === b
		);

		return splices.map(splice => [splice.start, splice.deleteCount, [...splice.toInsert]]);
	}

	private readonly _runtimeSessionDisposables = this._register(new MutableDisposable<DisposableStore>());

	private _maybeAttachSession(session: ILanguageRuntimeSession): void {
		if (!isNotebookLanguageRuntimeSession(session) ||
			!this._isThisNotebook(session.metadata.notebookUri)) {
			return;
		}

		// Ignore sessions that don't match the selected kernel's runtime
		// This shouldn't happen and probably indicates a bug
		const kernelRuntimeId = this.kernel.get()?.runtime.runtimeId;
		const sessionRuntimeId = session.runtimeMetadata.runtimeId;
		if (kernelRuntimeId !== session.runtimeMetadata.runtimeId) {
			this._logService.warn(this.id,
				`Unexpected session started for notebook ${this.uri.fsPath}. ` +
				`Expected runtime ${kernelRuntimeId}, found ${sessionRuntimeId}`);
			return;
		}

		this.kernelStatus.set(NotebookKernelStatus.Connected, undefined);
		this.runtimeSession.set(session, undefined);

		const disposables = this._runtimeSessionDisposables.value = new DisposableStore();

		// Clean up when the session ends
		this._register(session.onDidEndSession(() => {
			disposables.dispose();
			this.kernelStatus.set(NotebookKernelStatus.Exited, undefined);
			this.runtimeSession.set(undefined, undefined);
		}));

		// Listen for runtime state changes to manage session detach during kernel switching
		disposables.add(session.onDidChangeRuntimeState((runtimeState) => {
			const kernelStatus = this.kernelStatus.get();
			// Detach if we're switching kernels and the old session starts exiting
			// We'll update the kernel status when attaching to the new session
			if (kernelStatus === NotebookKernelStatus.Switching &&
				(runtimeState === RuntimeState.Exiting ||
					runtimeState === RuntimeState.Exited ||
					runtimeState === RuntimeState.Offline ||
					runtimeState === RuntimeState.Uninitialized)) {
				disposables.dispose();
			} else if (runtimeState === RuntimeState.Restarting) {
				// Detach when restart sequence starts; a new session will attach and
				// take over runtime-state reporting via the badge's hook.
				disposables.dispose();
			}
		}));
	}

	private _assertTextModel(): asserts this is IPositronNotebookInstanceRequiredTextModel {
		if (this.textModel === undefined) {
			throw new Error('No text model for notebook');
		}
	}

	/**
	 * Helper to determine if the given URI is the same as the notebook's associated with
	 * this instance.
	 * @param uri Uri to check against the notebook's uri
	 * @returns True if the uri is the same as the notebook's uri, false otherwise.
	 */
	private _isThisNotebook(uri: URI): boolean {
		if (this.textModel) {
			return isEqual(uri, this.textModel.uri);
		}
		return false;
	}

	/**
	 * Method to sync the editor cells with the current cells in the model.
	 */
	private _syncCells() {
		this._assertTextModel();
		const modelCells = this.textModel.cells;

		// Track if we're transitioning from empty to non-empty or vice versa
		const wasEmpty = this.cells.get().length === 0;
		const willBeEmpty = modelCells.length === 0;

		const cellModelToCellMap = new Map(
			this.cells.get().map(cell => [cell.model, cell])
		);

		const newlyAddedCells: IPositronNotebookCell[] = [];

		const cells = modelCells.map(cell => {
			const existingCell = cellModelToCellMap.get(cell);
			if (existingCell) {
				// Remove cell from map so we know it's been used.
				cellModelToCellMap.delete(cell);
				return existingCell;
			}
			const newCell = createNotebookCell(cell, this, this._instantiationService);
			newlyAddedCells.push(newCell);

			return newCell;
		});

		const currentOp = this.getAndResetCurrentOperation();

		// Check for sentinel cleanup when cells are added during undo
		if (currentOp === NotebookOperationType.Undo) {
			this._cleanupSentinelsForRestoredCells(newlyAddedCells);
		}

		// Skip auto-selection for assistant-added and assistant-edited cells - the follow mode will handle reveal behavior
		if (currentOp !== NotebookOperationType.AssistantAdd && currentOp !== NotebookOperationType.AssistantEdit && newlyAddedCells.length === 1) {
			const newCell = newlyAddedCells[0];
			const shouldAutoEdit = shouldAutoEditOnCellAdd(currentOp, newCell);

			// Defer to next tick to allow React to mount the cell component
			setTimeout(() => {
				if (shouldAutoEdit) {
					// Enter edit mode (which also selects the cell)
					this.selectionStateMachine.enterEditor(newCell);
				} else {
					// Just select the cell without entering edit mode
					this.selectionStateMachine.selectCell(newCell, CellSelectionType.Normal);
				}
			}, 0);
		}

		// Dispose of any cells that were not reused.
		cellModelToCellMap.forEach(cell => cell.dispose());

		this.cells.set(cells, undefined);

		// Check if we need to focus the notebook parent container.
		// This happens when there are no cells left in the notebook
		// after an operation.
		if (!wasEmpty && willBeEmpty && this.currentContainer) {
			this.currentContainer.focus();
		}
	}

	/**
	 * Cleans up sentinels for cells that have been restored via undo.
	 * Matches by comparing cell content since handles change on restoration.
	 */
	private _cleanupSentinelsForRestoredCells(restoredCells: IPositronNotebookCell[]): void {
		if (restoredCells.length === 0) {
			return;
		}

		const sentinels = this._deletionSentinels.get();
		if (sentinels.length === 0) {
			return;
		}

		// Build a set of restored cell contents for quick lookup
		const restoredContents = new Set(restoredCells.map(cell => cell.getContent()));

		// Remove sentinels whose cell content matches a restored cell
		const remainingSentinels = sentinels.filter(sentinel => {
			return !restoredContents.has(sentinel.cellData.source);
		});

		if (remainingSentinels.length < sentinels.length) {
			this._deletionSentinels.set(remainingSentinels, undefined);
		}
	}

	/**
	 * Internal method to run cells, used by other cell running methods.
	 * @param cells Cells to run
	 * @returns
	 */
	private async _runCells(cells: IPositronNotebookCell[]): Promise<void> {
		this._logService.debug(this.id, '_runCells');

		this._assertTextModel();

		if (!this.kernel.get()) {
			// Make sure we have a kernel to run the cells.
			this._logService.debug(this.id, 'No kernel connected, attempting to connect');
			// Attempt to connect to the kernel
			await this._commandService.executeCommand(SELECT_KERNEL_ID_POSITRON);
		}

		const hasExecutions = [...cells].some(cell => Boolean(this.notebookExecutionStateService.getCellExecution(cell.uri)));

		if (hasExecutions) {
			await this.notebookExecutionService.cancelNotebookCells(this.textModel, Array.from(cells).map(c => c.model as NotebookCellTextModel));
			return;
		}

		await this.notebookExecutionService.executeNotebookCells(this.textModel, Array.from(cells).map(c => c.model as NotebookCellTextModel), this._contextKeyService);
	}


	/**
	 * Clears the output of a specific cell in the notebook.
	 * @param cell The cell to clear outputs from. If not provided, uses the currently active cell.
	 * @param skipContentEvent If true, won't fire the content change event (useful for batch operations)
	 */
	clearCellOutput(cell?: IPositronNotebookCell, skipContentEvent: boolean = false): void {
		this._assertTextModel();

		const targetCell = cell ?? getActiveCell(this.selectionStateMachine.state.get());
		if (!targetCell) {
			return;
		}

		const cellIndex = targetCell.index;
		if (cellIndex === -1) {
			return;
		}

		const computeUndoRedo = !this.isReadOnly;
		this.textModel.applyEdits([{
			editType: CellEditType.Output,
			index: cellIndex,
			outputs: [],
			append: false
		}], true, undefined, () => undefined, undefined, computeUndoRedo);

		if (!skipContentEvent) {
			this._onDidChangeContent.fire();
		}
	}

	/**
	 * Show a notebook console for this instance.
	 */
	showNotebookConsole(): void {
		this._positronConsoleService.showNotebookConsole(this.uri, true);
	}

	/**
	 * Focuses this notebook based on the current selection state.
	 * Called when the notebook editor receives focus from the workbench.
	 *
	 * Note: This method may be called twice during tab switches:
	 * - First call: Early, cells may not be rendered yet (no-op via optional chaining)
	 * - Second call: After render completes, focus succeeds
	 */
	focus(): void {
		const state = this.selectionStateMachine.state.get();

		switch (state.type) {
			case SelectionState.EditingSelection:
				// Focus the editor - enterEditor() already has idempotency checks
				this.selectionStateMachine.enterEditor(state.active);
				break;

			case SelectionState.SingleSelection:
			case SelectionState.MultiSelection: {
				// Focus the first selected cell's container
				// Optional chaining handles undefined containers gracefully
				const cell = state.type === SelectionState.SingleSelection
					? state.active
					: state.selected[0];
				cell.container?.focus({ preventScroll: true });
				break;
			}

			case SelectionState.NoCells:
				// Fall back to notebook container
				this.currentContainer?.focus({ preventScroll: true });
				break;
		}
	}

	/**
	 * Clears the outputs of all cells in the notebook.
	 */
	clearAllCellOutputs(): void {
		this._assertTextModel();
		const allIndices = this.cells.get().map((_, i) => i);
		if (allIndices.length === 0) {
			// Preserve legacy behavior: always fire content-change even on empty notebooks
			this._onDidChangeContent.fire();
			return;
		}
		this.clearCellOutputsByIndex(allIndices);
	}

	/**
	 * Clears outputs from specific cells in the notebook by index.
	 * @param cellIndices Array of cell indices whose outputs should be cleared.
	 */
	clearCellOutputsByIndex(cellIndices: number[]): void {
		this._assertTextModel();

		if (cellIndices.length === 0) {
			return;
		}

		try {
			const computeUndoRedo = !this.isReadOnly;
			const cells = this.cells.get();

			// Clear outputs from specified cells
			for (const idx of cellIndices) {
				this.clearCellOutput(cells[idx], true);
			}

			// Clear execution metadata for non-executing cells at specified indices
			const clearExecutionMetadataEdits: ICellEditOperation[] = [];
			for (const idx of cellIndices) {
				const cellModel = this.textModel.cells[idx];
				const runState = this.notebookExecutionStateService.getCellExecution(cellModel.uri)?.state;
				if (runState !== NotebookCellExecutionState.Executing) {
					clearExecutionMetadataEdits.push({
						editType: CellEditType.PartialInternalMetadata,
						index: idx,
						internalMetadata: {
							runStartTime: null,
							runStartTimeAdjustment: null,
							runEndTime: null,
							executionOrder: null,
							lastRunSuccess: null
						}
					});
				}
			}

			if (clearExecutionMetadataEdits.length) {
				this.textModel.applyEdits(clearExecutionMetadataEdits, true, undefined, () => undefined, undefined, computeUndoRedo);
			}

		} finally {
			// Fire a single content change event
			this._onDidChangeContent.fire();
		}
	}


	// #endregion

	// =============================================================================================
	// #region Clipboard Methods

	/**
	 * Copies the specified cells to the clipboard.
	 * @param cells The cells to copy. If not provided, copies the currently selected cells
	 */
	copyCells(cells?: IPositronNotebookCell[]): void {
		const cellsToCopy = cells || getSelectedCells(this.selectionStateMachine.state.get());

		if (cellsToCopy.length === 0) {
			return;
		}

		const clipboardCells: ICellDto2[] = [];
		let clipboardText = '';
		cellsToCopy.forEach(cell => {
			clipboardCells.push(cellToCellDto2(cell));
			clipboardText += cell.getContent() + '\n\n';
		});

		// Store in shared notebook service clipboard for within-window paste (same or different notebook)
		this._positronNotebookService.setClipboardCells(clipboardCells);

		// Remove trailing newlines from clipboard text
		clipboardText = clipboardText.trimEnd();
		// Write cell contents to system clipboard for pasting into other editors (including cell editors)
		this._clipboardService.writeText(clipboardText);

		// Log for debugging
		this._logService.debug(`Copied ${cellsToCopy.length} cells to clipboard`);
	}

	/**
	 * Cuts the specified cells to the clipboard (copies then deletes them).
	 * @param cells The cells to cut. If not provided, cuts the currently selected cells
	 */
	cutCells(cells?: IPositronNotebookCell[]): void {
		const cellsToCut = cells || getSelectedCells(this.selectionStateMachine.state.get());

		if (cellsToCut.length === 0) {
			return;
		}

		// Copy cells first
		this.copyCells(cellsToCut);

		// Delete the cells (this handles selection and focus automatically)
		this.deleteCells(cellsToCut);
	}

	/**
	 * Pastes cells from the clipboard at the specified index.
	 * @param index The position to paste cells at. If not provided, pastes after active cell or at end of notebook.
	 */
	pasteCells(index?: number): void {
		if (!this.canPaste()) {
			return;
		}

		// Set operation type to prevent automatic edit mode entry
		this.setCurrentOperation(NotebookOperationType.Paste);

		try {
			this._assertTextModel();

			// Get cells from shared notebook service clipboard
			const cellsToPaste = this._positronNotebookService.getClipboardCells();

			const textModel = this.textModel;
			const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';
			const pasteIndex = index ?? this.getInsertionIndex();
			const cellCount = cellsToPaste.length;

			// Use textModel.applyEdits to properly create and register cells
			const synchronous = true;
			const endSelections: ISelectionState = {
				kind: SelectionStateType.Index,
				focus: { start: pasteIndex, end: pasteIndex + cellCount },
				selections: [{ start: pasteIndex, end: pasteIndex + cellCount }]
			};
			const focusAfterInsertion = {
				start: pasteIndex,
				end: pasteIndex + cellCount
			};

			textModel.applyEdits([
				{
					editType: CellEditType.Replace,
					index: pasteIndex,
					count: 0,
					cells: cellsToPaste
				}
			],
				synchronous,
				{
					kind: SelectionStateType.Index,
					focus: focusAfterInsertion,
					selections: [focusAfterInsertion]
				},
				() => endSelections, undefined, computeUndoRedo
			);

			this._onDidChangeContent.fire();
			// If successful, _syncCells() will have cleared the flag
		} catch (error) {
			// Clear flag on exception since _syncCells() won't run
			this.clearCurrentOperation();
			throw error;
		}
	}

	/**
	 * Pastes cells from the clipboard above the active cell.
	 */
	pasteCellsAbove(): void {
		const activeCell = getActiveCell(this.selectionStateMachine.state.get());
		if (activeCell) {
			this.pasteCells(activeCell.index);
		} else {
			this.pasteCells(0);
		}
	}

	/**
	 * Checks if there are cells available to paste from the clipboard.
	 * @returns True if cells can be pasted, false otherwise
	 */
	canPaste(): boolean {
		return this._positronNotebookService.hasClipboardCells();
	}

	/**
	 * Gets the current notebook operation type that is in progress, if any.
	 * @returns The current operation type, or undefined if no operation is in progress
	 */
	getAndResetCurrentOperation(): NotebookOperationType | undefined {
		const currentOp = this._currentOperation;
		this.clearCurrentOperation();
		return currentOp;
	}

	/**
	 * Sets the current notebook operation type.
	 * @param type The operation type to set
	 */
	setCurrentOperation(type: NotebookOperationType): void {
		this._currentOperation = type;
	}

	/**
	 * Clears the current notebook operation type.
	 */
	clearCurrentOperation(): void {
		this._currentOperation = undefined;
	}

	// Helper method to get insertion index
	private getInsertionIndex(): number {
		// Use the active cell position for determining insertion, or at the end if no active cell
		const activeCell = getActiveCell(this.selectionStateMachine.state.get());
		if (activeCell) {
			return activeCell.index + 1;
		}
		return this.cells.get().length;
	}

	async handleAssistantCellModification(cellIndex: number, operationType?: 'add' | 'delete' | 'modify', maxWaitMs?: number): Promise<void> {
		const cells = this.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			return;
		}

		const cell = cells[cellIndex];
		if (cell === undefined) {
			return;
		}

		// Check if cell is visible in viewport
		const isVisible = cell.isInViewport();

		if (isVisible) {
			// Cell is visible - always highlight regardless of auto-follow
			if (!(await cell.highlightTemporarily(operationType, maxWaitMs))) {
				this._logService.debug('[PositronNotebookInstance] handleAssistantModification: cell.highlightTemporarily() returned false');
			}
			return;
		}

		// Cell is not visible - check auto-follow setting for scrolling behavior
		// Notebook metadata takes precedence over global configuration
		const settings = getAssistantSettings(this.textModel?.metadata);
		const autoFollow = settings.autoFollow !== undefined
			? settings.autoFollow === 'autoFollow'
			: (this.configurationService.getValue<boolean>(POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY) ?? true);

		if (autoFollow) {
			// Reveal (scroll to) and highlight
			if (!(await cell.reveal({ reason: 'programmatic' }))) {
				this._logService.debug('[PositronNotebookInstance] handleAssistantModification: cell.reveal() returned false');
			}
			if (!(await cell.highlightTemporarily(operationType, maxWaitMs))) {
				this._logService.debug('[PositronNotebookInstance] handleAssistantModification: cell.highlightTemporarily() returned false');
			}
		}
		// If auto-follow is off and cell is not visible, no visual feedback
	}

	/**
	 * Add a deletion sentinel at the specified cell index.
	 * @param cellIndex The index where the cell was deleted (in the current notebook state)
	 * @param cellData The complete cell data for potential restoration
	 */
	addDeletionSentinel(cellIndex: number, cellData: ICellDto2): void {
		// Calculate the true original index by accounting for previously deleted cells.
		// When multiple cells are deleted sequentially, each deletion shifts indices down.
		// We need to track where this cell was in the ORIGINAL notebook, not where it
		// was at the moment of deletion.
		//
		// Example: Delete cells 2, then 3 (originally):
		//   - Delete at index 2: no prior sentinels, originalIndex = 2
		//   - Delete at index 2 (was cell 3): one sentinel at orig<=2, originalIndex = 2+1 = 3
		const existingSentinels = this._deletionSentinels.get();
		const priorDeletionsAtOrBefore = existingSentinels.filter(s => s.originalIndex <= cellIndex).length;
		const trueOriginalIndex = cellIndex + priorDeletionsAtOrBefore;

		// Generate preview content (first 3 lines)
		const lines = cellData.source.split('\n');
		const previewContent = lines.slice(0, 3).join('\n');
		const truncated = lines.length > 3;

		const sentinel: IDeletionSentinel = {
			id: `sentinel-${Date.now()}-${trueOriginalIndex}`,
			originalIndex: trueOriginalIndex,
			timestamp: Date.now(),
			previewContent: truncated ? previewContent + '\n...' : previewContent,
			cellKind: cellData.cellKind,
			language: cellData.language,
			cellData  // Store complete data for restoration
		};

		const current = this._deletionSentinels.get();
		this._deletionSentinels.set([...current, sentinel], undefined);
	}

	/**
	 * Restores a deleted cell from its sentinel data.
	 * @param sentinel The deletion sentinel containing cell data to restore
	 */
	restoreCell(sentinel: IDeletionSentinel): void {
		this._assertTextModel();

		const textModel = this.textModel;
		const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';

		// Calculate the correct insertion index.
		// Since originalIndex represents the cell's position in the ORIGINAL notebook,
		// we need to subtract the count of still-deleted cells that were originally
		// before this cell. This accounts for cells that haven't been restored yet.
		//
		// Example: Original [0,1,2,3,4], deleted cells 2 and 3 (sentinels with orig=2,3)
		//   - Current notebook: [0,1,4]
		//   - Restore cell with orig=3: sentinels with orig<3 = 1, so insertIndex = 3-1 = 2
		//   - Result: [0,1,3,4] ✓
		const otherSentinels = this._deletionSentinels.get().filter(s => s.id !== sentinel.id);
		const deletedCellsBeforeThis = otherSentinels.filter(s => s.originalIndex < sentinel.originalIndex).length;
		const calculatedIndex = sentinel.originalIndex - deletedCellsBeforeThis;

		// Clamp to valid range (handles case where notebook was modified by user)
		const maxIndex = textModel.cells.length;
		const insertIndex = Math.min(calculatedIndex, maxIndex);

		const focusRange = { start: insertIndex, end: insertIndex + 1 };

		textModel.applyEdits([
			{
				editType: CellEditType.Replace,
				index: insertIndex,
				count: 0,
				cells: [sentinel.cellData]
			}
		],
			true, // synchronous - ensures operations are serialized
			{ kind: SelectionStateType.Index, focus: focusRange, selections: [focusRange] },
			() => ({ kind: SelectionStateType.Index, focus: focusRange, selections: [focusRange] }),
			undefined,
			computeUndoRedo
		);

		this._onDidChangeContent.fire();

		// Remove the restored sentinel (no need to adjust other indices since
		// originalIndex represents the true original position, not current position)
		this._deletionSentinels.set(otherSentinels, undefined);
	}

	/**
	 * Remove a deletion sentinel by its ID.
	 * @param id The unique identifier of the sentinel to remove
	 */
	removeDeletionSentinel(id: string): void {
		const current = this._deletionSentinels.get();
		this._deletionSentinels.set(current.filter(s => s.id !== id), undefined);
	}

	// #endregion
}

/**
 * Determines whether a newly added cell should automatically enter edit mode.
 *
 * Generally returns `true` for normal cell insertions, but skips auto-edit
 * for certain operations (like paste/undo) and markdown cells with content
 * (to display rendered output instead).
 *
 * @param currentOp The current notebook operation type, or undefined if no operation is set.
 * @param cell The newly added cell to check.
 * @returns `true` if the cell should automatically enter edit mode, `false` otherwise.
 */
function shouldAutoEditOnCellAdd(currentOp: NotebookOperationType | undefined, cell: IPositronNotebookCell): boolean {
	// Don't auto-enter edit mode for paste, undo, or redo operations
	if (currentOp !== NotebookOperationType.InsertAndEdit) {
		return false;
	}

	// For markdown cells with content, don't auto-enter edit mode
	// so the rendered markdown is displayed instead of the raw editor.
	// This is important for cells added by Assistant which come pre-populated.
	if (cell.isMarkdownCell() && cell.getContent().trim().length > 0) {
		return false;
	}

	return true;
}

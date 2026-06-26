/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, autorunDelta, derived, IObservable } from '../../../../../base/common/observable.js';
import { localize } from '../../../../../nls.js';
import { IEditorContributionDescription, EditorExtensionsRegistry } from '../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorConstructionOptions } from '../../../../../editor/browser/config/editorConfiguration.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_REPLACE_INPUT_FOCUSED } from '../../../../../editor/contrib/find/browser/findModel.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IEditorProgressService } from '../../../../../platform/progress/common/progress.js';
import { FloatingEditorClickMenu } from '../../../../browser/codeeditor.js';
import { InQuickPickContextKey } from '../../../../browser/quickaccess.js';
import { CTX_INLINE_CHAT_FOCUSED } from '../../../../contrib/inlineChat/common/inlineChat.js';
import { ContentHoverController } from '../../../../../editor/contrib/hover/browser/contentHoverController.js';
import { GlyphHoverController } from '../../../../../editor/contrib/hover/browser/glyphHoverController.js';
import { CellEditorOptions } from '../../../notebook/browser/view/cellParts/cellEditorOptions.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';
import { CellSelectionType, SelectionState } from '../selectionMachine.js';

/**
 * A cell's focus/selection status from the editor's perspective, derived from
 * the owning notebook instance's selection state machine. Drives focus-on-
 * request and focus-restore-on-exit.
 */
export type CellEditorFocusStatus =
	/** This cell is the active cell in edit mode. */
	| 'editing'
	/** This cell is the sole selection but not in edit mode. */
	| 'activeSingle'
	/** Anything else (unselected, multi-selected, or another cell active). */
	| 'inactive';


/**
 * Owns the Monaco {@link CodeEditorWidget} for a notebook cell and all of its
 * imperative wiring: scoped context keys, option building, model attachment,
 * resize-to-content, multi-select gestures, and edit-mode entry/exit.
 *
 * The editor is constructed host-agnostic (no cell, no notebook); {@link setCell}
 * binds it to a cell and reaches host-level state (size, options, selection,
 * containment) through `cell.instance`. This is what lets a single editor be
 * pooled and re-pointed at cells in different notebooks. The React
 * {@link CellEditorMonacoWidget} renders the host DOM and acquires one of these
 * from a pool.
 */
export class CellEditor extends Disposable {
	/** The underlying Monaco editor widget for this cell. */
	public readonly editor: CodeEditorWidget;

	/**
	 * The root DOM node this editor owns. The host (the React
	 * {@link CellEditorMonacoWidget}) appends this into the cell's row; the
	 * editor never reaches back out to host-owned DOM. Owning the DOM is what
	 * lets a pooled editor be re-parented into a different cell's row on rebind.
	 */
	public readonly element: HTMLElement;

	// --- Instance-lifetime collaborators, built once in the constructor. ---

	private readonly _logService: ILogService;
	private readonly _configurationService: IConfigurationService;

	/** The editor container (`.positron-cell-editor-monaco-widget`). */
	private readonly _editorContainer: HTMLElement;

	/** The focus target (`.positron-cell-editor-focus-target`). */
	private readonly _focusTarget: HTMLElement;

	/**
	 * Editor-level scoped context key service. Created once as a child of the
	 * first cell's scope; on rebind its parent is re-pointed at the new cell's
	 * scope via {@link IScopedContextKeyService.updateParent} rather than being
	 * disposed and recreated.
	 */
	private readonly _editorContextKeyService: IScopedContextKeyService;

	/**
	 * Language-scoped option building. {@link CellEditorOptions} is built per
	 * language (the base options depend on language); rebinding to a cell with a
	 * different language rebuilds it, same-language rebinds reuse it.
	 */
	private readonly _languageBinding = this._register(new MutableDisposable<DisposableStore>());
	private _editorOptions!: CellEditorOptions;
	private _currentLanguage: string | undefined;

	/**
	 * Per-cell wiring (model, scope parent, attach/detach, focus autoruns). Held
	 * in a {@link MutableDisposable} so {@link setCell} can tear down the
	 * previous cell's wiring and build the new cell's wiring on rebind.
	 */
	private readonly _cellBinding = this._register(new MutableDisposable<DisposableStore>());
	private _cell: PositronNotebookCellGeneral | undefined;

	/** Set on the most recent mousedown if modifier keys were held. */
	private _hadModifierMouseDown = false;

	/** Deferred focus-restore frame; cancelled on rebind and dispose. */
	private _pendingFrame: number | undefined;

	/** Set once {@link dispose} has run so {@link reset} can no-op safely. */
	private _disposed = false;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILogService logService: ILogService,
	) {
		super();

		logService.debug('Positron Notebook | CellEditor | Setting up editor widget');

		this._logService = logService;
		this._configurationService = configurationService;

		// Build the DOM this editor owns. `element` is a layout-transparent
		// (display: contents) wrapper so the two children sit in the host's flow
		// exactly as the previous React-rendered divs did. The class names match
		// the old markup so existing CSS and the wrapper's click guard
		// (.closest('.positron-cell-editor-monaco-widget')) keep working.
		const element = this.element = $('.positron-cell-editor-root');
		const editorContainer = this._editorContainer = append(element, $('.positron-cell-editor-monaco-widget'));
		editorContainer.tabIndex = -1;
		const focusTarget = this._focusTarget = append(element, $('.positron-cell-editor-focus-target'));
		focusTarget.setAttribute('role', 'button');
		focusTarget.setAttribute('aria-label', localize('editCell', 'Edit cell - Press Enter to edit'));

		// Create a scoped context key service for this editor. This ensures
		// cell-level context keys (e.g. positronNotebookCellIsFirst) are visible
		// to menus evaluated inside the editor. CodeEditorWidget will create its own child scope
		// from this one for editor-specific keys.
		//
		// The scope is built once for the instance with no cell attached yet: on
		// every setCell its parent is (re-)pointed at the bound cell's scope (see
		// setCell), never recreated.
		const editorContextKeyService = this._editorContextKeyService = this._register(contextKeyService.createScoped(editorContainer));

		// CRITICAL: Set the inCompositeEditor flag to change editor behavior
		// This tells Monaco it's part of a composite (notebook) and not a standalone editor
		// Without this flag, certain standalone editor keybindings would still fire
		EditorContextKeys.inCompositeEditor.bindTo(editorContextKeyService).set(true);

		// We need to ensure the EditorProgressService (or a fake) is available
		// in the service collection because monaco editors will try and access
		// it even though it's not available in the notebook context. This feels
		// hacky but VSCode notebooks do the same thing so I guess it's easier
		// than fixing it at the monaco level.
		const serviceCollection = new ServiceCollection(
			[
				IEditorProgressService,
				// Create a simple no-op IEditorProgressService for editor contributions
				// Based on pattern from codeBlockPart.ts in chat contrib
				new class implements IEditorProgressService {
					_serviceBrand: undefined;
					show() {
						// No-op progress indicator for notebook cell editors
						return { done: () => { }, total: () => { }, worked: () => { } };
					}
					async showWhile(promise: Promise<unknown>): Promise<void> {
						await promise;
					}
				}],
			[IContextKeyService, editorContextKeyService]
		);

		const editorInstaService = this._register(instantiationService.createChild(serviceCollection));

		// Create the editor with only the static Positron overrides. The
		// language-specific option defaults aren't known until a cell is bound, so
		// the first setCell builds CellEditorOptions and applies them via
		// updateOptions.
		this.editor = this._register(editorInstaService.createInstance(
			CodeEditorWidget,
			editorContainer,
			this._staticEditorOptions(),
			{
				contributions: getNotebookEditorContributions()
			}
		));
		const editor = this.editor;

		// Bind the cell editor focused context key to the editor's internal scoped service
		// (CodeEditorWidget creates this synchronously in its constructor)
		const cellEditorFocusedKey = NotebookContextKeys.cellEditorFocused.bindTo(editor.contextKeyService);

		// Track whether the most recent mousedown had modifier keys held.
		// Monaco's _onMouseDown calls focus() BEFORE emitting onMouseDown,
		// so editor.onMouseDown fires AFTER onDidFocusEditorWidget. We use a
		// native DOM capture-phase listener which fires before Monaco's
		// handler to detect modifier keys early enough.
		const editorContainerNode = editor.getContainerDomNode();
		const nativeMouseDownHandler = (e: MouseEvent) => {
			this._hadModifierMouseDown = e.shiftKey || e.ctrlKey || e.metaKey;
		};
		this._register(addDisposableListener(editorContainerNode, 'mousedown', nativeMouseDownHandler, true));

		// Also handle multi-selection from editor.onMouseDown (fires after
		// focus) as a secondary path for cases where the focus handler
		// couldn't prevent enterEditor in time. Reads this._cell so it tracks
		// rebinds without being re-wired.
		this._register(editor.onMouseDown((e) => {
			if (this._cell && (e.event.shiftKey || e.event.ctrlKey || e.event.metaKey)) {
				this._cell.instance.selectionStateMachine.selectCell(this._cell, CellSelectionType.Add);
			}
		}));

		this._register(editor.onDidFocusEditorWidget(() => {
			// Consume and reset the modifier flag so it doesn't affect
			// subsequent programmatic focus calls.
			const wasModifierClick = this._hadModifierMouseDown;
			this._hadModifierMouseDown = false;

			// If the user shift/ctrl/cmd-clicked, the wrapper's onClick handler
			// will handle multi-selection. Don't override that by entering edit mode.
			if (wasModifierClick) {
				cellEditorFocusedKey.set(true);
				return;
			}

			// enterEditor() automatically detects that editor has focus and skips focus management.
			// This also handles plain clicks during MultiSelection, collapsing the selection
			// into EditingSelection for this cell.
			if (this._cell) {
				this._cell.instance.selectionStateMachine.enterEditor(this._cell);
			}
			cellEditorFocusedKey.set(true);
		}));

		this._register(editor.onDidBlurEditorWidget(() => {
			// Clear any stale modifier flag so it doesn't incorrectly suppress
			// enterEditor() on a later keyboard/programmatic focus.
			this._hadModifierMouseDown = false;
			cellEditorFocusedKey.set(false);

			const cell = this._cell;
			if (!cell) {
				return;
			}

			// Check where focus moved to - don't exit edit mode if focus moved to VS Code overlays
			// or is still within the notebook editor scope.
			// This prevents the command palette, quick open, find widget, etc. from closing
			// immediately when opened from a cell in edit mode.
			const activeElement = editor.getContainerDomNode().ownerDocument.activeElement;
			if (!activeElement) {
				// No active element - focus has truly left, exit edit mode
				cell.instance.selectionStateMachine.exitEditor(cell);
				return;
			}

			const contextKeyContext = editorContextKeyService.getContext(activeElement);

			// Context keys that indicate focus is still within VS Code overlays or related UI
			const shouldKeepEditModeContextKeys = [
				// VS Code overlays (command palette, quick open, etc.)
				InQuickPickContextKey.key,
				// Other editor inputs (find widget, etc.)
				EditorContextKeys.textInputFocus.key,
				// Find input box
				CONTEXT_FIND_INPUT_FOCUSED.key,
				// Replace input box
				CONTEXT_REPLACE_INPUT_FOCUSED.key,
				// Chat-related contexts (assistant inline or panel chat)
				CTX_INLINE_CHAT_FOCUSED.key,
				// Other editors like find widget etc..
				EditorContextKeys.textInputFocus.key,
				// Action widget menus (model switcher, etc.)
				// Not exported anywhere but set in src/vs/platform/actionWidget/browser/actionWidget.ts
				'codeActionMenuVisible',
			];

			const shouldKeepEditMode = shouldKeepEditModeContextKeys.some(contextKey => contextKeyContext.getValue(contextKey));
			if (shouldKeepEditMode) {
				return;
			}

			// Check if focus is still within the notebook editor container
			// This covers both internal focus changes (cell to cell) and focus on notebook UI elements
			if (this._containsElement(activeElement)) {
				return;
			}

			// Focus has truly left the notebook editor - exit edit mode
			// Pass the cell so we only exit if THIS specific cell is being edited (not a different one)
			// This handles the race condition where a user clicks from one cell editor into another.
			cell.instance.selectionStateMachine.exitEditor(cell);
		}));

		// Resize the editor when its content size changes
		this._register(editor.onDidContentSizeChange(e => {
			if (!(e.contentHeightChanged || e.contentWidthChanged)) { return; }
			this._resizeEditor(e.contentHeight);
		}));

		// Enter edit mode when Enter is pressed on the focus target.
		this._register(addDisposableListener(focusTarget, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				// Focus the Monaco editor to enter edit mode
				editor.focus();
			}
		}));

		this._register(toDisposable(() => {
			this._disposed = true;
			this._cancelPendingFrame();
			logService.debug('Positron Notebook | CellEditor | Disposing editor widget');
		}));
	}

	/**
	 * Re-point this editor at `cell`, reusing the live {@link CodeEditorWidget},
	 * owned DOM and editor scope rather than disposing and recreating them. The
	 * previous cell's per-cell wiring (model, attach, focus autoruns) is torn
	 * down and rebuilt for the new cell.
	 */
	public setCell(cell: PositronNotebookCellGeneral): void {
		if (this._cell === cell) {
			return;
		}

		this._logService.debug('Positron Notebook | CellEditor | Binding to cell');

		// A deferred focus-restore from the previous cell must not fire against
		// the new one.
		this._cancelPendingFrame();

		// Disposes the previous cell's wiring (detaches the old cell).
		const store = new DisposableStore();
		this._cellBinding.value = store;
		this._cell = cell;

		const editor = this.editor;
		const focusTarget = this._focusTarget;

		// Re-point the editor scope at the new cell's scope so cell-level context
		// keys (evaluated by action-bar menus) resolve against the right cell.
		this._editorContextKeyService.updateParent(cell.scopedContextKeyService!);

		// Rebuild the option model if the language changed, then apply it.
		this._setLanguage(cell);
		editor.updateOptions(this._buildEditorOptions());

		// Relayout the editor as the owning notebook's container size changes
		// (e.g. on window resize). The size source is the bound cell's instance, so
		// it re-subscribes on rebind -- important when a pooled editor moves between
		// notebooks.
		store.add(autorun(reader => {
			cell.instance.size.read(reader);
			this._resizeEditor();
		}));

		// Attach the editor to the cell and detach it when this binding is torn
		// down (rebind or dispose).
		cell.attachEditor(editor);
		store.add(toDisposable(() => cell.detachEditor()));

		// Request the model for the cell and pass it to the editor. Guard against
		// a rebind that happened while the model was resolving.
		cell.getTextEditorModel().then(model => {
			if (this._cell === cell) {
				editor.setModel(model);
			}
		});

		// Keep the focus target in the tab order only when the cell has outputs.
		// When there are no outputs, the focus target and the cell container share
		// the same visual styling, so a tab-stop there would force users to tab
		// twice for no visible change. For code cells `cell.outputs` is an
		// observable; markdown/raw cells have none, in which case it is always
		// out of the tab order.
		store.add(autorun(reader => {
			const hasOutputs = (cell.outputs?.read(reader)?.length ?? 0) > 0;
			focusTarget.tabIndex = hasOutputs ? 0 : -1;
		}));

		// Watch for editor focus requests from the cell - triggers whenever
		// requestEditorFocus() is called.
		const focusStatus = this._cellFocusStatus(cell);
		store.add(autorun(reader => {
			cell.editorFocusRequested.read(reader);
			// Check if THIS cell is still the one being edited
			// This prevents stale focus requests when user rapidly navigates between cells
			if (focusStatus.read(reader) !== 'editing') {
				return;
			}

			editor.focus();
		}));

		// Watch for exit-editor transitions to return focus to the focus target.
		store.add(autorunDelta(focusStatus, ({ lastValue, newValue }) => {
			// Check if we transitioned from editing THIS cell to single selection of THIS cell
			if (lastValue === 'editing' && newValue === 'activeSingle') {
				// Don't steal focus if the user navigated to a different editor
				// (e.g. clicking a cell in a side-by-side notebook). This mirrors
				// the guard in the onDidBlurEditorWidget handler above.
				const activeEl = cell.container?.ownerDocument.activeElement;
				if (activeEl && !this._containsElement(activeEl)) {
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
						focusTarget.focus();
					} else {
						cell.container?.focus();
					}
				};

				if (!activeEl) {
					// activeElement is transiently null during blur/focus
					// handoff. Defer to the next frame so the browser settles
					// on the actual target before we decide.
					const win = getWindow(cell.container);
					this._cancelPendingFrame();
					this._pendingFrame = win.requestAnimationFrame(() => {
						this._pendingFrame = undefined;
						// If the editor was rebound to a different cell during the
						// deferred frame, this restore is stale - bail out.
						if (this._cell !== cell) {
							return;
						}
						// Re-check selection state: if the user moved to
						// another cell during the deferred frame, bail out.
						if (focusStatus.get() !== 'activeSingle') {
							return;
						}
						const resolved = cell.container?.ownerDocument.activeElement;
						if (resolved && !this._containsElement(resolved)) {
							return;
						}
						restoreCellFocus();
					});
					return;
				}

				restoreCellFocus();
			}
		}));
	}

	/**
	 * Detach this editor from its current cell and DOM mount so it can be safely
	 * parked in a pool and re-acquired for a different cell later. Unlike
	 * {@link dispose}, the live {@link CodeEditorWidget}, owned DOM and editor
	 * scope all survive -- this is what makes pooled reuse cheaper than
	 * recreating the editor.
	 *
	 * Tears down the per-cell wiring (detaching the cell's editor via the
	 * binding store), clears the model so a disposed cell can't leave the editor
	 * holding a dangling model reference, cancels any deferred focus-restore, and
	 * removes the owned root from its mount point. The next {@link setCell} after
	 * a reset always rebinds (since `_cell` is cleared), even for the same cell.
	 */
	public reset(): void {
		// A reset can race a pool disposal during React unmount; if the editor is
		// already gone there is nothing to detach.
		if (this._disposed) {
			return;
		}
		this._cancelPendingFrame();
		// Hide any open hover/glyph popups so a stale popup from the previous cell
		// cannot survive into the editor's next mount.
		this._clearWidgets();
		// Disposes the per-cell binding store, which detaches the cell's editor.
		this._cellBinding.clear();
		this._cell = undefined;
		// Drop the model reference: the cell owns (and may dispose) it, so the
		// pooled editor must not keep pointing at a model it no longer drives.
		this.editor.setModel(null);
		// Unmount the owned root; a later setCell/acquire re-parents it.
		this.element.remove();
	}

	/**
	 * Build (or rebuild) the language-specific {@link CellEditorOptions} model
	 * from the bound cell's notebook instance. No-op when the language is
	 * unchanged so same-language rebinds reuse the existing model and its
	 * `onDidChange` wiring.
	 */
	private _setLanguage(cell: PositronNotebookCellGeneral): void {
		const language = cell.model.language;
		if (this._currentLanguage === language && this._editorOptions) {
			return;
		}
		this._currentLanguage = language;

		const store = new DisposableStore();
		this._languageBinding.value = store;
		const editorOptions = this._editorOptions = store.add(new CellEditorOptions(
			cell.instance.getBaseCellEditorOptions(language),
			cell.instance.notebookOptions,
			this._configurationService,
		));

		// Re-apply options when they change so the open notebook updates without
		// requiring a reload.
		store.add(editorOptions.onDidChange(() => {
			this.editor.updateOptions(this._buildEditorOptions());
		}));
	}

	/**
	 * The static Positron Notebook editor overrides, independent of any cell or
	 * language. Used to construct the editor before a cell is bound; once bound,
	 * {@link _buildEditorOptions} layers these over the language defaults.
	 */
	private _staticEditorOptions(): IEditorConstructionOptions {
		return {
			// Override padding for Positron notebooks to add breathing room between action bar and editor content
			padding: { top: 16, bottom: 16 },
			scrollbar: {
				// Smaller scrollbars since we embed many editor widgets
				verticalScrollbarSize: 8,
				horizontalScrollbarSize: 8
			},
			tabIndex: -1, // Remove editor from tab order - use Enter to focus
			dimension: {
				width: 0,
				height: 0,
			},
		};
	}

	/**
	 * Build the final editor options from the cell editor defaults merged with
	 * the Positron Notebook editor overrides. Used for live updates once a cell
	 * is bound so the overrides are never lost on update.
	 */
	private _buildEditorOptions(): IEditorConstructionOptions {
		const defaultOptions = this._editorOptions.getDefaultValue();
		return {
			...defaultOptions,
			...this._staticEditorOptions(),
			scrollbar: {
				...defaultOptions.scrollbar,
				verticalScrollbarSize: 8,
				horizontalScrollbarSize: 8
			},
		};
	}

	/**
	 * The bound cell's focus/selection status, derived from the owning notebook
	 * instance's selection state machine. Drives focus-on-request and focus-
	 * restore-on-exit.
	 */
	private _cellFocusStatus(cell: PositronNotebookCellGeneral): IObservable<CellEditorFocusStatus> {
		return derived(reader => {
			const state = cell.instance.selectionStateMachine.state.read(reader);
			if (state.type === SelectionState.EditingSelection && state.active === cell) {
				return 'editing';
			}
			if (state.type === SelectionState.SingleSelection && state.active === cell) {
				return 'activeSingle';
			}
			return 'inactive';
		});
	}

	/**
	 * Whether `element` lives within the bound cell's notebook editor container.
	 * Used by the focus/blur guards to decide whether focus left the notebook
	 * entirely.
	 */
	private _containsElement(element: Element | null): boolean {
		const container = this._cell?.instance.currentContainer;
		return !!element && !!container?.contains(element);
	}

	/**
	 * Resize the editor widget to fill the width of its container and the height
	 * of its content.
	 * @param height Height to set. Defaults to checking content height.
	 */
	private _resizeEditor(height: number = this.editor.getContentHeight()): void {
		this.editor.layout({
			height,
			width: this._editorContainer.offsetWidth,
		});
	}

	/** Cancel any deferred focus-restore frame. */
	private _cancelPendingFrame(): void {
		if (this._pendingFrame !== undefined) {
			getWindow(this.element).cancelAnimationFrame(this._pendingFrame);
			this._pendingFrame = undefined;
		}
	}

	/**
	 * Hide any content/glyph hover popups owned by the editor. Called on reset so
	 * a hover left open over the previous cell can't linger when the pooled editor
	 * is re-mounted for another cell (mirrors `CodeBlockPart.clearWidgets`).
	 */
	private _clearWidgets(): void {
		ContentHoverController.get(this.editor)?.hideContentHover();
		GlyphHoverController.get(this.editor)?.hideGlyphHover();
	}
}

/**
 * Get the notebook options for the editor widget.
 * Taken directly from `getDefaultNotebookCreationOptions()` in notebookEditorWidget.ts
*/
function getNotebookEditorContributions(): IEditorContributionDescription[] {
	// Taken directly from `getDefaultNotebookCreationOptions()` in notebookEditorWidget.ts
	const skipContributions = [
		'editor.contrib.review',
		FloatingEditorClickMenu.ID,
		'editor.contrib.dirtydiff',
		'editor.contrib.testingOutputPeek',
		'editor.contrib.testingDecorations',
		'store.contrib.stickyScrollController',
		'editor.contrib.findController',
		'editor.contrib.emptyTextEditorHint'
	];

	// In the future we may want to be more selective about which contributions we include if our
	// feature set diverges more drastically from the standaard notebooks.
	return EditorExtensionsRegistry.getEditorContributions().filter(c => skipContributions.indexOf(c.id) === -1);
}

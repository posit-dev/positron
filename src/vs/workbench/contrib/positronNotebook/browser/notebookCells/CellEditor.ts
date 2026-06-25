/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, getWindow } from '../../../../../base/browser/dom.js';
import { ISize } from '../../../../../base/browser/positronReactRenderer.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, autorunDelta, IObservable } from '../../../../../base/common/observable.js';
import { localize } from '../../../../../nls.js';
import { IEditorContributionDescription, EditorExtensionsRegistry } from '../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_REPLACE_INPUT_FOCUSED } from '../../../../../editor/contrib/find/browser/findModel.js';
import { IBaseCellEditorOptions } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookOptions } from '../../../notebook/browser/notebookOptions.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IEditorProgressService } from '../../../../../platform/progress/common/progress.js';
import { FloatingEditorClickMenu } from '../../../../browser/codeeditor.js';
import { InQuickPickContextKey } from '../../../../browser/quickaccess.js';
import { CTX_INLINE_CHAT_FOCUSED } from '../../../../contrib/inlineChat/common/inlineChat.js';
import { CellEditorOptions } from '../../../notebook/browser/view/cellParts/cellEditorOptions.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';

/**
 * A cell's focus/selection status from the editor's perspective. Reported by
 * {@link ICellEditorDelegate.cellFocusStatus} so the editor can drive focus
 * without knowing how the host tracks selection.
 */
export type CellEditorFocusStatus =
	/** This cell is the active cell in edit mode. */
	| 'editing'
	/** This cell is the sole selection but not in edit mode. */
	| 'activeSingle'
	/** Anything else (unselected, multi-selected, or another cell active). */
	| 'inactive';

/**
 * Host-specific behavior the {@link CellEditor} depends on, abstracted so the
 * editor can be reused across hosts (notebook cells today; potentially other
 * embedders later). Mirrors the `IChatRendererDelegate` pattern used by
 * `CodeBlockPart`: the editor owns the Monaco wiring, the host supplies the
 * surrounding context (sizing, options, selection, and containment).
 */
export interface ICellEditorDelegate {
	/**
	 * Observable size driving editor relayout (e.g. the notebook width changing
	 * on window resize). The editor re-lays out whenever this changes.
	 */
	readonly size: IObservable<ISize>;

	/** Host display options used to build the editor's options. */
	readonly notebookOptions: NotebookOptions;

	/** Base editor options for the given language. */
	getBaseCellEditorOptions(language: string): IBaseCellEditorOptions;

	/**
	 * Whether `element` lives within the host's editor container. Used by the
	 * focus/blur guards to decide whether focus left the host entirely.
	 */
	containsElement(element: Element | null): boolean;

	/**
	 * Observable focus/selection status of `cell` from the editor's perspective.
	 * Drives focus-on-request and focus-restore-on-exit.
	 */
	cellFocusStatus(cell: PositronNotebookCellGeneral): IObservable<CellEditorFocusStatus>;

	/** Enter edit mode for `cell` (host updates selection and focus). */
	enterEditor(cell: PositronNotebookCellGeneral): void;

	/** Exit edit mode if `cell` is the cell currently being edited. */
	exitEditor(cell: PositronNotebookCellGeneral): void;

	/** Add `cell` to the current selection (multi-select). */
	addCellToSelection(cell: PositronNotebookCellGeneral): void;
}

/**
 * Owns the Monaco {@link CodeEditorWidget} for a notebook cell and all of its
 * imperative wiring: scoped context keys, option building, model attachment,
 * resize-to-content, multi-select gestures, and edit-mode entry/exit.
 *
 * Host-specific behavior (sizing, options, selection, containment) is injected
 * via an {@link ICellEditorDelegate} so the editor doesn't reach into the
 * notebook instance directly and can be reused across hosts. The React
 * {@link CellEditorMonacoWidget} renders the host DOM and constructs one of
 * these.
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

	constructor(
		cell: PositronNotebookCellGeneral,
		delegate: ICellEditorDelegate,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
	) {
		super();

		logService.debug('Positron Notebook | CellEditor | Setting up editor widget');

		const language = cell.model.language;

		// Build the DOM this editor owns. `element` is a layout-transparent
		// (display: contents) wrapper so the two children sit in the host's flow
		// exactly as the previous React-rendered divs did. The class names match
		// the old markup so existing CSS and the wrapper's click guard
		// (.closest('.positron-cell-editor-monaco-widget')) keep working.
		const element = this.element = $('.positron-cell-editor-root');
		const editorContainer = append(element, $('.positron-cell-editor-monaco-widget'));
		editorContainer.tabIndex = -1;
		const focusTarget = append(element, $('.positron-cell-editor-focus-target'));
		focusTarget.setAttribute('role', 'button');
		focusTarget.setAttribute('aria-label', localize('editCell', 'Edit cell - Press Enter to edit'));

		// Create a scoped context key service for this editor as a child of the cell's scope.
		// This ensures cell-level context keys (e.g. positronNotebookCellIsFirst) are visible
		// to menus evaluated inside the editor. CodeEditorWidget will create its own child scope
		// from this one for editor-specific keys.
		//
		// The widget only constructs a CellEditor once the cell has a scoped context key service,
		// so the non-null assertion is safe here.
		const editorContextKeyService = this._register(cell.scopedContextKeyService!.createScoped(editorContainer));

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
		const editorOptions = this._register(new CellEditorOptions(delegate.getBaseCellEditorOptions(language), delegate.notebookOptions, configurationService));

		// Build the final editor options from the cell editor defaults merged with
		// the Positron Notebook editor overrides. Used for both initial creation
		// and live updates so the overrides are never lost on update.
		const buildEditorOptions = () => {
			const defaultOptions = editorOptions.getDefaultValue();
			return {
				...defaultOptions,
				// Override padding for Positron notebooks to add breathing room between action bar and editor content
				padding: { top: 16, bottom: 16 },
				scrollbar: {
					...defaultOptions.scrollbar,
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
		};

		this.editor = this._register(editorInstaService.createInstance(
			CodeEditorWidget,
			editorContainer,
			buildEditorOptions(),
			{
				contributions: getNotebookEditorContributions()
			}
		));
		const editor = this.editor;

		// Re-apply options when they change so the open notebook
		// updates without requiring a reload.
		this._register(editorOptions.onDidChange(() => {
			editor.updateOptions(buildEditorOptions());
		}));

		// Attach the editor to the cell and detach it on disposal.
		cell.attachEditor(editor);
		this._register(toDisposable(() => cell.detachEditor()));

		// Request model for cell and pass to editor.
		cell.getTextEditorModel().then(model => {
			editor.setModel(model);
		});

		// Bind the cell editor focused context key to the editor's internal scoped service
		// (CodeEditorWidget creates this synchronously in its constructor)
		const cellEditorFocusedKey = NotebookContextKeys.cellEditorFocused.bindTo(editor.contextKeyService);

		// Track whether the most recent mousedown had modifier keys held.
		// Monaco's _onMouseDown calls focus() BEFORE emitting onMouseDown,
		// so editor.onMouseDown fires AFTER onDidFocusEditorWidget. We use a
		// native DOM capture-phase listener which fires before Monaco's
		// handler to detect modifier keys early enough.
		let hadModifierMouseDown = false;
		const editorContainerNode = editor.getContainerDomNode();
		const nativeMouseDownHandler = (e: MouseEvent) => {
			hadModifierMouseDown = e.shiftKey || e.ctrlKey || e.metaKey;
		};
		this._register(addDisposableListener(editorContainerNode, 'mousedown', nativeMouseDownHandler, true));

		// Also handle multi-selection from editor.onMouseDown (fires after
		// focus) as a secondary path for cases where the focus handler
		// couldn't prevent enterEditor in time.
		this._register(editor.onMouseDown((e) => {
			if (e.event.shiftKey || e.event.ctrlKey || e.event.metaKey) {
				delegate.addCellToSelection(cell);
			}
		}));

		this._register(editor.onDidFocusEditorWidget(() => {
			// Consume and reset the modifier flag so it doesn't affect
			// subsequent programmatic focus calls.
			const wasModifierClick = hadModifierMouseDown;
			hadModifierMouseDown = false;

			// If the user shift/ctrl/cmd-clicked, the wrapper's onClick handler
			// will handle multi-selection. Don't override that by entering edit mode.
			if (wasModifierClick) {
				cellEditorFocusedKey.set(true);
				return;
			}

			// enterEditor() automatically detects that editor has focus and skips focus management.
			// This also handles plain clicks during MultiSelection, collapsing the selection
			// into EditingSelection for this cell.
			delegate.enterEditor(cell);
			cellEditorFocusedKey.set(true);
		}));

		this._register(editor.onDidBlurEditorWidget(() => {
			// Clear any stale modifier flag so it doesn't incorrectly suppress
			// enterEditor() on a later keyboard/programmatic focus.
			hadModifierMouseDown = false;
			cellEditorFocusedKey.set(false);

			// Check where focus moved to - don't exit edit mode if focus moved to VS Code overlays
			// or is still within the notebook editor scope.
			// This prevents the command palette, quick open, find widget, etc. from closing
			// immediately when opened from a cell in edit mode.
			const activeElement = editor.getContainerDomNode().ownerDocument.activeElement;
			if (!activeElement) {
				// No active element - focus has truly left, exit edit mode
				delegate.exitEditor(cell);
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
			if (delegate.containsElement(activeElement)) {
				return;
			}

			// Focus has truly left the notebook editor - exit edit mode
			// Pass the cell so we only exit if THIS specific cell is being edited (not a different one)
			// This handles the race condition where a user clicks from one cell editor into another.
			delegate.exitEditor(cell);
		}));

		/**
		 * Resize the editor widget to fill the width of its container and the height of its
		 * content.
		 * @param height Height to set. Defaults to checking content height.
		 */
		const resizeEditor = (height: number = editor.getContentHeight()) => {
			editor.layout({
				height,
				width: editorContainer.offsetWidth,
			});
		};

		// Resize the editor when its content size changes
		this._register(editor.onDidContentSizeChange(e => {
			if (!(e.contentHeightChanged || e.contentWidthChanged)) { return; }
			resizeEditor(e.contentHeight);
		}));

		// Resize the editor as the window resizes.
		this._register(autorun(reader => {
			delegate.size.read(reader);
			resizeEditor();
		}));

		// Enter edit mode when Enter is pressed on the focus target.
		this._register(addDisposableListener(focusTarget, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				// Focus the Monaco editor to enter edit mode
				editor.focus();
			}
		}));

		// Keep the focus target in the tab order only when the cell has outputs.
		// When there are no outputs, the focus target and the cell container share
		// the same visual styling, so a tab-stop there would force users to tab
		// twice for no visible change. For code cells `cell.outputs` is an
		// observable; markdown/raw cells have none, in which case it is always
		// out of the tab order.
		this._register(autorun(reader => {
			const hasOutputs = (cell.outputs?.read(reader)?.length ?? 0) > 0;
			focusTarget.tabIndex = hasOutputs ? 0 : -1;
		}));

		// Watch for editor focus requests from the cell - triggers whenever
		// requestEditorFocus() is called.
		const focusStatus = delegate.cellFocusStatus(cell);
		this._register(autorun(reader => {
			cell.editorFocusRequested.read(reader);
			// Check if THIS cell is still the one being edited
			// This prevents stale focus requests when user rapidly navigates between cells
			if (focusStatus.read(reader) !== 'editing') {
				return;
			}

			editor.focus();
		}));

		// Watch for exit-editor transitions to return focus to the focus target.
		let pendingFrame: number | undefined;
		this._register(autorunDelta(focusStatus, ({ lastValue, newValue }) => {
			// Check if we transitioned from editing THIS cell to single selection of THIS cell
			if (lastValue === 'editing' && newValue === 'activeSingle') {
				// Don't steal focus if the user navigated to a different editor
				// (e.g. clicking a cell in a side-by-side notebook). This mirrors
				// the guard in the onDidBlurEditorWidget handler above.
				const activeEl = cell.container?.ownerDocument.activeElement;
				if (activeEl && !delegate.containsElement(activeEl)) {
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
					if (pendingFrame !== undefined) {
						win.cancelAnimationFrame(pendingFrame);
					}
					pendingFrame = win.requestAnimationFrame(() => {
						pendingFrame = undefined;
						// Re-check selection state: if the user moved to
						// another cell during the deferred frame, bail out.
						if (focusStatus.get() !== 'activeSingle') {
							return;
						}
						const resolved = cell.container?.ownerDocument.activeElement;
						if (resolved && !delegate.containsElement(resolved)) {
							return;
						}
						restoreCellFocus();
					});
					return;
				}

				restoreCellFocus();
			}
		}));
		this._register(toDisposable(() => {
			if (pendingFrame !== undefined) {
				getWindow(cell.container).cancelAnimationFrame(pendingFrame);
			}
		}));

		this._register(toDisposable(() => {
			logService.debug('Positron Notebook | CellEditor | Disposing editor widget');
		}));
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

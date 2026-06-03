/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, $ } from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { autorun, observableValue } from '../../../../../base/common/observable.js';
import { EditorExtensionsRegistry, IEditorContributionDescription } from '../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_REPLACE_INPUT_FOCUSED } from '../../../../../editor/contrib/find/browser/findModel.js';
import { ContentHoverController } from '../../../../../editor/contrib/hover/browser/contentHoverController.js';
import { GlyphHoverController } from '../../../../../editor/contrib/hover/browser/glyphHoverController.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IEditorProgressService } from '../../../../../platform/progress/common/progress.js';
import { FloatingEditorClickMenu } from '../../../../browser/codeeditor.js';
import { InQuickPickContextKey } from '../../../../browser/quickaccess.js';
import { CTX_INLINE_CHAT_FOCUSED } from '../../../inlineChat/common/inlineChat.js';
import { CellEditorOptions } from '../../../notebook/browser/view/cellParts/cellEditorOptions.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { SwitchableBaseCellEditorOptions } from '../BaseCellEditorOptions.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType, SelectionState } from '../selectionMachine.js';
import { INotebookCellEditor } from './INotebookCellEditor.js';

export class CellEditor extends Disposable implements INotebookCellEditor {
	public readonly container: HTMLElement;
	public readonly focusTarget: HTMLElement;
	// TODO: Try to make this not observable
	private _cell = observableValue<IPositronNotebookCell | undefined>('cellEditorCell', undefined);
	private readonly _cellDisposables = this._register(new DisposableStore());
	public readonly editor: CodeEditorWidget;
	private _baseOptions: SwitchableBaseCellEditorOptions;

	constructor(
		private readonly _notebookInstance: IPositronNotebookInstance,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
	) {
		super();

		this.container = $('.positron-cell-editor-monaco-widget');
		this.container.tabIndex = -1;

		this.focusTarget = $('.positron-cell-editor-focus-target');
		this.focusTarget.ariaLabel = localize('editCell', 'Edit cell - Press Enter to edit');
		this.focusTarget.role = 'button';
		// TODO: Set tab index to 0 when there are outputs
		this.focusTarget.tabIndex = -1;
		// Focus the editor on 'Enter'
		this.focusTarget.onkeydown = (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.editor.focus();
			}
		};

		this._baseOptions = new SwitchableBaseCellEditorOptions(
			this._notebookInstance.getBaseCellEditorOptions()
		);

		// Create a scoped context key service for this editor as a child of the cell's scope.
		// This ensures cell-level context keys (e.g. positronNotebookCellIsFirst) are visible
		// to menus evaluated inside the editor. CodeEditorWidget will create its own child scope
		// from this one for editor-specific keys.
		const scopedContextKeyService = this._register(this._contextKeyService.createScoped(this.container));

		// CRITICAL: Set the inCompositeEditor flag to change editor behavior
		// This tells Monaco it's part of a composite (notebook) and not a standalone editor
		// Without this flag, certain standalone editor keybindings would still fire
		// TODO: Do we need this? codeBlockPart doesn't.
		EditorContextKeys.inCompositeEditor.bindTo(scopedContextKeyService).set(true);

		// We need to ensure the EditorProgressService (or a fake) is available
		// in the service collection because monaco editors will try and access
		// it even though it's not available in the notebook context. This feels
		// hacky but VSCode notebooks do the same thing so I guess it's easier
		// than fixing it at the monaco level.
		const serviceCollection = new ServiceCollection(
			[
				// TODO: We really shouldn't need to fake this service.
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
			[IContextKeyService, scopedContextKeyService]
		);
		const scopedInstantiationService = this._instantiationService.createChild(serviceCollection);

		this.editor = this._createEditor(scopedInstantiationService);

		// Bind the cell editor focused context key to the editor's internal scoped service
		// (CodeEditorWidget creates this synchronously in its constructor)
		const cellEditorFocusedKey = NotebookContextKeys.cellEditorFocused.bindTo(this.editor.contextKeyService);

		// Track whether the most recent mousedown had modifier keys held.
		// Monaco's _onMouseDown calls focus() BEFORE emitting onMouseDown,
		// so editor.onMouseDown fires AFTER onDidFocusEditorWidget. We use a
		// native DOM capture-phase listener which fires before Monaco's
		// handler to detect modifier keys early enough.
		let hadModifierMouseDown = false;
		const editorContainer = this.editor.getContainerDomNode();
		const nativeMouseDownHandler = (e: MouseEvent) => {
			hadModifierMouseDown = e.shiftKey || e.ctrlKey || e.metaKey;
		};
		this._register(addDisposableListener(editorContainer, 'mousedown', nativeMouseDownHandler, true));

		// Also handle multi-selection from editor.onMouseDown (fires after
		// focus) as a secondary path for cases where the focus handler
		// couldn't prevent enterEditor in time.
		this._register(this.editor.onMouseDown((e) => {
			if (!this._currentCell) {
				// No cell attached.
				return;
			}
			if (e.event.shiftKey || e.event.ctrlKey || e.event.metaKey) {
				this._notebookInstance.selectionStateMachine.selectCell(this._currentCell, CellSelectionType.Add);
			}
		}));

		this._register(this.editor.onDidFocusEditorWidget(() => {
			if (!this._currentCell) {
				// No cell attached.
				return;
			}

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
			this._notebookInstance.selectionStateMachine.enterEditor(this._currentCell);
			cellEditorFocusedKey.set(true);
		}));

		// TODO: There must be a better way to do this...
		this._register(this.editor.onDidBlurEditorWidget(() => {
			if (!this._currentCell) {
				// No cell attached.
				return;
			}

			// Clear any stale modifier flag so it doesn't incorrectly suppress
			// enterEditor() on a later keyboard/programmatic focus.
			hadModifierMouseDown = false;
			cellEditorFocusedKey.set(false);

			// Check where focus moved to - don't exit edit mode if focus moved to VS Code overlays
			// or is still within the notebook editor scope.
			// This prevents the command palette, quick open, find widget, etc. from closing
			// immediately when opened from a cell in edit mode.
			const activeElement = this.editor.getContainerDomNode().ownerDocument.activeElement;
			if (!activeElement) {
				// No active element - focus has truly left, exit edit mode
				this._notebookInstance.selectionStateMachine.exitEditor(this._currentCell);
				return;
			}

			// TODO: Should this be any of the scoped ck services?
			const contextKeyContext = this._contextKeyService.getContext(activeElement);

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
			if (this._notebookInstance.currentContainer?.contains(activeElement)) {
				return;
			}

			// Focus has truly left the notebook editor - exit edit mode
			// Pass the cell so we only exit if THIS specific cell is being edited (not a different one)
			// This handles the race condition where a user clicks from one cell editor into another.
			this._notebookInstance.selectionStateMachine.exitEditor(this._currentCell);
		}));

		// Resize the editor when its content size changes
		this._register(this.editor.onDidContentSizeChange(e => {
			if (!(e.contentHeightChanged || e.contentWidthChanged)) { return; }
			this._resizeEditor(e.contentHeight);
		}));

		// Resize the editor as the window resizes.
		this._register(autorun(reader => {
			this._notebookInstance.size.read(reader);
			this._resizeEditor();
		}));

		// TODO: Might have to register this only when cells are attached.
		//       Or this could make more sense to live in the cell class.
		// Watch for editor focus requests from the cell
		// Subscribe to focus request signal - triggers whenever requestEditorFocus() is called
		this._register(autorun(reader => {
			const cell = this._cell.read(reader);
			if (!cell) {
				// No cell attached.
				return;
			}
			cell.editorFocusRequested.read(reader);
			const editor = cell.currentEditor;
			// Check if THIS cell is still the one being edited
			// This prevents stale focus requests when user rapidly navigates between cells
			const state = this._notebookInstance.selectionStateMachine.state.read(reader);
			const shouldFocus = state.type === SelectionState.EditingSelection && state.active === cell;

			if (!shouldFocus) {
				return;
			}

			if (editor) {
				editor.focus();
			}
		}));

		logService.debug('Positron Notebook | useCellEditorWidget() | Setting up editor widget');
	}

	private get _currentCell(): IPositronNotebookCell | undefined {
		return this._cell.get();
	}

	private _createEditor(
		instantiationService: IInstantiationService,
	): CodeEditorWidget {
		const editorOptions = new CellEditorOptions(
			this._baseOptions,
			this._notebookInstance.notebookOptions,
			this._configurationService
		);
		const defaultOptions = editorOptions.getDefaultValue();
		return this._register(instantiationService.createInstance(CodeEditorWidget, this.container, {
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
		}, {
			contributions: getNotebookEditorContributions()
		}));
	}

	/**
	 * Resize the editor widget to fill the width of its container and the height of its
	 * content.
	 * @param height Height to set. Defaults to checking content height.
	 */
	private _resizeEditor(height: number = this.editor.getContentHeight()): void {
		this.editor.layout({
			height,
			width: this.editor.getContainerDomNode().offsetWidth,
		});
	}

	setCell(cell: IPositronNotebookCell | undefined): void {
		if (this._currentCell === cell) {
			return;
		}
		this._cell.set(cell, undefined);
		this._cellDisposables.clear();

		if (cell) {
			const options = this._notebookInstance.getBaseCellEditorOptions(cell.model.language);
			this._baseOptions.setInner(options);

			/**
			 * Observe outputs reactively so hasOutputs updates when outputs are added/removed.
			 * For code cells, cell.outputs is an observable; for markdown cells it's undefined.
			 * When undefined, useObservedValue returns the default empty array.
			 *
			 * Skip focus trap when cell has no outputs (avoids double-tab with same visual).
			 * When there are no outputs, the focus trap and cell container share the same visual
			 * styling, requiring users to tab twice to see any change.
			 */
			const outputs = cell.outputs;
			if (outputs) {
				this._cellDisposables.add(autorun((reader) => {
					const o = outputs.read(reader);
					if (o.length > 0) {
						this.focusTarget.tabIndex = 0;
					}
				}));
			}
		}
	}

	reset(): void {
		this.clearWidgets();
		this._cell.set(undefined, undefined);
	}

	private clearWidgets() {
		ContentHoverController.get(this.editor)?.hideContentHover();
		GlyphHoverController.get(this.editor)?.hideGlyphHover();
	}

	focus(): void {
		this.focusTarget.focus();
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

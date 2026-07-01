/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellEditorMonacoWidget.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';

import { EditorExtensionsRegistry, IEditorContributionDescription } from '../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';

import { FloatingEditorClickMenu } from '../../../../browser/codeeditor.js';
import { getInitialCellEditorOptions, PositronCellEditorOptions } from './PositronCellEditorOptions.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { addDisposableListener, getWindow } from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';
import { useObservedValue } from '../useObservedValue.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { autorun, autorunDelta } from '../../../../../base/common/observable.js';
import { NotebookContextKeys } from '../../common/notebookContextKeys.js';
import { CellSelectionType, SelectionState } from '../selectionMachine.js';
import { InQuickPickContextKey } from '../../../../browser/quickaccess.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { CTX_INLINE_CHAT_FOCUSED } from '../../../../contrib/inlineChat/common/inlineChat.js';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_REPLACE_INPUT_FOCUSED } from '../../../../../editor/contrib/find/browser/findModel.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CellEditor } from '../CellEditor.js';

/**
 *
 * @param opts.cell Cell to be shown and edited in the editor widget
 * @returns An editor widget for the cell
 */
export function CellEditorMonacoWidget({ cell }: { cell: PositronNotebookCellGeneral }) {
	const { containerRef, focusTargetRef } = useCellEditorWidget(cell);

	/**
	 * Observe outputs reactively so hasOutputs updates when outputs are added/removed.
	 * For code cells, cell.outputs is an observable; for markdown cells it's undefined.
	 * When undefined, useObservedValue returns the default empty array.
	 */
	const outputs = useObservedValue(cell.outputs, []);

	/**
	 * Skip focus trap when cell has no outputs (avoids double-tab with same visual).
	 * When there are no outputs, the focus trap and cell container share the same visual
	 * styling, requiring users to tab twice to see any change.
	 */
	const hasOutputs = outputs.length > 0;

	/**
	 * Handler for keyboard events on the focus target.
	 * When Enter is pressed, focuses the Monaco editor to enter edit mode.
	 *
	 * @param e Keyboard event from the focus target element
	 */
	const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			// Focus the Monaco editor to enter edit mode
			cell.currentEditor?.focus();
		}
	};

	return <>
		{/* Container in which the editor appends its DOM node.
		* React doesn't own the editor's DOM node so that it can be
		* reparented to another CellEditorMonacoWidget. */}
		<div
			ref={containerRef}
			className='positron-cell-editor-container'
		/>
		<div
			ref={focusTargetRef}
			aria-label={localize('editCell', 'Edit cell - Press Enter to edit')}
			className='positron-cell-editor-focus-target'
			role='button'
			// Skip focus trap when no outputs - see hasOutputs comment above for details
			tabIndex={hasOutputs ? 0 : -1}
			onKeyDown={handleKeyDown}
		/>
	</>;
}

function createCellEditor(
	cell: PositronNotebookCellGeneral,
	instance: IPositronNotebookInstance,
	configurationService: IConfigurationService,
	contextKeyService: IContextKeyService,
	logService: ILogService,
): CellEditor {
	if (!cell.scopedContextKeyService) {
		throw new Error('Cell does not have a scoped context key service');
	}

	const disposables = new DisposableStore();

	const language = cell.model.language;

	const cellEditor = disposables.add(new CellEditor(
		cell.scopedContextKeyService,
		instance.scopedInstantiationService
	));
	const { element } = cellEditor;

	const editorOptions = disposables.add(new PositronCellEditorOptions(instance, language, configurationService));

	const editor = disposables.add(cellEditor.scopedInstantiationService.createInstance(
		CodeEditorWidget,
		element,
		{
			...getInitialCellEditorOptions(),
			// TODO: Do we need dim 0?
			// Initially set the editor size to 0x0.
			dimension: {
				width: 0,
				height: 0,
			}
		},
		{ contributions: getNotebookEditorContributions() }
	));
	cell.attachEditor(editor);

	// Re-apply options when they change so the open notebook
	// updates without requiring a reload.
	disposables.add(editorOptions.onDidChange(() => {
		editor.updateOptions(editorOptions.getValue());
	}));
	editor.updateOptions(editorOptions.getValue());

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
	const editorContainer = editor.getContainerDomNode();
	const nativeMouseDownHandler = (e: MouseEvent) => {
		hadModifierMouseDown = e.shiftKey || e.ctrlKey || e.metaKey;
	};
	disposables.add(addDisposableListener(editorContainer, 'mousedown', nativeMouseDownHandler, true));

	// Also handle multi-selection from editor.onMouseDown (fires after
	// focus) as a secondary path for cases where the focus handler
	// couldn't prevent enterEditor in time.
	disposables.add(editor.onMouseDown((e) => {
		if (e.event.shiftKey || e.event.ctrlKey || e.event.metaKey) {
			instance.selectionStateMachine.selectCell(cell, CellSelectionType.Add);
		}
	}));

	disposables.add(editor.onDidFocusEditorWidget(() => {
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
		instance.selectionStateMachine.enterEditor(cell);
		cellEditorFocusedKey.set(true);
	}));

	disposables.add(editor.onDidBlurEditorWidget(() => {
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
			instance.selectionStateMachine.exitEditor(cell);
			return;
		}

		const contextKeyContext = contextKeyService.getContext(activeElement);

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
		if (instance.currentContainer?.contains(activeElement)) {
			return;
		}

		// Focus has truly left the notebook editor - exit edit mode
		// Pass the cell so we only exit if THIS specific cell is being edited (not a different one)
		// This handles the race condition where a user clicks from one cell editor into another.
		instance.selectionStateMachine.exitEditor(cell);
	}));

	/**
	 * Resize the editor widget to fill the width of its container and the height of its
	 * content.
	 * @param height Height to set. Defaults to checking content height.
	 */
	function resizeEditor(height: number = editor.getContentHeight()) {
		editor.layout({
			height,
			width: element.offsetWidth,
		});
	}

	// Resize the editor when its content size changes
	disposables.add(editor.onDidContentSizeChange(e => {
		if (!(e.contentHeightChanged || e.contentWidthChanged)) { return; }
		resizeEditor(e.contentHeight);
	}));

	// Resize the editor as the window resizes.
	disposables.add(autorun(reader => {
		instance.size.read(reader);
		resizeEditor();
	}));

	cellEditor.register(disposables);

	logService.debug('Positron Notebook | useCellEditorWidget() | Setting up editor widget');

	return cellEditor;
}

/**
 * Create a cell editor widget for a cell.
 * @param cell Cell whose editor is to be created
 * @returns The editor container ref and the focus-target ref
 */
export function useCellEditorWidget(cell: PositronNotebookCellGeneral) {
	const services = usePositronReactServicesContext();
	const instance = useNotebookInstance();

	// Container in which the editor appends its DOM node.
	// React doesn't own the editor's DOM node so that it can be
	// reparented to another CellEditorMonacoWidget.
	const containerRef = React.useRef<HTMLDivElement>(null);

	// Create the editor
	React.useEffect(() => {
		if (!containerRef.current || !cell.scopedContextKeyService) { return; }
		const editor = createCellEditor(
			cell,
			instance,
			services.configurationService,
			services.contextKeyService,
			services.logService
		);
		containerRef.current.appendChild(editor.element);

		return () => {
			services.logService.debug('Positron Notebook | useCellEditorWidget() | Disposing editor widget');
			editor.element.remove();
			editor.dispose();
			cell.detachEditor();
		};
	}, [cell, instance, services.configurationService, services.contextKeyService, services.logService]);

	// Watch for editor focus requests from the cell
	React.useLayoutEffect(() => {
		// Subscribe to focus request signal - triggers whenever requestEditorFocus() is called
		const disposable = autorun(reader => {
			cell.editorFocusRequested.read(reader);
			const editor = cell.currentEditor;
			// Check if THIS cell is still the one being edited
			// This prevents stale focus requests when user rapidly navigates between cells
			const state = instance.selectionStateMachine.state.read(reader);
			const shouldFocus = state.type === SelectionState.EditingSelection && state.active === cell;

			if (!shouldFocus) {
				return;
			}

			if (editor) {
				editor.focus();
			}
		});

		return () => disposable.dispose();
	}, [cell, instance.selectionStateMachine]);

	// Create a ref for the focus target element
	const focusTargetRef = React.useRef<HTMLDivElement>(null);

	// Watch for exit-editor transitions to return focus to the focus trap
	React.useEffect(() => {
		let pendingFrame: number | undefined;
		const disposable = autorunDelta(instance.selectionStateMachine.state, ({ lastValue, newValue }) => {
			// Check if we transitioned from editing THIS cell to single selection of THIS cell
			if (lastValue?.type === SelectionState.EditingSelection &&
				lastValue.active === cell &&
				newValue.type === SelectionState.SingleSelection &&
				newValue.active === cell) {
				// Don't steal focus if the user navigated to a different editor
				// (e.g. clicking a cell in a side-by-side notebook). This mirrors
				// the guard in the onDidBlurEditorWidget handler above.
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
						focusTargetRef.current?.focus();
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
			}
		});
		return () => {
			disposable.dispose();
			if (pendingFrame !== undefined) {
				getWindow(cell.container).cancelAnimationFrame(pendingFrame);
			}
		};
	}, [cell, instance.currentContainer, instance.selectionStateMachine]);

	return { containerRef, focusTargetRef };
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

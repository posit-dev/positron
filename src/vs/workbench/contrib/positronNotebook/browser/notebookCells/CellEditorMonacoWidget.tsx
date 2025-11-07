/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellEditorMonacoWidget.css';

// React.
import React from 'react';

import { EditorExtensionsRegistry, IEditorContributionDescription } from '../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';

import { FloatingEditorClickMenu } from '../../../../browser/codeeditor.js';
import { CellEditorOptions } from '../../../notebook/browser/view/cellParts/cellEditorOptions.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useEnvironment } from '../EnvironmentProvider.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { autorun } from '../../../../../base/common/observable.js';
import { POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED } from '../ContextKeysManager.js';
import { SelectionState } from '../selectionMachine.js';
import { InQuickPickContextKey } from '../../../../browser/quickaccess.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';

/**
 *
 * @param opts.cell Cell to be shown and edited in the editor widget
 * @returns An editor widget for the cell
 */
export function CellEditorMonacoWidget({ cell }: { cell: PositronNotebookCellGeneral }) {
	const { editorPartRef } = useCellEditorWidget(cell);
	return <div
		ref={editorPartRef}
		className='positron-cell-editor-monaco-widget'
	/>;
}

/**
 * Create a cell editor widget for a cell.
 * @param cell Cell whose editor is to be created
 * @returns Refs to place the editor and the wrapping div
 */
export function useCellEditorWidget(cell: PositronNotebookCellGeneral) {
	const services = usePositronReactServicesContext();
	const environment = useEnvironment();
	const instance = useNotebookInstance();
	const cellContextKeyService = useCellScopedContextKeyService();

	// Create an element ref to contain the editor
	const editorPartRef = React.useRef<HTMLDivElement>(null);

	// Create the editor
	React.useEffect(() => {
		if (!editorPartRef.current) { return; }

		// If there's no scoped instantiation service yet, wait for the next run
		if (!instance.scopedInstantiationService) { return; }

		const disposables = new DisposableStore();

		const language = cell.model.language;

		const editorOptions = new CellEditorOptions(instance.getBaseCellEditorOptions(language), instance.notebookOptions, services.configurationService);

		// Use the notebook's scoped instantiation service which includes notebook-specific context keys
		// and services that Monaco editors need.
		// Note: Monaco will create its own scoped context key service as a child of the parent
		// instantiation service. This avoids the double-scoping error that occurred when we
		// explicitly created one.
		const editor = disposables.add(instance.scopedInstantiationService.createInstance(CodeEditorWidget, editorPartRef.current, {
			...editorOptions.getDefaultValue(),
			dimension: {
				width: 0,
				height: 0,
			},
		}, {
			contributions: getNotebookEditorContributions()
		}));
		cell.attachEditor(editor);

		// Request model for cell and pass to editor.
		cell.getTextEditorModel().then(model => {
			editor.setModel(model);
		});

		// Bind the cell editor focused context key to the editor's internal scoped service
		// (CodeEditorWidget creates this synchronously in its constructor)
		const cellEditorFocusedKey = POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.bindTo(editor.contextKeyService);

		disposables.add(editor.onDidFocusEditorWidget(() => {
			// enterEditor() automatically detects that editor has focus and skips focus management
			instance.selectionStateMachine.enterEditor(cell);
			cellEditorFocusedKey.set(true);
		}));

		disposables.add(editor.onDidBlurEditorWidget(() => {
			cellEditorFocusedKey.set(false);

			// Check where focus moved to - don't exit edit mode if focus moved to VS Code overlays
			// or is still within the notebook editor scope.
			// This prevents the command palette, quick open, find widget, etc. from closing
			// immediately when opened from a cell in edit mode.
			const activeElement = editor.getContainerDomNode().ownerDocument.activeElement;
			if (activeElement) {
				// Get the context of where focus moved to
				const contextKeyContext = services.contextKeyService.getContext(activeElement);

				// Don't exit edit mode if focus moved to quick pick (command palette, quick open, etc.)
				if (contextKeyContext.getValue(InQuickPickContextKey.key)) {
					return;
				}

				// Don't exit edit mode if focus moved to another editor (e.g., find widget input)
				if (contextKeyContext.getValue(EditorContextKeys.textInputFocus.key)) {
					return;
				}

				// Don't exit edit mode if focus is still within the notebook editor container
				// This covers both internal focus changes (cell to cell) and focus on notebook UI elements
				const notebookContainer = instance.container;
				if (notebookContainer?.contains(activeElement)) {
					return;
				}
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
			if (!editorPartRef.current) { return; }
			editor.layout({
				height,
				width: editorPartRef.current.offsetWidth,
			});
		}

		// Resize the editor when its content size changes
		disposables.add(editor.onDidContentSizeChange(e => {
			if (!(e.contentHeightChanged || e.contentWidthChanged)) { return; }
			resizeEditor(e.contentHeight);
		}));

		// Resize the editor as the window resizes.
		disposables.add(autorun(reader => {
			environment.size.read(reader);
			resizeEditor();
		}));

		services.logService.debug('Positron Notebook | useCellEditorWidget() | Setting up editor widget');

		return () => {
			services.logService.debug('Positron Notebook | useCellEditorWidget() | Disposing editor widget');
			disposables.dispose();
			cell.detachEditor();
		};
	}, [cell, environment, instance, services.configurationService, services.contextKeyService, services.logService]);

	// If the cell-scoped context key service becomes available after the editor was created,
	// update the editor's context key service parent to use the cell-scoped one
	React.useEffect(() => {
		const disposable = autorun(reader => {
			const editor = cell.editorObservable.read(reader);
			if (!editor || !cellContextKeyService) {
				return;
			}

			// Update the editor's context key service to inherit from the cell-scoped one
			editor.contextKeyService.updateParent(cellContextKeyService);
		});
		return () => disposable.dispose();
	}, [cell, cellContextKeyService, services.logService]);

	// Watch for editor focus requests from the cell
	React.useLayoutEffect(() => {
		// Subscribe to focus request signal - triggers whenever requestEditorFocus() is called
		const disposable = autorun(reader => {
			cell.editorFocusRequested.read(reader);
			const editor = cell.editor;
			// Check if THIS cell is still the one being edited
			// This prevents stale focus requests when user rapidly navigates between cells
			const state = instance.selectionStateMachine.state.read(reader);
			const shouldFocus = state.type === SelectionState.EditingSelection && state.selected === cell;

			if (!shouldFocus) {
				return;
			}

			if (editor) {
				editor.focus();
			}
		});

		return () => disposable.dispose();
	}, [cell, instance.selectionStateMachine]);

	return { editorPartRef };
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

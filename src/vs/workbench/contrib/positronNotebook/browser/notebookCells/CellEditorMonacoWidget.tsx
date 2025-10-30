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

import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { IEditorProgressService } from '../../../../../platform/progress/common/progress.js';
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

	// Create an element ref to contain the editor
	const editorPartRef = React.useRef<HTMLDivElement>(null);

	// Create the editor
	React.useEffect(() => {
		if (!editorPartRef.current) { return; }

		const disposables = new DisposableStore();

		const language = cell.cellModel.language;

		// We need to ensure the EditorProgressService (or a fake) is available
		// in the service collection because monaco editors will try and access
		// it even though it's not available in the notebook context. This feels
		// hacky but VSCode notebooks do the same thing so I guess it's easier
		// than fixing it at the monaco level.
		//
		// Note: We don't pass IContextKeyService here. Monaco will create its own
		// scoped service as a child of the parent instantiation service. This avoids
		// the double-scoping error that occurred when we explicitly created one.
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
					async showWhile(promise: Promise<any>): Promise<void> {
						await promise;
					}
				}]
		);

		const editorInstaService = services.instantiationService.createChild(serviceCollection);
		const editorOptions = new CellEditorOptions(instance.getBaseCellEditorOptions(language), instance.notebookOptions, services.configurationService);

		const editor = disposables.add(editorInstaService.createInstance(CodeEditorWidget, editorPartRef.current, {
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
	}, [cell, environment, instance, services.configurationService, services.instantiationService, services.logService]);

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

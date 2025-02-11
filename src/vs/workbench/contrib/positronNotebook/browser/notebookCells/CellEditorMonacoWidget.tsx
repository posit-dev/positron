/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellEditorMonacoWidget.css';

// React.
import React from 'react';

import * as DOM from '../../../../../base/browser/dom.js';
import { EditorExtensionsRegistry, IEditorContributionDescription } from '../../../../../editor/browser/editorExtensions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { Event } from '../../../../../base/common/event.js';

import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { FloatingEditorClickMenu } from '../../../../browser/codeeditor.js';
import { CellEditorOptions } from '../../../notebook/browser/view/cellParts/cellEditorOptions.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useServices } from '../ServicesProvider.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';

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

// Padding for the editor widget. The sizing is not perfect but this helps the editor not overflow
// its container. In the future we should figure out how to make sure this is sized correctly.
const EDITOR_INSET_PADDING_PX = 1;

/**
 * Create a cell editor widget for a cell.
 * @param cell Cell whose editor is to be created
 * @returns Refs to place the editor and the wrapping div
 */
export function useCellEditorWidget(cell: PositronNotebookCellGeneral) {
	const services = useServices();
	const instance = useNotebookInstance();

	const sizeObservable = services.sizeObservable;

	// Grab the wrapping div for the editor. This is used for passing context key service
	const editorPartRef = React.useRef<HTMLDivElement>(null);
	// Grab a ref to the div that will hold the editor. This is needed to pass an element to the
	// editor creation function.


	// Create the editor
	React.useEffect(() => {
		if (!editorPartRef.current) { return; }

		const disposableStore = new DisposableStore();

		// We need to use a native dom element here instead of a react ref one because the elements
		// created by react's refs are not _true_ dom elements and thus calls like `refEl instanceof
		// HTMLElement` will return false. This is a problem when we hand the elements into the
		// editor widget as it expects a true dom element.
		const nativeContainer = DOM.$('.positron-monaco-editor-container');
		editorPartRef.current.appendChild(nativeContainer);

		const language = cell.cellModel.language;
		const editorContextKeyService = services.scopedContextKeyProviderCallback(editorPartRef.current);
		disposableStore.add(editorContextKeyService);
		const editorInstaService = services.instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
		const editorOptions = new CellEditorOptions(instance.getBaseCellEditorOptions(language), instance.notebookOptions, services.configurationService);


		const editor = editorInstaService.createInstance(CodeEditorWidget, nativeContainer, {
			...editorOptions.getDefaultValue(),
			// Turns off the margin of the editor. This should probably be placed in a settable
			// option somewhere eventually.
			glyphMargin: false,
			dimension: {
				width: 500,
				height: 200
			},
		}, {
			contributions: getNotebookEditorContributions()
		});
		disposableStore.add(editor);
		cell.attachEditor(editor);

		editor.setValue(cell.getContent());

		disposableStore.add(
			editor.onDidFocusEditorWidget(() => {
				instance.setEditingCell(cell);
			})
		);

		disposableStore.add(
			editor.onDidBlurEditorWidget(() => {
			})
		);


		/**
		 * Resize the editor widget to fill the width of its container and the height of its
		 * content.
		 * @param height Height to set. Defaults to checking content height.
		 */
		function resizeEditor(height: number = editor.getContentHeight()) {
			editor.layout({
				height,
				width: (editorPartRef.current?.offsetWidth ?? 500) - EDITOR_INSET_PADDING_PX * 2
			});
		}

		// Request model for cell and pass to editor.
		cell.getTextEditorModel().then(model => {
			editor.setModel(model);
			resizeEditor();

			editor.onDidContentSizeChange(e => {
				if (!(e.contentHeightChanged || e.contentWidthChanged)) { return; }
				resizeEditor(e.contentHeight);
			});
		});

		// Keep the width up-to-date as the window resizes.

		disposableStore.add(Event.fromObservable(sizeObservable)(() => {
			resizeEditor();
		}));

		services.logService.info('Positron Notebook | useCellEditorWidget() | Setting up editor widget');


		return () => {
			services.logService.info('Positron Notebook | useCellEditorWidget() | Disposing editor widget');
			disposableStore.dispose();
			nativeContainer.remove();
			cell.detachEditor();
		};
	}, [cell, instance, services, sizeObservable]);



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

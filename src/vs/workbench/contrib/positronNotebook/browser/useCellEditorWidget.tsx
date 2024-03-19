/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';

import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { CellEditorOptions } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellEditorOptions';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { PositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { observeValue } from 'vs/workbench/contrib/positronNotebook/common/utils/observeValue';

/**
 * Create a cell editor widget for a cell.
 * @param cell Cell whose editor is to be created
 * @returns Refs to place the editor and the wrapping div
 */
export function useCellEditorWidget({ cell }: { cell: PositronNotebookCell }) {
	const services = useServices();
	const instance = useNotebookInstance();

	const sizeObservable = services.sizeObservable;

	// Grab the wrapping div for the editor. This is used for passing context key service
	const editorPartRef = React.useRef<HTMLDivElement>(null);
	// Grab a ref to the div that will hold the editor. This is needed to pass an element to the
	// editor creation function.


	// Create the editor
	React.useEffect(() => {
		if (!editorPartRef.current) {
			console.log('no editor part or container');
			return;
		}

		// We need to use a native dom element here instead of a react ref one because the elements
		// created by react's refs are not _true_ dom elements and thus calls like `refEl instanceof
		// HTMLElement` will return false. This is a problem when we hand the elements into the
		// editor widget as it expects a true dom element.
		const nativeContainer = DOM.$('.positron-monaco-editor-container');
		editorPartRef.current.appendChild(nativeContainer);

		const language = cell.viewModel.language;
		const editorContextKeyService = services.scopedContextKeyProviderCallback(editorPartRef.current);
		const editorInstaService = services.instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
		const editorOptions = new CellEditorOptions(instance.getBaseCellEditorOptions(language), instance.notebookOptions, services.configurationService);
		const editorContributions = instance.creationOptions?.cellEditorContributions ?? [];

		const editor = editorInstaService.createInstance(CodeEditorWidget, nativeContainer, {
			...editorOptions.getDefaultValue(),
			dimension: {
				width: 500,
				height: 200
			},
		}, {
			contributions: editorContributions
		});


		editor.setValue(cell.getContent());


		/**
		 * Resize the editor widget to fill the width of its container and the height of its
		 * content.
		 * @param height Height to set. Defaults to checking content height.
		 */
		function resizeEditor(height: number = editor.getContentHeight()) {
			editor.layout({
				height,
				width: editorPartRef.current?.offsetWidth ?? 500
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
		const sizeObserver = observeValue(sizeObservable, {
			handleChange() {
				resizeEditor();
			}
		});

		services.logService.info('Positron Notebook | useCellEditorWidget() | Setting up editor widget');


		return () => {
			services.logService.info('Positron Notebook | useCellEditorWidget() | Disposing editor widget');
			editor.dispose();
			nativeContainer.remove();
			editorContextKeyService.dispose();
			sizeObserver();
		};
	}, [cell, instance, services, sizeObservable]);



	return { editorPartRef };

}



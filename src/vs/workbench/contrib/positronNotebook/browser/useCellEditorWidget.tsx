/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as React from 'react';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';

/**
 * Create a cell editor widget for a cell.
 * @param cell Cell whose editor is to be created
 * @returns Refs to place the editor and the wrapping div
 */
export function useCellEditorWidget(cell: NotebookCellTextModel) {
	const { instantiationService } = useServices();
	console.log('instantiationService', instantiationService);

	// Grab the wrapping div for the editor. This is used for passing context key service
	// TODO: Understand this better.
	const editorPartRef = React.useRef<HTMLDivElement>(null);
	// Grab a ref to the div that will hold the editor. This is needed to pass an element to the
	// editor creation function.
	const editorContainerRef = React.useRef<HTMLDivElement>(null);

	// Create the editor
	React.useEffect(() => {
		if (!editorPartRef.current) {
			return;
		}

		// const editorContextKeyService = templateDisposables.add(this.contextKeyServiceProvider(editorPart));
		// const editorInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
		// const editor = editorInstaService.createInstance(CodeEditorWidget, editorContainer, {
		// 	...this.editorOptions.getDefaultValue(),
		// 	dimension: {
		// 		width: 0,
		// 		height: 0
		// 	},
		// }, {
		// 	contributions: this.notebookEditor.creationOptions.cellEditorContributions
		// });
		// // const editor = instantiationService.createInstance(???, editorHolderRef.current);
		// editor.setValue(cell.getValue());
		// editor.layout();
	}, [editorPartRef, cell]);

	return { editorPartRef, editorContainerRef };

}

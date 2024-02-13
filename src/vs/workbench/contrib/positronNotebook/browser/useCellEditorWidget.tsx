/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as React from 'react';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { useDisposableStore } from './useDisposableStore';
import { useContextKeyServiceProvider } from 'vs/workbench/contrib/positronNotebook/browser/ContextKeyServiceProvider';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { CellEditorOptions } from 'vs/workbench/contrib/notebook/browser/view/cellParts/cellEditorOptions';

/**
 * Create a cell editor widget for a cell.
 * @param cell Cell whose editor is to be created
 * @returns Refs to place the editor and the wrapping div
 */
export function useCellEditorWidget(cell: NotebookCellTextModel) {
	const services = useServices();
	const templateDisposables = useDisposableStore();
	console.log('instantiationService', services.instantiationService);

	// Grab the wrapping div for the editor. This is used for passing context key service
	// TODO: Understand this better.
	const editorPartRef = React.useRef<HTMLDivElement>(null);
	// Grab a ref to the div that will hold the editor. This is needed to pass an element to the
	// editor creation function.
	const editorContainerRef = React.useRef<HTMLDivElement>(null);

	const contextKeyServiceProvider = useContextKeyServiceProvider();

	// Create the editor
	React.useEffect(() => {
		if (!editorPartRef.current || !editorContainerRef.current) {
			console.log('no editor part or container');
			return;
		}

		const language = cell.language;
		const editorContextKeyService = templateDisposables.add(contextKeyServiceProvider(editorPartRef.current));
		const editorInstaService = services.instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
		const editorOptions = new CellEditorOptions(services.notebookWidget.getBaseCellEditorOptions(language), services.notebookWidget.notebookOptions, services.configurationService);
		const editorContributions = services.notebookWidget.creationOptions?.cellEditorContributions ?? [];

		const editor = editorInstaService.createInstance(CodeEditorWidget, editorContainerRef.current, {
			...editorOptions.getDefaultValue(),
			dimension: {
				width: 500,
				height: 200
			},
		}, {
			contributions: editorContributions
		});

		console.log('setup editor', editor);
		editor.setValue(cell.getValue());
		editor.layout();
	}, [cell, contextKeyServiceProvider, services.configurationService, services.instantiationService, services.notebookWidget, templateDisposables]);

	return { editorPartRef, editorContainerRef };

}



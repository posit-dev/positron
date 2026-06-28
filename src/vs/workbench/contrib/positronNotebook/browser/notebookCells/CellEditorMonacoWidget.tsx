/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellEditorMonacoWidget.css';

// React.
import React from 'react';

// Other dependencies.
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 *
 * @param opts.cell Cell to be shown and edited in the editor widget
 * @returns An editor widget for the cell
 */
export function CellEditorMonacoWidget({ cell }: { cell: PositronNotebookCellGeneral }) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const services = usePositronReactServicesContext();
	const { logService } = services;
	const instance = useNotebookInstance();

	// Create the editor
	React.useEffect(() => {
		if (!containerRef.current || !cell.scopedInstantiationService) {
			return;
		}
		const disposables = new DisposableStore();

		const ref = disposables.add(instance.cellEditorPool.get(cell.uri.toString()));
		const cellEditor = ref.object;
		containerRef.current.appendChild(cellEditor.container);
		containerRef.current.appendChild(cellEditor.focusTarget);
		cellEditor.setCell(cell);

		// TODO: Maybe this should happen somewhere else?...
		cell.attachEditor(cellEditor);

		// Request model for cell and pass to editor.
		// TODO: When/how to do this part?...
		// TODO: codeBlockPart does an interesting thing here where they
		//   use their own text model but still create a model reference
		//   to its uri to stop it from getting disposed when other consumers
		//   acquire/release it. We have the text model from the notebook so
		//   maybe we can do the same.
		cell.getTextEditorModel().then(model => {
			cellEditor.editor.setModel(model);
		});

		logService.debug('Positron Notebook | useCellEditorWidget() | Setting up editor widget');

		return () => {
			logService.debug('Positron Notebook | useCellEditorWidget() | Disposing editor widget');
			disposables.dispose();
			cell.detachEditor();
			cellEditor.reset();
		};
	}, [cell, instance, logService]);

	return <div ref={containerRef} className='positron-cell-editor-wrapper' />;
}

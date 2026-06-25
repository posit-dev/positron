/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellEditorMonacoWidget.css';

// React.
import React from 'react';

// Other dependencies.
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useEnvironment } from '../EnvironmentProvider.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';
import { CellEditor } from './CellEditor.js';
import { NotebookCellEditorDelegate } from './notebookCellEditorDelegate.js';

/**
 *
 * @param opts.cell Cell to be shown and edited in the editor widget
 * @returns An editor widget for the cell
 */
export function CellEditorMonacoWidget({ cell }: { cell: PositronNotebookCellGeneral }) {
	const environment = useEnvironment();
	const instance = useNotebookInstance();

	const mountRef = React.useRef<HTMLDivElement>(null);

	// Create the editor. CellEditor owns all of the editor's imperative
	// behavior and DOM; the widget only supplies the mount point and notebook
	// context, then appends the editor's root element into the mount point.
	React.useEffect(() => {
		if (!mountRef.current || !cell.scopedContextKeyService) { return; }

		const delegate = new NotebookCellEditorDelegate(instance, environment.size);
		const cellEditor = instance.scopedInstantiationService.createInstance(
			CellEditor,
			cell,
			delegate,
		);
		mountRef.current.appendChild(cellEditor.element);

		return () => cellEditor.dispose();
	}, [cell, environment, instance]);

	// CellEditor owns its DOM (editor container + focus target); we only render
	// a mount point and let it append its root element here.
	return <div ref={mountRef} className='positron-cell-editor-mount' />;
}

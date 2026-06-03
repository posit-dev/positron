/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellEditorMonacoWidget.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';

import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { PositronNotebookCellGeneral } from '../PositronNotebookCells/PositronNotebookCell.js';
import { useObservedValue } from '../useObservedValue.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { NotebookCellEditor } from './NotebookCellEditor.js';

/**
 *
 * @param opts.cell Cell to be shown and edited in the editor widget
 * @returns An editor widget for the cell
 */
export function CellEditorMonacoWidget({ cell }: { cell: PositronNotebookCellGeneral }) {
	const editorPartRef = React.useRef<HTMLDivElement>(null);
	const focusTargetRef = React.useRef<HTMLDivElement>(null);
	const services = usePositronReactServicesContext();
	const { logService } = services;
	const instance = useNotebookInstance();

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

	// Create the editor
	React.useEffect(() => {
		if (!editorPartRef.current ||
			!focusTargetRef.current ||
			!cell.scopedInstantiationService) {
			return;
		}
		const disposables = new DisposableStore();

		const cellEditor = disposables.add(cell.scopedInstantiationService.createInstance(
			NotebookCellEditor,
			editorPartRef.current,
			focusTargetRef.current,
			cell,
			instance,
		));
		const { editor } = cellEditor;
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
			editor.setModel(model);
		});

		logService.debug('Positron Notebook | useCellEditorWidget() | Setting up editor widget');

		return () => {
			logService.debug('Positron Notebook | useCellEditorWidget() | Disposing editor widget');
			disposables.dispose();
			cell.detachEditor();
		};
	}, [cell, instance, logService]);

	return <>
		<div
			ref={editorPartRef}
			className='positron-cell-editor-monaco-widget'
			tabIndex={-1}
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

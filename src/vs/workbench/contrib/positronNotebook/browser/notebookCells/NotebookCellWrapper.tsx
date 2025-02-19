/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookCellWrapper.css';

// React.
import React from 'react';

// Other dependencies.
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { CellSelectionStatus, IPositronNotebookCell } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { CellSelectionType } from '../../../../services/positronNotebook/browser/selectionMachine.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useSelectionStatus } from './useSelectionStatus.js';
import { useObservedValue } from '../useObservedValue.js';

export function NotebookCellWrapper({ cell, children }: { cell: IPositronNotebookCell; children: React.ReactNode }) {
	const cellRef = React.useRef<HTMLDivElement>(null);
	const selectionStateMachine = useNotebookInstance().selectionStateMachine;
	const selectionStatus = useSelectionStatus(cell);
	const executionStatus = useObservedValue(cell.executionStatus);

	React.useEffect(() => {
		if (cellRef.current) {
			// Attach the container to the cell instance can properly control focus.
			cell.attachContainer(cellRef.current);
		}
	}, [cell, cellRef]);

	return <div
		ref={cellRef}
		className={`positron-notebook-cell positron-notebook-${cell.kind === CellKind.Code ? 'code' : 'markdown'}-cell ${selectionStatus}`}
		data-is-running={executionStatus === 'running'}
		tabIndex={0}
		onClick={(e) => {
			const clickTarget = e.nativeEvent.target as HTMLElement;
			// If any of the element or its parents have the class
			// 'positron-cell-editor-monaco-widget' then don't run the select code as the editor
			// widget itself handles that logic
			const childOfEditor = clickTarget.closest('.positron-cell-editor-monaco-widget');
			if (childOfEditor || selectionStatus === CellSelectionStatus.Editing) {
				return;
			}

			// If the clicked element is a link, let it do its thing.
			if (clickTarget.tagName === 'A') {
				return;
			}

			if (selectionStatus === CellSelectionStatus.Selected) {
				cell.deselect();
				return;
			}
			const addMode = e.shiftKey || e.ctrlKey || e.metaKey;
			selectionStateMachine.selectCell(cell, addMode ? CellSelectionType.Add : CellSelectionType.Normal);
		}}
	>
		{children}
	</div>;
}

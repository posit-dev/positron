/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCellWrapper';

import * as React from 'react';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CellSelectionStatus, IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { CellSelectionType } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { useSelectionStatus } from './useSelectionStatus';

export function NotebookCellWrapper({ cell, children }: { cell: IPositronNotebookCell; children: React.ReactNode }) {
	const cellRef = React.useRef<HTMLDivElement>(null);
	const selectionStateMachine = useNotebookInstance().selectionStateMachine;
	const selectionStatus = useSelectionStatus(cell);

	React.useEffect(() => {
		if (cellRef.current) {
			// Attach the container to the cell instance can properly control focus.
			cell.attachContainer(cellRef.current);
		}
	}, [cell, cellRef]);

	return <div
		className={`positron-notebook-cell positron-notebook-${cell.kind === CellKind.Code ? 'code' : 'markdown'}-cell ${selectionStatus}`}
		ref={cellRef}
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

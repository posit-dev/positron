/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCellWrapper';

import * as React from 'react';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IPositronNotebookCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { CellSelectionType } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';

export function NotebookCellWrapper({ cell, children }: { cell: IPositronNotebookCell; children: React.ReactNode }) {
	const selected = useObservedValue(cell.selected);
	const editing = useObservedValue(cell.editing);
	const cellRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (cellRef.current) {
			// Attach the container to the cell instance can properly control focus.
			cell.attachContainer(cellRef.current);
		}
	}, [cell, cellRef]);

	const selectionClass = editing ? 'editing' : selected ? 'selected' : 'unselected';
	return <div
		className={`positron-notebook-cell positron-notebook-${cell.kind === CellKind.Code ? 'code' : 'markdown'}-cell ${selectionClass}`}
		ref={cellRef}
		tabIndex={0}
		onClick={(e) => {
			const clickTarget = e.nativeEvent.target as HTMLElement;
			// If any of the element or its parents have the class
			// 'positron-cell-editor-monaco-widget' then don't run the select code as the editor
			// widget itself handles that logic
			const childOfEditor = clickTarget.closest('.positron-cell-editor-monaco-widget');
			if (childOfEditor) {
				return;
			}
			if (selected) {
				cell.deselect();
				return;
			}
			const addMode = e.shiftKey || e.ctrlKey || e.metaKey;
			cell.select(addMode ? CellSelectionType.Add : CellSelectionType.Normal);
		}}
	>
		{children}
	</div>;
}

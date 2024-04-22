/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCellWrapper';

import * as React from 'react';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CellSelectionState, IPositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';

export function NotebookCellWrapper({ cell, children }: { cell: IPositronNotebookCell; children: React.ReactNode }) {
	const selected = useObservedValue(cell.selected);

	const selectionClass = selected === CellSelectionState.Selected ? 'selected' : selected === CellSelectionState.Editing ? 'editing' : 'unselected';
	return <div
		className={`positron-notebook-cell positron-notebook-${cell.kind === CellKind.Code ? 'code' : 'markdown'}-cell ${selectionClass}`}
		onClick={() => { cell.select(); }}
	>
		{children}
	</div>;
}

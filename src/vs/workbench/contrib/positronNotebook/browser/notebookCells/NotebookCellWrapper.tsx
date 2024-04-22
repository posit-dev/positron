/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCellWrapper';

import * as React from 'react';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IPositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';

export function NotebookCellWrapper({ cell, children }: { cell: IPositronNotebookCell; children: React.ReactNode }) {
	const selected = useObservedValue(cell.selected);
	return <div
		className={`positron-notebook-cell positron-notebook-${cell.kind === CellKind.Code ? 'code' : 'markdown'}-cell ${selected ? 'selected' : ''}`}
		onClick={() => { cell.select(); }}
	>
		{children}
	</div>;
}

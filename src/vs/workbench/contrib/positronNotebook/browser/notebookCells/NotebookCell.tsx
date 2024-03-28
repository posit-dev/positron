/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCell';

import * as React from 'react';
import { IPositronNotebookGeneralCell, isCodeCell, isMarkupCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { NodebookCodeCell } from './NodebookCodeCell';
import { NotebookMarkupCell } from './NotebookMarkupCell';


/**
 * Logic for running a cell and handling its output.
 * @param opts.cell The `PositronNotebookCell` to render
 */
export function NotebookCell({ cell }: {
	cell: IPositronNotebookGeneralCell;
}) {

	if (isCodeCell(cell)) {
		return <NodebookCodeCell cell={cell} />;
	}

	if (isMarkupCell(cell)) {
		return <NotebookMarkupCell cell={cell} />;
	}

	throw new Error('Unknown cell type');
}




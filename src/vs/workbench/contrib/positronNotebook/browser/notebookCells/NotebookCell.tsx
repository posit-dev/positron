/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as React from 'react';
import { IPositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { NodebookCodeCell } from './NodebookCodeCell';
import { NotebookMarkdownCell } from './NotebookMarkdownCell';


/**
 * Logic for running a cell and handling its output.
 * @param opts.cell The `PositronNotebookCell` to render
 */
export function NotebookCell({ cell }: {
	cell: IPositronNotebookCell;
}) {

	if (cell.isCodeCell()) {
		return <NodebookCodeCell cell={cell} />;
	}

	if (cell.isMarkdownCell()) {
		return <NotebookMarkdownCell cell={cell} />;
	}

	throw new Error('Unknown cell type');
}




/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./PositronNotebookComponent';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { AddCellButtons } from './AddCellButtons';
import { useObservedValue } from './useObservedValue';
import { localize } from 'vs/nls';
import { PositronNotebookHeader } from './PositronNotebookHeader';
import { IPositronNotebookCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { NotebookCodeCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCodeCell';
import { NotebookMarkdownCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookMarkdownCell';


export function PositronNotebookComponent() {
	const notebookInstance = useNotebookInstance();
	const notebookCells = useObservedValue(notebookInstance.cells);

	return (
		<div className='positron-notebook'>
			<PositronNotebookHeader notebookInstance={notebookInstance} />
			<div className='positron-notebook-cells-container'>
				{notebookCells?.length ? notebookCells?.map((cell, index) => <>
					<NotebookCell key={cell.viewModel.handle} cell={cell} />
					<AddCellButtons index={index + 1} />
				</>) : <div>{localize('noCells', 'No cells')}</div>
				}
			</div>
		</div>
	);
}

function NotebookCell({ cell }: {
	cell: IPositronNotebookCell;
}) {

	if (cell.isCodeCell()) {
		return <NotebookCodeCell cell={cell} />;
	}

	if (cell.isMarkdownCell()) {
		return <NotebookMarkdownCell cell={cell} />;
	}

	throw new Error('Unknown cell type');
}

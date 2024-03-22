/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookMarkupCell';

import * as React from 'react';
import { IPositronNotebookMarkupCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';

import { renderHtml } from 'vs/base/browser/renderHtml';
import { CellEditorMonacoWidget } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/CellEditorMonacoWidget';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { NotebookCellSkeleton } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellSkeleton';



export function NotebookMarkupCell({ cell }: { cell: IPositronNotebookMarkupCell }) {

	const renderedHtml = useObservedValue(cell.renderedHtml);

	return <NotebookCellSkeleton
		onDelete={() => cell.delete()}
		actionBarItems={null}
	>
		<CellEditorMonacoWidget cell={cell} />
		<div className='positron-notebook-markup-rendered'>
			{
				renderedHtml ? <div>{renderHtml(renderedHtml)}</div> : null
			}
		</div>
	</NotebookCellSkeleton>;
}

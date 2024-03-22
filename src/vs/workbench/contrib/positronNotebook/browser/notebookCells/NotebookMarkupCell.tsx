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
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';



export function NotebookMarkupCell({ cell }: { cell: IPositronNotebookMarkupCell }) {

	const renderedHtml = useObservedValue(cell.renderedHtml);
	const editorShown = useObservedValue(cell.editorShown);

	const showHideButton = <Button
		onPressed={() => {
			if (editorShown) {
				cell.hideEditor();
			} else {
				cell.showEditor();
			}
		}}
	>
		{editorShown ? 'Hide Editor' : 'Show Editor'}
	</Button>;

	return <NotebookCellSkeleton
		onDelete={() => cell.delete()}
		actionBarItems={showHideButton}
	>
		{editorShown ? <CellEditorMonacoWidget cell={cell} /> : null
		}
		<div className='positron-notebook-markup-rendered' onDoubleClick={() => {
			cell.toggleEditor();
		}}>
			{
				renderedHtml ? <div>{renderHtml(renderedHtml)}</div> : null
			}
		</div>
	</NotebookCellSkeleton>;
}

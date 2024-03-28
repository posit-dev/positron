/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookMarkdownCell';
import * as React from 'react';

import { IPositronNotebookMarkdownCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';

import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { CellEditorMonacoWidget } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/CellEditorMonacoWidget';
import { NotebookCellActionBar } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellActionBar';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { Markdown } from './Markdown';

export function NotebookMarkdownCell({ cell }: { cell: IPositronNotebookMarkdownCell }) {

	const markdownString = useObservedValue(cell.markdownString);
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

	return (
		<div className={`positron-notebook-cell ${editorShown ? 'editor-shown' : 'editor-hidden'}`}>
			<NotebookCellActionBar cell={cell}>
				{showHideButton}
			</NotebookCellActionBar>
			<div className='cell-contents'>
				{editorShown ? <CellEditorMonacoWidget cell={cell} /> : null}
				<div className='positron-notebook-markup-rendered' onDoubleClick={() => {
					cell.toggleEditor();
				}}>
					{
						markdownString ?
							<Markdown content={markdownString} />
							: <div className='empty-output-msg'>
								Empty markup cell. {editorShown ? '' : 'Double click to edit'}
							</div>
					}
				</div>
			</div>
		</div>
	);
}




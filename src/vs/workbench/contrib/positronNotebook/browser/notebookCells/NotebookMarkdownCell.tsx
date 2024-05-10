/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookMarkdownCell';
import * as React from 'react';

import { CellEditorMonacoWidget } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/CellEditorMonacoWidget';
import { NotebookCellActionBar } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellActionBar';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { Markdown } from './Markdown';
import { localize } from 'vs/nls';
import { ActionButton } from 'vs/workbench/contrib/positronNotebook/browser/utilityComponents/ActionButton';
import { NotebookCellWrapper } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellWrapper';
import { PositronNotebookMarkdownCell } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';

export function NotebookMarkdownCell({ cell }: { cell: PositronNotebookMarkdownCell }) {

	const markdownString = useObservedValue(cell.markdownString);
	const editorShown = useObservedValue(cell.editorShown);

	return (
		<NotebookCellWrapper cell={cell}>

			<NotebookCellActionBar cell={cell}>
				<ActionButton
					ariaLabel={editorShown ? localize('hideEditor', 'Hide editor') : localize('showEditor', 'Show editor')}
					onPressed={() => cell.run()} >
					<div className={`button-icon codicon ${editorShown ? 'codicon-run' : 'codicon-primitive-square'}`} />
				</ActionButton>
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
		</NotebookCellWrapper>
	);
}




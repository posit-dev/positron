/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookMarkdownCell.css';

// React.
import React from 'react';

// Other dependencies.
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget.js';
import { useObservedValue } from '../useObservedValue.js';
import { Markdown } from './Markdown.js';
import { NotebookCellWrapper } from './NotebookCellWrapper.js';
import { PositronNotebookMarkdownCell } from '../PositronNotebookCells/PositronNotebookMarkdownCell.js';

export function NotebookMarkdownCell({ cell }: { cell: PositronNotebookMarkdownCell }) {

	const markdownString = useObservedValue(cell.markdownString);
	const editorShown = useObservedValue(cell.editorShown);

	return (
		<NotebookCellWrapper
			cell={cell}
		>
			<div className='cell-contents positron-notebook-cell-outputs'>
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




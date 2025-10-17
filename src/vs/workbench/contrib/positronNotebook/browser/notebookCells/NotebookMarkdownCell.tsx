/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
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
import { useNotebookInstance } from '../NotebookInstanceProvider.js';

export function NotebookMarkdownCell({ cell }: { cell: PositronNotebookMarkdownCell }) {

	const notebookInstance = useNotebookInstance();
	const markdownString = useObservedValue(cell.markdownString);
	const editorShown = useObservedValue(cell.editorShown);

	return (
		<NotebookCellWrapper
			cell={cell}
		>
			<div className={`positron-notebook-editor-container ${editorShown ? '' : 'editor-hidden'}`}>
				{editorShown ? <CellEditorMonacoWidget cell={cell} /> : null}
			</div>
			<div className='cell-contents positron-notebook-cell-outputs'>
				<div
					className='positron-notebook-markup-rendered'
					onDoubleClick={(e) => {
						// Prevent bubbling to wrapper's onClick and default browser behavior
						e.stopPropagation();
						e.preventDefault();
						// Enter edit mode for this cell
						notebookInstance.selectionStateMachine.enterEditor(cell);
					}}
				>
					{
						markdownString.length > 0 ?
							<Markdown content={markdownString} />
							: <div className='empty-output-msg'>
								Empty markup cell. {editorShown ? '' : 'Double click to edit.'}
							</div>
					}
				</div>
			</div>
		</NotebookCellWrapper>
	);
}




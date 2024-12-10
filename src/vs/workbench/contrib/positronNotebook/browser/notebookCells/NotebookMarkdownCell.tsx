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
import { NotebookCellActionBar } from './NotebookCellActionBar.js';
import { useObservedValue } from '../useObservedValue.js';
import { Markdown } from './Markdown.js';
import { localize } from '../../../../../nls.js';
import { ActionButton } from '../utilityComponents/ActionButton.js';
import { NotebookCellWrapper } from './NotebookCellWrapper.js';
import { PositronNotebookMarkdownCell } from '../PositronNotebookCells/PositronNotebookMarkdownCell.js';

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




/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookMarkdownCell.css';

// Other dependencies.
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget.js';
import { useObservedValue } from '../useObservedValue.js';
import { Markdown } from './Markdown.js';
import { NotebookCellWrapper } from './NotebookCellWrapper.js';
import { PositronNotebookMarkdownCell } from '../PositronNotebookCells/PositronNotebookMarkdownCell.js';
import { localize } from '../../../../../nls.js';
import { useMarkdownCellContextMenu } from './useMarkdownCellContextMenu.js';

// Localized strings.
const emptyMarkdownCell = localize('positron.notebooks.markdownCell.empty', "Empty markdown cell.");
const doubleClickToEdit = localize('positron.notebooks.markdownCell.doubleClickToEdit', " Double click to edit.");
const renderedMarkdownContent = localize('positron.notebooks.markdownCell.renderedContent', "Rendered markdown content");

export function NotebookMarkdownCell({ cell }: { cell: PositronNotebookMarkdownCell }) {

	const markdownString = useObservedValue(cell.markdownString);
	const editorShown = useObservedValue(cell.editorShown);
	const { showCellContextMenu } = useMarkdownCellContextMenu(cell);

	const handleContextMenu = (event: React.MouseEvent) => {
		event.preventDefault();
		showCellContextMenu({ x: event.clientX, y: event.clientY });
	};

	return (
		<NotebookCellWrapper
			cell={cell}
		>
			<div className={`positron-notebook-editor-container ${editorShown ? '' : 'editor-hidden'}`}>
				{editorShown ? <CellEditorMonacoWidget cell={cell} /> : null}
			</div>
			{!editorShown
				? (
					<section
						aria-label={renderedMarkdownContent}
						className='cell-contents positron-notebook-cell-outputs'
						onContextMenu={handleContextMenu}
						onDoubleClick={() => cell.toggleEditor()}
					>
						{
							markdownString.length > 0
								? <Markdown content={markdownString} />
								: <div className='empty-output-msg'>
									{emptyMarkdownCell}
									{doubleClickToEdit}
								</div>
						}
					</section>
				)
				: null
			}
		</NotebookCellWrapper>
	);
}




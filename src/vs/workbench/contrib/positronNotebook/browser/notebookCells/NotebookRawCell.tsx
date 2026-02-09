/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './NotebookRawCell.css';

// React.
import React from 'react';

// Other dependencies.
import { CellEditorMonacoWidget } from './CellEditorMonacoWidget.js';
import { NotebookCellWrapper } from './NotebookCellWrapper.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';

// Note: The cell is still a PositronNotebookCodeCell at runtime,
// but semantically it's a raw cell (language='raw')
export function NotebookRawCell({ cell }: { cell: PositronNotebookCodeCell }) {
	return (
		<NotebookCellWrapper cell={cell}>
			<div className='positron-notebook-raw-cell-contents'>
				<div className='positron-notebook-editor-section'>
					<div className='positron-notebook-editor-container'>
						<CellEditorMonacoWidget cell={cell} />
					</div>
				</div>
			</div>
		</NotebookCellWrapper>
	);
}

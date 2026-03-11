/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellCommentIndicator.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { useNotebookInstance } from '../../NotebookInstanceProvider.js';
import { getCellComments } from './cellCommentTypes.js';
import { useDisposableEffect } from '../../useDisposableEffect.js';

/**
 * Hook that returns the number of comments on a cell, updating reactively
 * when the cell's metadata changes.
 */
function useCellCommentCount(cell: IPositronNotebookCell): number {
	const notebook = useNotebookInstance();
	const [count, setCount] = React.useState(() => {
		const textModel = notebook.textModel;
		if (!textModel) {
			return 0;
		}
		const cellModel = textModel.cells[cell.index];
		return cellModel ? getCellComments(cellModel.metadata).length : 0;
	});

	useDisposableEffect(() => {
		const textModel = notebook.textModel;
		if (!textModel) {
			return undefined;
		}

		const cellModel = textModel.cells[cell.index];
		if (!cellModel) {
			return undefined;
		}

		// Update count when metadata changes
		const disposable = cellModel.onDidChangeMetadata(() => {
			setCount(getCellComments(cellModel.metadata).length);
		});

		// Also set initial value in case it changed since useState init
		setCount(getCellComments(cellModel.metadata).length);

		return disposable;
	}, [notebook, cell.index]);

	return count;
}

interface CellCommentIndicatorProps {
	cell: IPositronNotebookCell;
}

/**
 * Small badge shown in the top-right corner of a cell when it has comments.
 */
export function CellCommentIndicator({ cell }: CellCommentIndicatorProps) {
	const count = useCellCommentCount(cell);

	if (count === 0) {
		return null;
	}

	const label = count === 1
		? localize('cellCommentIndicator.one', '1 comment')
		: localize('cellCommentIndicator.many', '{0} comments', count);

	return (
		<div
			aria-label={label}
			className='cell-comment-indicator'
			title={label}
		>
			<span className='cell-comment-indicator-icon codicon codicon-comment-discussion' />
			<span className='cell-comment-indicator-count'>{count}</span>
		</div>
	);
}

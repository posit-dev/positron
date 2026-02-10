/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './CellLeftActionMenu.css';

// Other dependencies.
import { useObservedValue } from '../useObservedValue.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';

interface CellLeftActionMenuProps {
	cell: PositronNotebookCodeCell;
}

/**
 * Left-side menu for notebook cells that displays the execution order badge ([1], [2], etc.).
 */
export function CellLeftActionMenu({ cell }: CellLeftActionMenuProps) {
	// Observed values
	const executionOrder = useObservedValue(cell.lastExecutionOrder);

	// Determine what to show
	const showPending = executionOrder === undefined;

	return (
		<div
			className='left-hand-action-container'
		>
			<div
				className='left-hand-action-container-bottom'
			>
				{/* Execution order badge */}
				{showPending ? (
					<span className='execution-order-badge'>-</span>
				) : executionOrder !== undefined ? (
					<div className='execution-order-badge-container'>
						<span className='execution-order-badge-bracket'>[</span>
						<span className='execution-order-badge'> {String(executionOrder)} </span>
						<span className='execution-order-badge-bracket'>]</span>
					</div>
				) : null}
			</div>
		</div>
	);
}

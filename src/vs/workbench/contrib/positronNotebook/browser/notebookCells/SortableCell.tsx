/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './SortableCell.css';

// React.
import React from 'react';

// Other dependencies.
import { useSortable } from '@dnd-kit/sortable';
import { Codicon } from '../../../../../base/common/codicons.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { ThemeIcon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useDragState } from './SortableCellList.js';

interface SortableCellProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}

export function SortableCell({ cell, children }: SortableCellProps) {
	const { activeDragHandleIds, overTargetId, aboveOverTargetId, overTargetAdjacentToDragged } = useDragState();
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		isDragging,
	} = useSortable({ id: cell.handle });

	// Detect if this cell is a secondary participant in a multi-drag
	// (i.e., it's selected but not the one being actively dragged)
	const isSecondaryDragParticipant =
		activeDragHandleIds.includes(cell.handle) && !isDragging;

	// Show the drop indicator above this cell when it's the current target.
	const isOverTarget = overTargetId === cell.handle && !isDragging;
	const isAboveOverTarget = aboveOverTargetId === cell.handle;

	// Build className based on drag state
	const className = positronClassNames(
		'sortable-cell',
		{ 'dragging': isDragging },
		{ 'secondary-drag': isSecondaryDragParticipant },
		{ 'nudge-down': isOverTarget },
		{ 'nudge-up': isAboveOverTarget }
	);

	return (
		<div
			ref={setNodeRef}
			className={className}
		>
			{isOverTarget && <div className={positronClassNames('drag-drop-indicator', { 'double-gutter': overTargetAdjacentToDragged })} />}
			<button
				ref={setActivatorNodeRef}
				aria-label='Drag to reorder cell'
				className={positronClassNames('cell-drag-handle', { 'drag-handle-hidden': isDragging })}
				type='button'
				{...attributes}
				{...listeners}
				tabIndex={isDragging ? -1 : 0}
			>
				<ThemeIcon icon={Codicon.gripper} />
			</button>
			{isDragging ? null : children}
		</div>
	);
}

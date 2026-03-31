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

const SPREAD_PX = 4;

export function SortableCell({ cell, children }: SortableCellProps) {
	const { activeDragHandleIds, dropIndicatorIndex, isDropNoOp } = useDragState();
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

	// The dragged cell and secondary participants collapse to zero height
	// (via CSS class) so the gap closes and dnd-kit re-measures correct rects.
	const isHiddenForDrag = isDragging || isSecondaryDragParticipant;

	// Cells adjacent to the drop indicator spread apart slightly so the
	// indicator sits in a balanced gap. Uses transforms for smooth animation.
	// No spread for no-op positions (cell would stay in place).
	let spreadOffset = 0;
	if (dropIndicatorIndex !== null && !isHiddenForDrag && !isDropNoOp) {
		if (cell.index === dropIndicatorIndex - 1) {
			spreadOffset = -SPREAD_PX; // cell above: shift up
		} else if (cell.index === dropIndicatorIndex) {
			spreadOffset = SPREAD_PX; // cell below: shift down
		}
	}

	// Only apply our spread transforms; suppress dnd-kit transforms so
	// cells stay in natural flow around the greyed-out dragged cell.
	const style: React.CSSProperties = spreadOffset
		? { transform: `translateY(${spreadOffset}px)`, transition: 'transform 150ms ease' }
		: {};

	const isNoOpHighlight = isHiddenForDrag && isDropNoOp;

	const className = positronClassNames(
		'sortable-cell',
		{ 'sortable-cell-hidden': isHiddenForDrag },
		{ 'sortable-cell-noop': isNoOpHighlight },
	);

	return (
		<div
			ref={setNodeRef}
			className={className}
			style={style}
		>
			<div className='cell-drag-zone' />
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
			{children}
		</div>
	);
}

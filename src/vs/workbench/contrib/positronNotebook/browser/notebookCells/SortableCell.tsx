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
import { CSS } from '@dnd-kit/utilities';
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
	const { activeDragHandleIds, overId } = useDragState();
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		isDragging,
		transform,
		transition,
	} = useSortable({ id: cell.handle });

	// Detect if this cell is a secondary participant in a multi-drag
	// (i.e., it's selected but not the one being actively dragged)
	const isSecondaryDragParticipant =
		activeDragHandleIds.includes(cell.handle) && !isDragging;

	// Use dnd-kit's transform/transition for smooth cell shifting during drag.
	// The dragged cell and secondary participants become invisible but stay in
	// layout so dnd-kit's rect cache remains accurate.
	const isHiddenForDrag = isDragging || isSecondaryDragParticipant;

	// Show the drop indicator on the over target cell. The transform direction
	// tells us which edge: cells shifting down (positive y) open a gap at their
	// top; cells shifting up (negative y) open a gap at their bottom.
	const isOverTarget = overId === cell.handle && !isHiddenForDrag;
	let indicatorPosition: 'top' | 'bottom' | null = null;
	if (isOverTarget && transform && transform.y !== 0) {
		indicatorPosition = transform.y > 0 ? 'top' : 'bottom';
	}
	const indicatorOffset = transform ? `${Math.abs(transform.y) / 2}px` : '0px';
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isHiddenForDrag ? 0 : undefined,
	};

	const className = positronClassNames(
		'sortable-cell',
		{ 'sortable-cell-hidden': isHiddenForDrag },
	);

	return (
		<div
			ref={setNodeRef}
			className={className}
			style={style}
		>
			<div className='cell-drag-zone' />
			{indicatorPosition && (
				<div
					className={`drag-drop-indicator indicator-${indicatorPosition}`}
					style={{
						transform: indicatorPosition === 'top'
							? `translateY(calc(-50% - ${indicatorOffset} - var(--_positron-notebook-cell-gap) - var(--_positron-notebook-add-cell-buttons-height) / 2))`
							: `translateY(calc(50% + ${indicatorOffset} + var(--_positron-notebook-cell-gap) + var(--_positron-notebook-add-cell-buttons-height) / 2))`,
					}}
				/>
			)}
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

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
	const { activeDragHandleIds } = useDragState();
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: cell.handle });

	// Detect if this cell is a secondary participant in a multi-drag
	// (i.e., it's selected but not the one being actively dragged)
	const isSecondaryDragParticipant =
		activeDragHandleIds.includes(cell.handle) && !isDragging;

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		position: 'relative',
	};

	// Build className based on drag state
	const className = positronClassNames(
		'sortable-cell',
		{ 'dragging': isDragging },
		{ 'secondary-drag': isSecondaryDragParticipant }
	);

	return (
		<div
			ref={setNodeRef}
			className={className}
			style={style}
		>
			{!isDragging && (
				<button
					ref={setActivatorNodeRef}
					aria-label='Drag to reorder cell'
					className='cell-drag-handle'
					type='button'
					{...attributes}
					{...listeners}
				>
					<ThemeIcon icon={Codicon.gripper} />
				</button>
			)}
			{/* Always render children to preserve measured height for dnd-kit
				collision detection. When dragging, hide visually with CSS. */}
			<div className={isDragging ? 'drag-placeholder' : undefined}>
				{children}
			</div>
			{isDragging && <div className='drag-drop-indicator' />}
		</div>
	);
}

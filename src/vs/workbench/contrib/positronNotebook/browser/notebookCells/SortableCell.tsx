/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './SortableCell.css';

// React.
import * as React from 'react';
// Replace dnd-kit imports with custom implementation
import { useSortable } from '../dnd/useSortable.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

interface SortableCellProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}

export function SortableCell({ cell, children }: SortableCellProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: cell.handleId });

	// Build transform string (for FLIP animations)
	const transformStyle = transform
		? `translate3d(${transform.x}px, ${transform.y}px, 0)`
		: undefined;

	const style: React.CSSProperties = {
		transform: transformStyle,
		transition,
		// Keep the cell visible during drag - it animates to its insertion position
		position: 'relative',
	};

	return (
		<div
			ref={setNodeRef}
			className={isDragging ? 'sortable-cell dragging' : 'sortable-cell'}
			style={style}
		>
			<button
				ref={setActivatorNodeRef}
				aria-label="Drag to reorder cell"
				className="cell-drag-handle"
				type="button"
				{...attributes}
				{...listeners}
			>
				<span className="codicon codicon-gripper" />
			</button>
			{children}
		</div>
	);
}

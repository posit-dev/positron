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
import { useMultiDragState } from '../dnd/MultiDragContext.js';
import { transformToString } from '../dnd/animations.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

interface SortableCellProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}

export function SortableCell({ cell, children }: SortableCellProps) {
	const nodeRef = React.useRef<HTMLDivElement>(null);
	const {
		attributes,
		listeners,
		setNodeRef: setSortableRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: cell.handleId });

	// Combine refs
	const setNodeRef = React.useCallback((node: HTMLDivElement | null) => {
		(nodeRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
		setSortableRef(node);
	}, [setSortableRef]);

	// Check multi-drag state for this cell
	const multiDragState = useMultiDragState(cell.handleId);
	const isCollapsed = multiDragState?.isBeingDragged && !multiDragState?.isPrimaryDrag;

	// Use transformToString utility to handle scaleY for collapsed cells
	const transformStyle = transformToString(transform);

	const style: React.CSSProperties = {
		transform: transformStyle,
		transition,
		// Keep the cell visible during drag - it animates to its insertion position
		position: 'relative',
		// Collapse from top edge for smooth scaleY animation
		transformOrigin: 'top',
	};

	// Build class name with collapsed state
	const className = [
		'sortable-cell',
		isDragging && 'dragging',
		isCollapsed && 'collapsed-drag',
	].filter(Boolean).join(' ');

	return (
		<div
			ref={setNodeRef}
			className={className}
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './SortableCell.css';

// React.
import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as DOM from '../../../../../base/browser/dom.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { useDragState } from './SortableCellList.js';

interface SortableCellProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}

export function SortableCell({ cell, children }: SortableCellProps) {
	const notebookInstance = useNotebookInstance();
	const { activeDragHandleIds, activeCellIndices } = useDragState();
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: cell.handleId });

	// Calculate max height for dragging state (1/3 of container height)
	// Use a minimum of 200px to ensure the cell remains visible
	const maxDragHeight = React.useMemo(() => {
		const container = notebookInstance.cellsContainer;
		const height = container?.clientHeight || DOM.getActiveWindow().innerHeight;
		const calculatedHeight = Math.floor(height / 3);
		return Math.max(calculatedHeight, 200);
	}, [notebookInstance.cellsContainer]);

	// Detect if this cell is a secondary participant in a multi-drag
	// (i.e., it's selected but not the one being actively dragged)
	const isSecondaryDragParticipant =
		activeDragHandleIds.includes(cell.handleId) && !isDragging;

	// Calculate how many selected cells are above/below this cell for multi-drag visualization
	const { cellsAbove, cellsBelow } = React.useMemo(() => {
		if (!isDragging || activeDragHandleIds.length <= 1) {
			return { cellsAbove: 0, cellsBelow: 0 };
		}

		const myIndex = cell.index;
		const above = activeCellIndices.filter(idx => idx < myIndex).length;
		const below = activeCellIndices.filter(idx => idx > myIndex).length;

		return { cellsAbove: above, cellsBelow: below };
	}, [isDragging, activeDragHandleIds.length, cell.index, activeCellIndices]);

	// Check if this is a multi-drag operation
	const isMultiDrag = isDragging && activeDragHandleIds.length > 1;

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: 1,
		position: 'relative',
	};

	// Build className based on drag state
	let className = 'sortable-cell';
	if (isDragging) {
		className += ' dragging';
		if (isMultiDrag) {
			className += ' multi-drag';
		}
	}
	if (isSecondaryDragParticipant) {
		className += ' secondary-drag';
	}

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
			{/* Lines above for multi-drag */}
			{isDragging && cellsAbove > 0 && (
				<div className="drag-lines-container drag-lines-above">
					{Array.from({ length: cellsAbove }).map((_, i) => (
						<div key={`above-${i}`} className="drag-indicator-line" />
					))}
				</div>
			)}
			{isDragging ? (
				<div className="drag-content-wrapper" style={{ maxHeight: maxDragHeight }}>
					{children}
				</div>
			) : children}
			{/* Lines below for multi-drag */}
			{isDragging && cellsBelow > 0 && (
				<div className="drag-lines-container drag-lines-below">
					{Array.from({ length: cellsBelow }).map((_, i) => (
						<div key={`below-${i}`} className="drag-indicator-line" />
					))}
				</div>
			)}
		</div>
	);
}

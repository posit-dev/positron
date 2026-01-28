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

interface SortableCellProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}

export function SortableCell({ cell, children }: SortableCellProps) {
	const notebookInstance = useNotebookInstance();
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

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
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
			{isDragging ? (
				<div className="drag-content-wrapper" style={{ maxHeight: maxDragHeight }}>
					{children}
				</div>
			) : children}
		</div>
	);
}

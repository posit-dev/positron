/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
// Replace dnd-kit imports with custom implementation
import { SortableContext } from '../dnd/SortableContext.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

interface SortableCellListProps {
	cells: IPositronNotebookCell[];
	onReorder: (oldIndex: number, newIndex: number) => void;
	children: React.ReactNode;
	renderDragOverlay?: (cell: IPositronNotebookCell) => React.ReactNode;
	disabled?: boolean; // For read-only mode
}

export function SortableCellList({
	cells,
	onReorder,
	children,
	renderDragOverlay,
	disabled = false,
}: SortableCellListProps) {
	const items = React.useMemo(
		() => cells.map(c => c.handleId),
		[cells]
	);

	// Callbacks to manage body class for drag styling (cursor, etc.)
	const handleDragStart = React.useCallback(() => {
		DOM.getActiveWindow().document.body.classList.add('dragging-notebook-cell');
	}, []);

	const handleDragEnd = React.useCallback(() => {
		DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
	}, []);

	const renderOverlay = React.useCallback((activeId: string) => {
		if (!renderDragOverlay) {
			return null;
		}
		const cell = cells.find(c => c.handleId === activeId);
		return cell ? (
			<div className="cell-drag-overlay">
				{renderDragOverlay(cell)}
			</div>
		) : null;
	}, [cells, renderDragOverlay]);

	return (
		<SortableContext
			disabled={disabled}
			items={items}
			renderDragOverlay={renderOverlay}
			onDragEnd={handleDragEnd}
			onDragStart={handleDragStart}
			onReorder={onReorder}
		>
			{children}
		</SortableContext>
	);
}

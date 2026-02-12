/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
// Replace dnd-kit imports with custom implementation
import { SortableContext } from '../dnd/SortableContext.js';
import { MultiDragProvider } from '../dnd/MultiDragContext.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

interface SortableCellListProps {
	cells: IPositronNotebookCell[];
	selectedIds: string[];
	onReorder: (oldIndex: number, newIndex: number) => void;
	onBatchReorder?: (fromIndices: number[], toIndex: number) => void;
	children: React.ReactNode;
	disabled?: boolean; // For read-only mode
	scrollContainerRef?: React.RefObject<HTMLElement>; // For auto-scroll during drag
}

export function SortableCellList({
	cells,
	selectedIds,
	onReorder,
	onBatchReorder,
	children,
	disabled = false,
	scrollContainerRef,
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

	return (
		<MultiDragProvider selectedIds={selectedIds} orderedIds={items}>
			<SortableContext
				disabled={disabled}
				items={items}
				scrollContainerRef={scrollContainerRef}
				selectedIds={selectedIds}
				onBatchReorder={onBatchReorder}
				onDragEnd={handleDragEnd}
				onDragStart={handleDragStart}
				onReorder={onReorder}
			>
				{children}
			</SortableContext>
		</MultiDragProvider>
	);
}

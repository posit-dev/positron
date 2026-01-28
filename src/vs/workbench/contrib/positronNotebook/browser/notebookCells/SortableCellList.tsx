/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import {
	DndContext,
	DragOverlay,
	closestCenter,
	PointerSensor,
	KeyboardSensor,
	useSensor,
	useSensors,
	DragStartEvent,
	DragEndEvent,
} from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
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
	const [activeCell, setActiveCell] = React.useState<IPositronNotebookCell | null>(null);

	// Require 10px movement before drag starts (prevents accidental drags)
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 10,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);

	// If disabled (read-only mode), don't enable drag-and-drop
	if (disabled) {
		return <>{children}</>;
	}

	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		const cell = cells.find(c => c.handleId === event.active.id);
		setActiveCell(cell ?? null);
	}, [cells]);

	const handleDragEnd = React.useCallback((event: DragEndEvent) => {
		const { active, over } = event;
		setActiveCell(null);

		if (over && active.id !== over.id) {
			const oldIndex = cells.findIndex(c => c.handleId === active.id);
			const newIndex = cells.findIndex(c => c.handleId === over.id);
			if (oldIndex !== -1 && newIndex !== -1) {
				onReorder(oldIndex, newIndex);
			}
		}
	}, [cells, onReorder]);

	const handleDragCancel = React.useCallback(() => {
		setActiveCell(null);
	}, []);

	return (
		<DndContext
			collisionDetection={closestCenter}
			sensors={sensors}
			onDragCancel={handleDragCancel}
			onDragEnd={handleDragEnd}
			onDragStart={handleDragStart}
		>
			<SortableContext
				items={cells.map(c => c.handleId)}
				strategy={verticalListSortingStrategy}
			>
				{children}
			</SortableContext>

			<DragOverlay>
				{activeCell && renderDragOverlay ? (
					<div className="cell-drag-overlay">
						{renderDragOverlay(activeCell)}
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

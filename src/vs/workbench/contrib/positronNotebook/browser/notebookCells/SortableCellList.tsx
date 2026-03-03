/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import {
	DndContext,
	DragOverlay,
	closestCenter,
	CollisionDetection,
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
import * as DOM from '../../../../../base/browser/dom.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

interface SortableCellListProps {
	cells: IPositronNotebookCell[];
	onReorder: (cells: IPositronNotebookCell[], targetIndex: number) => void;
	getSelectedCells?: () => IPositronNotebookCell[];
	children: React.ReactNode;
}

// Context to share active drag state with SortableCell components
interface DragStateContextValue {
	activeDragHandleIds: number[];
	activeCellIndices: number[];  // Sorted indices of all selected cells
}

const DragStateContext = React.createContext<DragStateContextValue>({
	activeDragHandleIds: [],
	activeCellIndices: [],
});

export function useDragState(): DragStateContextValue {
	return React.useContext(DragStateContext);
}

// Wraps closestCenter but excludes the active item from candidates.
// Without this, dragging to the very first/last position can resolve
// over=active (sorted position matches cursor), causing a no-op.
const closestCenterExcludingActive: CollisionDetection = (args) => {
	const filtered = args.droppableContainers.filter(c => c.id !== args.active.id);
	return closestCenter({ ...args, droppableContainers: filtered });
};

export function SortableCellList({
	cells,
	onReorder,
	getSelectedCells,
	children,
}: SortableCellListProps) {
	// Track the cells being dragged - can be a single cell or multiple selected cells
	// Use both state (for rendering) and ref (for reliable access in callbacks)
	const [activeCells, setActiveCells] = React.useState<IPositronNotebookCell[]>([]);
	const activeCellsRef = React.useRef<IPositronNotebookCell[]>([]);
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

	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		const draggedCell = cells.find(c => c.handle === event.active.id);
		if (!draggedCell) {
			activeCellsRef.current = [];
			setActiveCells([]);
			return;
		}

		// Check if this cell is part of a multi-selection
		if (getSelectedCells) {
			const selectedCells = getSelectedCells();
			// Only use multi-drag if:
			// 1. There are multiple cells selected
			// 2. The dragged cell is part of the selection (compare by handle for robustness)
			const isDraggedCellSelected = selectedCells.some(c => c.handle === draggedCell.handle);
			if (selectedCells.length > 1 && isDraggedCellSelected) {
				// Sort by index to maintain relative order
				const sortedCells = [...selectedCells].sort((a, b) => a.index - b.index);
				activeCellsRef.current = sortedCells;
				setActiveCells(sortedCells);
				DOM.getActiveWindow().document.body.classList.add('dragging-notebook-cell');
				return;
			}
		}

		// Single cell drag (either no multi-selection or dragging an unselected cell)
		activeCellsRef.current = [draggedCell];
		setActiveCells([draggedCell]);
		DOM.getActiveWindow().document.body.classList.add('dragging-notebook-cell');
	}, [cells, getSelectedCells]);

	const handleDragEnd = React.useCallback((event: DragEndEvent) => {
		const { active, over } = event;
		// Use ref for reliable access (state may be stale in callback)
		const draggedCells = activeCellsRef.current;

		// Helper to clear drag state - deferred to next frame to allow dnd-kit
		// to complete its internal cleanup before we update React state
		const clearDragState = () => {
			// Clear ref immediately so subsequent callbacks don't see stale data
			activeCellsRef.current = [];
			DOM.getActiveWindow().requestAnimationFrame(() => {
				setActiveCells([]);
				DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
			});
		};

		// Minimum vertical displacement to commit a reorder. Because
		// closestCenterExcludingActive excludes the active item from collision
		// candidates, very small movements resolve to a neighbor cell. This
		// prevents accidental reorders when the user activates the drag
		// (10px threshold) but releases without meaningful movement.
		const MIN_REORDER_DISTANCE = 25;
		if (!over || active.id === over.id || Math.abs(event.delta.y) < MIN_REORDER_DISTANCE) {
			clearDragState();
			return;
		}

		// Use over.id to find the target index. closestCenter with
		// verticalListSortingStrategy uses sorted positions, so this gives
		// arrayMove semantics: the dragged item takes the over item's position.
		const targetIndex = cells.findIndex(c => c.handle === over.id);
		if (targetIndex === -1) {
			clearDragState();
			return;
		}

		// Convert from dnd-kit's over-index to insertion-point semantics.
		// When moving down, add 1 because moveCells subtracts length internally.
		const firstDraggedIndex = draggedCells[0].index;
		const adjustedTarget = targetIndex > firstDraggedIndex
			? targetIndex + 1
			: targetIndex;
		onReorder(draggedCells, adjustedTarget);
		clearDragState();
	}, [cells, onReorder]);

	const handleDragCancel = React.useCallback(() => {
		activeCellsRef.current = [];
		DOM.getActiveWindow().requestAnimationFrame(() => {
			setActiveCells([]);
			DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
		});
	}, []);

	// Memoize the context value to avoid unnecessary re-renders
	const dragStateValue = React.useMemo(() => ({
		activeDragHandleIds: activeCells.map(c => c.handle),
		activeCellIndices: activeCells.map(c => c.index),
	}), [activeCells]);

	// Always include all cells in sortable items. Removing items mid-drag
	// corrupts dnd-kit's internal state and crashes the renderer. The visual
	// collapse of secondary cells is handled purely by CSS (.secondary-drag).
	const sortableItems = React.useMemo(() => {
		return cells.map(c => c.handle);
	}, [cells]);

	return (
		<DndContext
			collisionDetection={closestCenterExcludingActive}
			sensors={sensors}
			onDragCancel={handleDragCancel}
			onDragEnd={handleDragEnd}
			onDragStart={handleDragStart}
		>
			<SortableContext
				items={sortableItems}
				strategy={verticalListSortingStrategy}
			>
				<DragStateContext.Provider value={dragStateValue}>
					{children}
				</DragStateContext.Provider>
			</SortableContext>

			<DragOverlay dropAnimation={null}>
				{activeCells.length > 0 && (
					<DragPreview cells={activeCells} />
				)}
			</DragOverlay>
		</DndContext>
	);
}

/**
 * Compact floating preview shown in the DragOverlay while dragging.
 * Shows a snippet of the cell content with a cell count badge for multi-drag.
 */
function DragPreview({ cells }: { cells: IPositronNotebookCell[] }) {
	const firstCell = cells[0];
	const content = firstCell.getContent();
	// Show first line, truncated
	const firstLine = content.split('\n')[0].slice(0, 80) || '(empty cell)';
	const isMulti = cells.length > 1;

	return (
		<div className='drag-overlay-preview'>
			<div className='drag-overlay-content'>{firstLine}</div>
			{isMulti && (
				<div className='drag-overlay-badge'>{cells.length} cells</div>
			)}
		</div>
	);
}

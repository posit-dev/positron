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
import * as DOM from '../../../../../base/browser/dom.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

interface SortableCellListProps {
	cells: IPositronNotebookCell[];
	onReorder: (oldIndex: number, newIndex: number) => void;
	onMultiReorder?: (cells: IPositronNotebookCell[], targetIndex: number) => void;
	getSelectedCells?: () => IPositronNotebookCell[];
	children: React.ReactNode;
	disabled?: boolean; // For read-only mode
}

// Context to share active drag state with SortableCell components
interface DragStateContextValue {
	activeDragHandleIds: string[];
	activeCellIndices: number[];  // Sorted indices of all selected cells
}

const DragStateContext = React.createContext<DragStateContextValue>({
	activeDragHandleIds: [],
	activeCellIndices: [],
});

export function useDragState(): DragStateContextValue {
	return React.useContext(DragStateContext);
}

export function SortableCellList({
	cells,
	onReorder,
	onMultiReorder,
	getSelectedCells,
	children,
	disabled = false,
}: SortableCellListProps) {
	// Track the cells being dragged - can be a single cell or multiple selected cells
	// Use both state (for rendering) and ref (for reliable access in callbacks)
	const [activeCells, setActiveCells] = React.useState<IPositronNotebookCell[]>([]);
	const activeCellsRef = React.useRef<IPositronNotebookCell[]>([]);
	// Track which cell the user actually started dragging (the "primary" cell)
	// This may differ from activeCells[0] when dragging a non-topmost selected cell
	const [primaryDragHandleId, setPrimaryDragHandleId] = React.useState<string | null>(null);

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
		const draggedCell = cells.find(c => c.handleId === event.active.id);
		if (!draggedCell) {
			activeCellsRef.current = [];
			setActiveCells([]);
			return;
		}

		// Check if this cell is part of a multi-selection
		if (getSelectedCells && onMultiReorder) {
			const selectedCells = getSelectedCells();
			// Only use multi-drag if:
			// 1. There are multiple cells selected
			// 2. The dragged cell is part of the selection (compare by handleId for robustness)
			const isDraggedCellSelected = selectedCells.some(c => c.handleId === draggedCell.handleId);
			if (selectedCells.length > 1 && isDraggedCellSelected) {
				// Sort by index to maintain relative order
				const sortedCells = [...selectedCells].sort((a, b) => a.index - b.index);
				activeCellsRef.current = sortedCells;
				setActiveCells(sortedCells);
				setPrimaryDragHandleId(draggedCell.handleId);
				DOM.getActiveWindow().document.body.classList.add('dragging-notebook-cell');
				return;
			}
		}

		// Single cell drag (either no multi-selection or dragging an unselected cell)
		activeCellsRef.current = [draggedCell];
		setActiveCells([draggedCell]);
		setPrimaryDragHandleId(draggedCell.handleId);
		DOM.getActiveWindow().document.body.classList.add('dragging-notebook-cell');
	}, [cells, getSelectedCells, onMultiReorder]);

	const handleDragEnd = React.useCallback((event: DragEndEvent) => {
		const { active, over } = event;
		// Use ref for reliable access (state may be stale in callback)
		const draggedCells = activeCellsRef.current;

		// Helper to clear drag state - deferred to next frame to allow dnd-kit
		// to complete its internal cleanup before we change sortableItems
		const clearDragState = () => {
			// Clear ref immediately so subsequent callbacks don't see stale data
			activeCellsRef.current = [];
			// Defer React state update to next frame - this prevents sortableItems
			// from changing while dnd-kit is still cleaning up, which causes crashes
			DOM.getActiveWindow().requestAnimationFrame(() => {
				setActiveCells([]);
				setPrimaryDragHandleId(null);
				DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
			});
		};

		if (!over || active.id === over.id) {
			clearDragState();
			return;
		}

		const targetIndex = cells.findIndex(c => c.handleId === over.id);
		if (targetIndex === -1) {
			clearDragState();
			return;
		}

		// Multi-cell drag
		if (draggedCells.length > 1 && onMultiReorder) {
			// When moving down, add 1 to counteract the adjustment in moveCells.
			// dnd-kit gives us the position of the element we're over, but moveCells
			// expects the insertion point before adjustment (it subtracts length when
			// moving down). This matches how moveCell handles single-cell drags.
			const firstDraggedIndex = draggedCells[0].index;
			const adjustedTargetIndex = targetIndex > firstDraggedIndex
				? targetIndex + 1
				: targetIndex;
			onMultiReorder(draggedCells, adjustedTargetIndex);
			clearDragState();
			return;
		}

		// Single cell drag
		const oldIndex = cells.findIndex(c => c.handleId === active.id);
		if (oldIndex !== -1) {
			onReorder(oldIndex, targetIndex);
		}
		clearDragState();
	}, [cells, onReorder, onMultiReorder]);

	const handleDragCancel = React.useCallback(() => {
		activeCellsRef.current = [];
		// Defer state update to next frame to allow dnd-kit cleanup
		DOM.getActiveWindow().requestAnimationFrame(() => {
			setActiveCells([]);
			setPrimaryDragHandleId(null);
			DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
		});
	}, []);

	// Memoize the context value to avoid unnecessary re-renders
	const dragStateValue = React.useMemo(() => ({
		activeDragHandleIds: activeCells.map(c => c.handleId),
		activeCellIndices: activeCells.map(c => c.index),
	}), [activeCells]);

	// Filter out secondary drag participants from sortable items
	// This prevents dnd-kit from showing drop positions around collapsed cells
	const sortableItems = React.useMemo(() => {
		if (activeCells.length <= 1) {
			return cells.map(c => c.handleId);
		}
		// Exclude secondary cells (all except the actually-dragged primary cell)
		// This allows dragging any cell in a multi-selection, not just the topmost
		const secondaryIds = new Set(
			activeCells
				.filter(c => c.handleId !== primaryDragHandleId)
				.map(c => c.handleId)
		);
		return cells
			.filter(c => !secondaryIds.has(c.handleId))
			.map(c => c.handleId);
	}, [cells, activeCells, primaryDragHandleId]);

	// If disabled (read-only mode), don't enable drag-and-drop
	if (disabled) {
		return <>{children}</>;
	}

	return (
		<DndContext
			collisionDetection={closestCenter}
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

			{/* DragOverlay disabled - cells move in place without floating copy */}
			<DragOverlay>{null}</DragOverlay>
		</DndContext>
	);
}

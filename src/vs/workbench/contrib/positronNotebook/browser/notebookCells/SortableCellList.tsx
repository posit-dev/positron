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
	CollisionDetection,
	PointerSensor,
	KeyboardSensor,
	useSensor,
	useSensors,
	useDroppable,
	DragStartEvent,
	DragEndEvent,
	DragOverEvent,
	UniqueIdentifier,
} from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import * as DOM from '../../../../../base/browser/dom.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

/** Sentinel id for the droppable zone after the last cell. */
const END_SENTINEL_ID = '__positron-notebook-end-sentinel__';


interface SortableCellListProps {
	cells: IPositronNotebookCell[];
	onReorder: (cells: IPositronNotebookCell[], targetIndex: number) => void;
	getSelectedCells?: () => IPositronNotebookCell[];
	children: React.ReactNode;
}

// Context to share active drag state with SortableCell components
interface DragStateContextValue {
	activeDragHandleIds: number[];
	/** The id of the cell the drop indicator should appear above. */
	overTargetId: UniqueIdentifier | null;
	/** The id of the cell directly above the drop indicator. */
	aboveOverTargetId: UniqueIdentifier | null;
	/** True when the over target is right after the dragged cell, creating a
	 *  double gutter that the indicator needs to center within. */
	overTargetAdjacentToDragged: boolean;
}

const DragStateContext = React.createContext<DragStateContextValue>({
	activeDragHandleIds: [],
	overTargetId: null,
	aboveOverTargetId: null,
	overTargetAdjacentToDragged: false,
});

export function useDragState(): DragStateContextValue {
	return React.useContext(DragStateContext);
}

// Custom collision detection: find the gap between cells closest to the
// cursor and resolve to the droppable on the appropriate side of that gap.
// This gives "insertion point" semantics rather than "which cell center am
// I nearest to," which feels more natural for reordering.
const closestGap: CollisionDetection = (args) => {
	const { droppableContainers, active, collisionRect, pointerCoordinates } = args;
	// Use actual cursor position when available; fall back to collisionRect
	// center for keyboard-driven reordering (pointerCoordinates is null).
	const pointerY = pointerCoordinates?.y
		?? (collisionRect.top + collisionRect.height / 2);

	// When a cell starts being dragged it collapses to height:0 via CSS.
	// dnd-kit's cached rects still reflect the pre-collapse layout, so
	// cells below the active item appear further down than they actually
	// are. Subtract the full cached height to compensate.
	const activeRect = droppableContainers
		.find(c => c.id === active.id)?.rect.current;
	const heightDelta = activeRect?.height ?? 0;
	const activeTop = activeRect?.top ?? 0;

	// Get candidates sorted by vertical position (exclude active item)
	const candidates = droppableContainers
		.filter(c => c.id !== active.id && c.rect.current)
		.sort((a, b) => a.rect.current!.top - b.rect.current!.top);

	if (candidates.length === 0) {
		return [];
	}

	// Adjusted top position: cells below the dragged cell shifted up when
	// it collapsed, but the cached rects don't reflect that.
	const adjustedTop = (c: typeof candidates[0]) => {
		const top = c.rect.current!.top;
		return top > activeTop ? top - heightDelta : top;
	};

	// Build gap positions: each gap sits between two adjacent cells.
	// A gap maps to the cell BELOW it (dropping into that gap means
	// the active item takes that cell's position).
	const gaps: { y: number; id: typeof candidates[0]['id'] }[] = [];

	// Gap above the first cell
	gaps.push({ y: adjustedTop(candidates[0]), id: candidates[0].id });

	// Gaps between adjacent cells
	for (let i = 0; i < candidates.length - 1; i++) {
		const bottomOfCurrent = adjustedTop(candidates[i]) + candidates[i].rect.current!.height;
		const topOfNext = adjustedTop(candidates[i + 1]);
		const gapY = (bottomOfCurrent + topOfNext) / 2;
		gaps.push({ y: gapY, id: candidates[i + 1].id });
	}

	// Gap below the last cell -- maps to the end sentinel so dropping
	// past the bottom inserts after the last cell.
	const last = candidates[candidates.length - 1];
	const lastBottom = adjustedTop(last) + last.rect.current!.height;
	gaps.push({ y: lastBottom, id: END_SENTINEL_ID });

	// Find the gap closest to the pointer
	let closestId = gaps[0].id;
	let minDist = Math.abs(pointerY - gaps[0].y);
	for (let i = 1; i < gaps.length; i++) {
		const dist = Math.abs(pointerY - gaps[i].y);
		if (dist < minDist) {
			minDist = dist;
			closestId = gaps[i].id;
		}
	}

	return [{ id: closestId }];
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
	// Track which cell the drop indicator should appear above
	const [overTargetId, setOverTargetId] = React.useState<UniqueIdentifier | null>(null);
	// Track initial pointer position for cursor-following overlay (null = keyboard drag)
	const [dragPointerOrigin, setDragPointerOrigin] = React.useState<{ x: number; y: number } | null>(null);
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
		// Track pointer origin so the overlay can initialize at the right spot.
		// Keyboard-initiated drags produce a KeyboardEvent, not PointerEvent;
		// the cursor-following overlay is only shown for pointer drags.
		if (event.activatorEvent instanceof PointerEvent) {
			setDragPointerOrigin({ x: event.activatorEvent.clientX, y: event.activatorEvent.clientY });
		} else {
			setDragPointerOrigin(null);
		}

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

	const handleDragOver = React.useCallback((event: DragOverEvent) => {
		setOverTargetId(event.over?.id ?? null);
	}, []);

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
				setOverTargetId(null);
				setDragPointerOrigin(null);
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

		// Resolve the target index from the collision result. The end sentinel
		// means "after the last cell"; all other ids map to a cell to insert before.
		let targetIndex: number;
		if (over.id === END_SENTINEL_ID) {
			targetIndex = cells.length;
		} else {
			targetIndex = cells.findIndex(c => c.handle === over.id);
			if (targetIndex === -1) {
				clearDragState();
				return;
			}
		}

		// moveCells handles the removal-offset adjustment internally.
		onReorder(draggedCells, targetIndex);
		clearDragState();
	}, [cells, onReorder]);

	const handleDragCancel = React.useCallback(() => {
		activeCellsRef.current = [];
		DOM.getActiveWindow().requestAnimationFrame(() => {
			setActiveCells([]);
			setOverTargetId(null);
			setDragPointerOrigin(null);
			DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
		});
	}, []);

	// Memoize the context value to avoid unnecessary re-renders
	const dragStateValue = React.useMemo(() => {
		// Find the visible (non-dragged) cell directly above the over target
		let aboveOverTargetId: UniqueIdentifier | null = null;
		let overTargetAdjacentToDragged = false;
		if (overTargetId !== null) {
			const dragHandles = new Set(activeCells.map(c => c.handle));
			const visibleCells = cells.filter(c => !dragHandles.has(c.handle));

			if (overTargetId === END_SENTINEL_ID) {
				// Dropping after the last cell: the cell above is the last visible cell
				if (visibleCells.length > 0) {
					aboveOverTargetId = visibleCells[visibleCells.length - 1].handle;
				}
			} else {
				const overIdx = visibleCells.findIndex(c => c.handle === overTargetId);
				if (overIdx > 0) {
					aboveOverTargetId = visibleCells[overIdx - 1].handle;
				}

				// Check if the over target sits right after the dragged cell in
				// the original order. The collapsed cell's two gutters merge into
				// a double-wide gap that the indicator should center within.
				const overOrigIdx = cells.findIndex(c => c.handle === overTargetId);
				if (overOrigIdx > 0 && dragHandles.has(cells[overOrigIdx - 1].handle)) {
					overTargetAdjacentToDragged = true;
				}
			}
		}
		return {
			activeDragHandleIds: activeCells.map(c => c.handle),
			overTargetId,
			aboveOverTargetId,
			overTargetAdjacentToDragged,
		};
	}, [activeCells, overTargetId, cells]);

	// Always include all cells in sortable items. Removing items mid-drag
	// corrupts dnd-kit's internal state and crashes the renderer. The visual
	// collapse of secondary cells is handled purely by CSS (.secondary-drag).
	const sortableItems = React.useMemo(() => {
		return cells.map(c => c.handle);
	}, [cells]);

	return (
		<DndContext
			collisionDetection={closestGap}
			sensors={sensors}
			onDragCancel={handleDragCancel}
			onDragEnd={handleDragEnd}
			onDragOver={handleDragOver}
			onDragStart={handleDragStart}
		>
			<SortableContext
				items={sortableItems}
				strategy={verticalListSortingStrategy}
			>
				<DragStateContext.Provider value={dragStateValue}>
					{children}
					<EndSentinelDroppable />
				</DragStateContext.Provider>
			</SortableContext>

			{/* Keep DragOverlay mounted (empty) so dnd-kit's internal
				usesDragOverlay flag stays set, which zeroes out nodeRectDelta
				and prevents double-compensation in collision detection. */}
			<DragOverlay dropAnimation={null} />
			{activeCells.length > 0 && dragPointerOrigin && (
				<CursorFollowingOverlay cells={activeCells} initialPosition={dragPointerOrigin} />
			)}
		</DndContext>
	);
}

/**
 * Invisible droppable zone after the last cell. Gives dnd-kit a concrete
 * rect so the closestGap collision detection can resolve "after last cell"
 * to a real droppable container. Renders the drop indicator when active.
 */
function EndSentinelDroppable() {
	const { setNodeRef } = useDroppable({ id: END_SENTINEL_ID });
	const { overTargetId, activeDragHandleIds } = useDragState();
	const isActive = overTargetId === END_SENTINEL_ID && activeDragHandleIds.length > 0;

	return (
		<div ref={setNodeRef} style={{ position: 'relative', height: 1 }}>
			{isActive && <div className='drag-drop-indicator end-sentinel-indicator' />}
		</div>
	);
}

/**
 * Floating preview that follows the cursor via a pointermove listener.
 * Bypasses dnd-kit's DragOverlay positioning which can drift when the
 * dragged cell's collapse triggers scroll clamping (common for bottom cells).
 */
function CursorFollowingOverlay({ cells, initialPosition }: {
	cells: IPositronNotebookCell[];
	initialPosition: { x: number; y: number };
}) {
	const overlayRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		const el = overlayRef.current;
		if (!el) { return; }

		const halfHeight = el.offsetHeight / 2;

		// Show immediately at the drag-start position so the overlay is
		// visible from the first frame (no flicker).
		el.style.transform = `translate(${initialPosition.x + 12}px, ${initialPosition.y - halfHeight}px)`;
		el.style.opacity = '1';

		const onPointerMove = (e: PointerEvent) => {
			el.style.transform = `translate(${e.clientX + 12}px, ${e.clientY - halfHeight}px)`;
		};

		const win = DOM.getActiveWindow();
		win.addEventListener('pointermove', onPointerMove);
		return () => win.removeEventListener('pointermove', onPointerMove);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps -- runs once per drag lifecycle

	return (
		<div
			ref={overlayRef}
			className='cursor-following-overlay'
			style={{ opacity: 0 }}
		>
			<DragPreview cells={cells} />
		</div>
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

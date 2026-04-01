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
	PointerSensor,
	KeyboardSensor,
	closestCenter,
	useSensor,
	useSensors,
	CollisionDetection,
	DragStartEvent,
	DragEndEvent,
	UniqueIdentifier,
	MeasuringStrategy,
} from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import * as DOM from '../../../../../base/browser/dom.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

/** Minimum pointer distance (px) before a drag activates. Exported so e2e tests can reference the same value. */
export const DRAG_ACTIVATION_DISTANCE_PX = 10;

interface SortableCellListProps {
	cells: IPositronNotebookCell[];
	onReorder: (cells: IPositronNotebookCell[], targetIndex: number) => void;
	getSelectedCells?: () => IPositronNotebookCell[];
	children: React.ReactNode;
}

// Context to share active drag state with SortableCell and AddCellButtons
interface DragStateContextValue {
	activeDragHandleIds: number[];
	/** Which AddCellButtons index should show the drop indicator, or null. */
	dropIndicatorIndex: number | null;
	/** True when the indicator is at a no-op position (cell would stay in place). */
	isDropNoOp: boolean;
}

const DragStateContext = React.createContext<DragStateContextValue>({
	activeDragHandleIds: [],
	dropIndicatorIndex: null,
	isDropNoOp: false,
});

export function useDragState(): DragStateContextValue {
	return React.useContext(DragStateContext);
}

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
	// Keep a ref to cells for stable access in the collision detection callback
	const cellsRef = React.useRef(cells);
	cellsRef.current = cells;
	// Track initial pointer position for cursor-following overlay (null = keyboard drag)
	const [dragPointerOrigin, setDragPointerOrigin] = React.useState<{ x: number; y: number } | null>(null);

	// The drop indicator index represents both the visual indicator position
	// (which AddCellButtons to highlight) and the insertion target for moveCells.
	// It is computed in the collision detection callback based on which half of
	// the "over" cell the pointer is in, and only causes a re-render when the
	// value actually changes.
	const [dropIndicatorIndex, setDropIndicatorIndex] = React.useState<number | null>(null);
	const dropIndicatorRef = React.useRef<number | null>(null);
	const [isDropNoOp, setIsDropNoOp] = React.useState(false);
	const isDropNoOpRef = React.useRef(false);

	// Require movement before drag starts (prevents accidental drags)
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: DRAG_ACTIVATION_DISTANCE_PX,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);

	// Pointer-based collision detection using containment. Returns the cell
	// the pointer is inside (or nearest to), and computes the drop indicator
	// index based on which half of that cell the pointer occupies:
	//   - Top half  -> indicator in the gap ABOVE the cell (index = cellIndex)
	//   - Bottom half -> indicator in the gap BELOW the cell (index = cellIndex + 1)
	const collisionDetection = React.useCallback<CollisionDetection>((args) => {
		const { pointerCoordinates, droppableRects, droppableContainers } = args;

		if (!pointerCoordinates) {
			return closestCenter(args);
		}

		// Exclude active item and secondary drag participants
		const excludeHandles = new Set(activeCellsRef.current.map(c => c.handle));
		const candidates = droppableContainers.filter(
			c => !excludeHandles.has(c.id as number)
		);

		// Find the cell the pointer is inside (distance 0) or nearest to
		let closestId: UniqueIdentifier | null = null;
		let closestDist = Infinity;

		for (const container of candidates) {
			const rect = droppableRects.get(container.id);
			if (!rect) { continue; }

			const top = rect.top;
			const bottom = rect.top + rect.height;
			let dist: number;

			if (pointerCoordinates.y < top) {
				dist = top - pointerCoordinates.y;
			} else if (pointerCoordinates.y > bottom) {
				dist = pointerCoordinates.y - bottom;
			} else {
				dist = 0;
			}

			if (dist < closestDist) {
				closestDist = dist;
				closestId = container.id;
			}
		}

		// Compute drop indicator index from pointer position within the cell
		if (closestId !== null) {
			const overRect = droppableRects.get(closestId);
			const overCellIndex = cellsRef.current.findIndex(c => c.handle === closestId);

			if (overRect && overCellIndex !== -1) {
				const midY = overRect.top + overRect.height / 2;
				const newIdx = pointerCoordinates.y < midY
					? overCellIndex       // top half: gap above cell
					: overCellIndex + 1;  // bottom half: gap below cell

				// Detect no-op positions (dropping the cell back where it
				// started). Any target from the first dragged index through
				// lastDraggedIndex + 1 produces no movement.
				const dragged = activeCellsRef.current;
				const minIdx = dragged.length > 0 ? dragged[0].index : -1;
				const maxIdx = dragged.length > 0 ? dragged[dragged.length - 1].index : -1;
				const noOp = newIdx >= minIdx && newIdx <= maxIdx + 1;

				if (noOp !== isDropNoOpRef.current) {
					isDropNoOpRef.current = noOp;
					setIsDropNoOp(noOp);
				}
				if (newIdx !== dropIndicatorRef.current) {
					dropIndicatorRef.current = newIdx;
					setDropIndicatorIndex(newIdx);
				}
			}

			return [{ id: closestId }];
		}

		return [];
	}, []);

	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		// Track pointer origin so the overlay can initialize at the right spot.
		// Keyboard-initiated drags produce a KeyboardEvent, not PointerEvent;
		// the cursor-following overlay is only shown for pointer drags.
		if (DOM.isPointerEvent(event.activatorEvent)) {
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

	const handleDragEnd = React.useCallback((event: DragEndEvent) => {
		const draggedCells = activeCellsRef.current;
		let targetIndex = dropIndicatorRef.current;

		const clearDragState = () => {
			activeCellsRef.current = [];
			dropIndicatorRef.current = null;
			isDropNoOpRef.current = false;
			DOM.getActiveWindow().requestAnimationFrame(() => {
				setActiveCells([]);
				setDropIndicatorIndex(null);
				setIsDropNoOp(false);
				setDragPointerOrigin(null);
				DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
			});
		};

		if (!event.over || draggedCells.length === 0) {
			clearDragState();
			return;
		}

		// Ignore drops onto cells that are part of the drag group
		const draggedHandles = new Set(draggedCells.map(c => c.handle));
		if (draggedHandles.has(event.over.id as number)) {
			clearDragState();
			return;
		}

		// For keyboard drags (no pointer coordinates), the collision
		// detection falls back to closestCenter and doesn't set the drop
		// indicator ref. Compute the target index from the over item.
		if (targetIndex === null) {
			const activeIndex = cellsRef.current.findIndex(c => c.handle === event.active.id);
			const overIndex = cellsRef.current.findIndex(c => c.handle === event.over!.id);
			if (activeIndex === -1 || overIndex === -1) {
				clearDragState();
				return;
			}
			targetIndex = activeIndex < overIndex ? overIndex + 1 : overIndex;
		}

		onReorder(draggedCells, targetIndex);
		clearDragState();
	}, [onReorder]);

	const handleDragCancel = React.useCallback(() => {
		activeCellsRef.current = [];
		dropIndicatorRef.current = null;
		isDropNoOpRef.current = false;
		DOM.getActiveWindow().requestAnimationFrame(() => {
			setActiveCells([]);
			setDropIndicatorIndex(null);
			setIsDropNoOp(false);
			setDragPointerOrigin(null);
			DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
		});
	}, []);

	// Memoize the context value to avoid unnecessary re-renders
	const dragStateValue = React.useMemo(() => ({
		activeDragHandleIds: activeCells.map(c => c.handle),
		dropIndicatorIndex,
		isDropNoOp,
	}), [activeCells, dropIndicatorIndex, isDropNoOp]);

	const sortableItems = React.useMemo(() => {
		return cells.map(c => c.handle);
	}, [cells]);

	// Re-measure droppable rects while dragging so that rects reflect the
	// collapsed active cell layout and collision detection stays accurate.
	const measuring = React.useMemo(() => ({
		droppable: {
			strategy: MeasuringStrategy.WhileDragging,
		},
	}), []);

	return (
		<DndContext
			collisionDetection={collisionDetection}
			measuring={measuring}
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
const DRAG_PREVIEW_MAX_CHARS = 80;

function DragPreview({ cells }: { cells: IPositronNotebookCell[] }) {
	const firstCell = cells[0];
	const content = firstCell.getContent();
	// Show first line, truncated
	const firstLine = content.split('\n')[0].slice(0, DRAG_PREVIEW_MAX_CHARS) || '(empty cell)';
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

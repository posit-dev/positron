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
	MeasuringStrategy,
} from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import * as DOM from '../../../../../base/browser/dom.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { computeDropIndex, resolveDraggedCells } from './sortableCellListLogic.js';

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

	// Pointer-based collision detection using containment. The pure logic
	// (closest-cell + drop-half + no-op detection) lives in computeDropIndex;
	// this callback adapts it to dnd-kit's CollisionDetection contract and
	// pushes results into React state.
	const collisionDetection = React.useCallback<CollisionDetection>((args) => {
		const { pointerCoordinates, droppableRects, droppableContainers } = args;

		if (!pointerCoordinates) {
			return closestCenter(args);
		}

		const result = computeDropIndex({
			pointerCoordinates,
			droppableContainers,
			droppableRects,
			activeCells: activeCellsRef.current,
			allCells: cellsRef.current,
		});

		if (!result) {
			return [];
		}

		if (result.isNoOp !== isDropNoOpRef.current) {
			isDropNoOpRef.current = result.isNoOp;
			setIsDropNoOp(result.isNoOp);
		}
		if (result.dropIndex !== dropIndicatorRef.current) {
			dropIndicatorRef.current = result.dropIndex;
			setDropIndicatorIndex(result.dropIndex);
		}

		return [{ id: result.closestId }];
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

		const selectedCells = getSelectedCells ? getSelectedCells() : [];
		const draggedCells = resolveDraggedCells(draggedCell, selectedCells);
		activeCellsRef.current = draggedCells;
		setActiveCells(draggedCells);
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

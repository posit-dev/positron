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

interface SortableCellListProps {
	cells: IPositronNotebookCell[];
	onReorder: (cells: IPositronNotebookCell[], targetIndex: number) => void;
	getSelectedCells?: () => IPositronNotebookCell[];
	children: React.ReactNode;
}

// Context to share active drag state with SortableCell components
interface DragStateContextValue {
	activeDragHandleIds: number[];
	overId: UniqueIdentifier | null;
}

const DragStateContext = React.createContext<DragStateContextValue>({
	activeDragHandleIds: [],
	overId: null,
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
	// Track which cell the cursor is currently over during drag
	const [overId, setOverId] = React.useState<UniqueIdentifier | null>(null);
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

	// During multi-drag, exclude secondary (non-primary) drag participants
	// from collision candidates so dnd-kit's strategy doesn't target their
	// positions. Uses a ref so the callback identity is stable.
	const collisionDetection = React.useCallback<CollisionDetection>((args) => {
		const secondary = activeCellsRef.current.slice(1);
		if (secondary.length === 0) {
			return closestCenter(args);
		}
		const secondaryHandles = new Set(secondary.map(c => c.handle));
		const filtered = args.droppableContainers.filter(
			c => !secondaryHandles.has(c.id as number)
		);
		return closestCenter({ ...args, droppableContainers: filtered });
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

	const handleDragOver = React.useCallback((event: DragOverEvent) => {
		setOverId(event.over?.id ?? null);
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
				setOverId(null);
				setDragPointerOrigin(null);
				DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
			});
		};

		if (!over) {
			clearDragState();
			return;
		}

		// Ignore drops onto cells that are part of the drag group
		const draggedHandles = new Set(draggedCells.map(c => c.handle));
		if (draggedHandles.has(over.id as number)) {
			clearDragState();
			return;
		}

		// Resolve the active and over indices
		const activeIndex = cells.findIndex(c => c.handle === active.id);
		const overIndex = cells.findIndex(c => c.handle === over.id);
		if (activeIndex === -1 || overIndex === -1) {
			clearDragState();
			return;
		}

		// Compute target index for moveCells:
		// Dragging up (active after over): insert BEFORE the over cell
		// Dragging down (active before over): insert AFTER the over cell
		const targetIndex = activeIndex < overIndex ? overIndex + 1 : overIndex;

		onReorder(draggedCells, targetIndex);
		clearDragState();
	}, [cells, onReorder]);

	const handleDragCancel = React.useCallback(() => {
		activeCellsRef.current = [];
		DOM.getActiveWindow().requestAnimationFrame(() => {
			setActiveCells([]);
			setOverId(null);
			setDragPointerOrigin(null);
			DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
		});
	}, []);

	// Memoize the context value to avoid unnecessary re-renders
	const dragStateValue = React.useMemo(() => ({
		activeDragHandleIds: activeCells.map(c => c.handle),
		overId,
	}), [activeCells, overId]);

	const sortableItems = React.useMemo(() => {
		return cells.map(c => c.handle);
	}, [cells]);

	return (
		<DndContext
			collisionDetection={collisionDetection}
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

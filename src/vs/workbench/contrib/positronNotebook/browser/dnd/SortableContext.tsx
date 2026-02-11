/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DndContext, useDndContext } from './DndContext.js';
import { DragOverlay } from './DragOverlay.js';
import { DragEndEvent, DragStartEvent } from './types.js';
import { sortableKeyboardCoordinates } from './keyboardCoordinates.js';
import { useAnimationContext } from './AnimationContext.js';
import { useOptionalMultiDragContext } from './MultiDragContext.js';

interface SortableContextProps {
	items: string[];
	children: React.ReactNode;
	onReorder: (oldIndex: number, newIndex: number) => void;
	onBatchReorder?: (fromIndices: number[], toIndex: number) => void;
	selectedIds?: string[];
	disabled?: boolean;
	onDragStart?: () => void;
	onDragEnd?: () => void;
	scrollContainerRef?: React.RefObject<HTMLElement>;
}

/**
 * Inner component that handles animation updates.
 * Must be rendered inside DndContext to access the animation context.
 */
function SortableAnimationManager({ items }: { items: string[] }) {
	const { state, getDroppableRects, getInitialDroppableRects } = useDndContext();
	const { updateSortingState, clearAnimations } = useAnimationContext();
	const multiDrag = useOptionalMultiDragContext();

	// Update animations when insertionIndex changes during drag
	React.useEffect(() => {
		if (state.status === 'dragging' && state.activeId) {
			// Use multi-drag activeIds if available, otherwise fall back to single activeId
			const activeIds = multiDrag?.state.activeIds.length
				? multiDrag.state.activeIds
				: [state.activeId];

			// Prefer scroll-adjusted initial rects (stable) to prevent feedback loops
			// where CSS transforms affect position calculations. Fall back to live rects
			// if initial rects are not available.
			const rects = getInitialDroppableRects() ?? getDroppableRects();
			updateSortingState(items, rects, activeIds, state.insertionIndex, true);
		} else {
			clearAnimations();
		}
	}, [state.status, state.activeId, state.insertionIndex, items, getDroppableRects, getInitialDroppableRects, updateSortingState, clearAnimations, multiDrag?.state.activeIds]);

	return null;
}

export function SortableContext({
	items,
	children,
	onReorder,
	onBatchReorder,
	selectedIds,
	disabled = false,
	onDragStart: onDragStartProp,
	onDragEnd: onDragEndProp,
	scrollContainerRef,
}: SortableContextProps) {
	const [, setActiveId] = React.useState<string | null>(null);
	const multiDrag = useOptionalMultiDragContext();

	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		const activeId = event.active.id;
		setActiveId(activeId);
		// Notify multi-drag context (if available)
		// Note: startMultiDrag reads selectedIds from its own ref to avoid stale closure issues
		multiDrag?.startMultiDrag(activeId);
		onDragStartProp?.();
	}, [multiDrag, onDragStartProp]);

	const handleDragEnd = React.useCallback((event: DragEndEvent) => {
		setActiveId(null);
		onDragEndProp?.();

		// Save activeIds BEFORE calling endMultiDrag (which clears them)
		// Use getActiveIds() for synchronous access (bypasses React state batching)
		// Call getActiveIds() once and store result to avoid any race conditions
		const multiDragIds = multiDrag?.getActiveIds() ?? [];
		const activeIds = multiDragIds.length > 0
			? [...multiDragIds]
			: [event.active.id];

		multiDrag?.endMultiDrag();

		const { insertionIndex } = event;

		if (insertionIndex === null) {
			return;
		}

		if (activeIds.length > 1 && onBatchReorder) {
			// Multi-cell: get sorted indices and call batch handler
			const fromIndices = activeIds
				.map((id: string) => items.indexOf(id))
				.filter((i: number) => i !== -1)
				.sort((a: number, b: number) => a - b);

			// Check if indices are contiguous
			const isContiguous = fromIndices.every(
				(idx: number, i: number) => i === 0 || idx === fromIndices[i - 1] + 1
			);

			if (isContiguous) {
				onBatchReorder(fromIndices, insertionIndex);
			} else {
				// Non-contiguous selection: only move the primary dragged cell
				const primaryIndex = items.indexOf(event.active.id);
				if (primaryIndex !== -1) {
					const newIndex = insertionIndex > primaryIndex
						? insertionIndex - 1
						: insertionIndex;
					if (primaryIndex !== newIndex) {
						onReorder(primaryIndex, newIndex);
					}
				}
			}
		} else {
			// Single-cell: existing logic
			const oldIndex = items.indexOf(event.active.id);
			if (oldIndex === -1) {
				return;
			}

			// Calculate the actual new index after removal
			// If insertionIndex > oldIndex: the item is removed first, so newIndex = insertionIndex - 1
			// If insertionIndex <= oldIndex: newIndex = insertionIndex
			const newIndex = insertionIndex > oldIndex ? insertionIndex - 1 : insertionIndex;

			if (oldIndex !== newIndex) {
				onReorder(oldIndex, newIndex);
			}
		}
	}, [items, onReorder, onBatchReorder, onDragEndProp, multiDrag]);

	const handleDragCancel = React.useCallback(() => {
		setActiveId(null);
		multiDrag?.cancelMultiDrag();
		onDragEndProp?.();
	}, [multiDrag, onDragEndProp]);

	if (disabled) {
		return (
			<DndContext items={items}>
				{children}
			</DndContext>
		);
	}

	return (
		<DndContext
			autoScroll={{ enabled: true, threshold: 100, speed: 15 }}
			items={items}
			keyboardCoordinateGetter={sortableKeyboardCoordinates}
			scrollContainerRef={scrollContainerRef}
			onDragCancel={handleDragCancel}
			onDragEnd={handleDragEnd}
			onDragStart={handleDragStart}
		>
			<SortableAnimationManager items={items} />
			{children}
			<DragOverlay items={items} />
		</DndContext>
	);
}

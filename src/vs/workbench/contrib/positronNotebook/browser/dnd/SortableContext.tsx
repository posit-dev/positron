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

interface SortableContextProps {
	items: string[];
	children: React.ReactNode;
	onReorder: (oldIndex: number, newIndex: number) => void;
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

	// Update animations when insertionIndex changes during drag
	React.useEffect(() => {
		if (state.status === 'dragging' && state.activeId) {
			// Prefer scroll-adjusted initial rects (stable) to prevent feedback loops
			// where CSS transforms affect position calculations. Fall back to live rects
			// if initial rects are not available.
			const rects = getInitialDroppableRects() ?? getDroppableRects();
			updateSortingState(items, rects, state.activeId, state.insertionIndex);
		} else {
			clearAnimations();
		}
	}, [state.status, state.activeId, state.insertionIndex, items, getDroppableRects, getInitialDroppableRects, updateSortingState, clearAnimations]);

	return null;
}

export function SortableContext({
	items,
	children,
	onReorder,
	disabled = false,
	onDragStart: onDragStartProp,
	onDragEnd: onDragEndProp,
	scrollContainerRef,
}: SortableContextProps) {
	const [, setActiveId] = React.useState<string | null>(null);

	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		setActiveId(event.active.id);
		onDragStartProp?.();
	}, [onDragStartProp]);

	const handleDragEnd = React.useCallback((event: DragEndEvent) => {
		setActiveId(null);
		onDragEndProp?.();

		const { insertionIndex } = event;
		if (insertionIndex === null) {
			return;
		}

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
	}, [items, onReorder, onDragEndProp]);

	const handleDragCancel = React.useCallback(() => {
		setActiveId(null);
		onDragEndProp?.();
	}, [onDragEndProp]);

	if (disabled) {
		return <>{children}</>;
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

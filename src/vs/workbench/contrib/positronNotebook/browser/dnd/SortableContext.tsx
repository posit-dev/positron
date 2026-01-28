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
	renderDragOverlay?: (activeId: string) => React.ReactNode;
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
	const { state, getDroppableRects } = useDndContext();
	const { updateSortingState, clearAnimations } = useAnimationContext();

	// Update animations when overId changes during drag
	React.useEffect(() => {
		if (state.status === 'dragging' && state.activeId) {
			const rects = getDroppableRects();
			updateSortingState(items, rects, state.activeId, state.overId);
		} else {
			clearAnimations();
		}
	}, [state.status, state.activeId, state.overId, items, getDroppableRects, updateSortingState, clearAnimations]);

	return null;
}

export function SortableContext({
	items,
	children,
	onReorder,
	renderDragOverlay,
	disabled = false,
	onDragStart: onDragStartProp,
	onDragEnd: onDragEndProp,
	scrollContainerRef,
}: SortableContextProps) {
	const [activeId, setActiveId] = React.useState<string | null>(null);

	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		setActiveId(event.active.id);
		onDragStartProp?.();
	}, [onDragStartProp]);

	const handleDragEnd = React.useCallback((event: DragEndEvent) => {
		setActiveId(null);
		onDragEndProp?.();

		if (!event.over) {
			return;
		}

		const oldIndex = items.indexOf(event.active.id);
		const newIndex = items.indexOf(event.over.id);

		if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
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
			keyboardCoordinateGetter={sortableKeyboardCoordinates}
			scrollContainerRef={scrollContainerRef}
			onDragCancel={handleDragCancel}
			onDragEnd={handleDragEnd}
			onDragStart={handleDragStart}
		>
			<SortableAnimationManager items={items} />
			{children}
			<DragOverlay>
				{activeId && renderDragOverlay ? renderDragOverlay(activeId) : null}
			</DragOverlay>
		</DndContext>
	);
}

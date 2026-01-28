/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useDraggable } from './useDraggable.js';
import { useDroppable } from './useDroppable.js';
import { useAnimationContext } from './AnimationContext.js';

interface UseSortableProps {
	id: string;
}

export function useSortable({ id }: UseSortableProps) {
	const draggable = useDraggable({ id });
	const droppable = useDroppable({ id });
	const { getTransform, getTransitionStyle } = useAnimationContext();

	// Get animation transform for this item
	const animationTransform = getTransform(id);
	const transition = getTransitionStyle();

	// Combine refs
	const setNodeRef = React.useCallback((node: HTMLElement | null) => {
		draggable.setNodeRef(node);
		droppable.setNodeRef(node);
	}, [draggable.setNodeRef, droppable.setNodeRef]);

	// Combine drag transform with animation transform
	// When dragging, the item follows the cursor (via DragOverlay, not transform)
	// When not dragging, apply animation transform if item needs to shift
	const combinedTransform = draggable.isDragging
		? draggable.transform
		: animationTransform;

	return {
		setNodeRef,
		setActivatorNodeRef: draggable.setActivatorNodeRef,
		attributes: draggable.attributes,
		listeners: draggable.listeners,
		isDragging: draggable.isDragging,
		isOver: droppable.isOver,
		transform: combinedTransform,
		// Apply transition only when not dragging (for smooth FLIP animations)
		transition: draggable.isDragging ? undefined : transition,
	};
}

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
	const transform = getTransform(id);
	const transition = getTransitionStyle();

	// Extract stable refs before using in deps
	const { setNodeRef: setDraggableRef } = draggable;
	const { setNodeRef: setDroppableRef } = droppable;

	// Combine refs
	const setNodeRef = React.useCallback((node: HTMLElement | null) => {
		setDraggableRef(node);
		setDroppableRef(node);
	}, [setDraggableRef, setDroppableRef]);

	return {
		setNodeRef,
		setActivatorNodeRef: draggable.setActivatorNodeRef,
		attributes: draggable.attributes,
		listeners: draggable.listeners,
		isDragging: draggable.isDragging,
		isOver: droppable.isOver,
		transform,
		transition,
	};
}

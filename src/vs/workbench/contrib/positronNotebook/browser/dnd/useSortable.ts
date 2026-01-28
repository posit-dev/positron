/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useDraggable } from './useDraggable.js';
import { useDroppable } from './useDroppable.js';

interface UseSortableProps {
	id: string;
}

export function useSortable({ id }: UseSortableProps) {
	const draggable = useDraggable({ id });
	const droppable = useDroppable({ id });

	// Combine refs
	const setNodeRef = React.useCallback((node: HTMLElement | null) => {
		draggable.setNodeRef(node);
		droppable.setNodeRef(node);
	}, [draggable.setNodeRef, droppable.setNodeRef]);

	return {
		setNodeRef,
		setActivatorNodeRef: draggable.setActivatorNodeRef,
		attributes: draggable.attributes,
		listeners: draggable.listeners,
		isDragging: draggable.isDragging,
		isOver: droppable.isOver,
		transform: draggable.transform,
		// Transition will be added in Plan 03 (animations)
		transition: undefined as string | undefined,
	};
}

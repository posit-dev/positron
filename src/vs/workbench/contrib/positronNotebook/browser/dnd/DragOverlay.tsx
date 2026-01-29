/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useDndContext } from './DndContext.js';

interface SnapPosition {
	x: number;
	y: number;
}

/**
 * Calculates the position where the overlay should snap to when hovering over a drop target.
 * Returns null if the overlay should follow the cursor instead.
 */
function calculateSnapPosition(
	activeId: string,
	overId: string | null,
	items: string[],
	droppableRects: Map<string, DOMRect>,
	initialRect: DOMRect
): SnapPosition | null {
	if (!overId || activeId === overId) {
		return null;
	}

	const activeIndex = items.indexOf(activeId);
	const overIndex = items.indexOf(overId);
	const overRect = droppableRects.get(overId);

	if (!overRect || activeIndex === -1 || overIndex === -1) {
		return null;
	}

	// Calculate gap position based on drag direction
	if (activeIndex < overIndex) {
		// Dragging down: snap to bottom of over item
		return { x: initialRect.left, y: overRect.bottom - initialRect.height };
	} else {
		// Dragging up: snap to top of over item
		return { x: initialRect.left, y: overRect.top };
	}
}

interface DragOverlayProps {
	children: React.ReactNode;
	items?: string[];
}

export function DragOverlay({ children, items = [] }: DragOverlayProps) {
	const { state, getDroppableRects } = useDndContext();
	const [isSnapping, setIsSnapping] = React.useState(false);
	const prevOverIdRef = React.useRef<string | null>(null);

	// Track overId changes to enable/disable transitions
	React.useEffect(() => {
		if (state.status !== 'dragging') {
			setIsSnapping(false);
			prevOverIdRef.current = null;
			return;
		}

		// Enable snapping transition when we have a valid drop target
		if (state.overId && state.overId !== state.activeId) {
			setIsSnapping(true);
		} else {
			// Disable transition when not over a valid target (follow cursor directly)
			setIsSnapping(false);
		}

		prevOverIdRef.current = state.overId;
	}, [state.status, state.overId, state.activeId]);

	if (state.status !== 'dragging' || !state.currentPosition || !state.initialPosition) {
		return null;
	}

	// Calculate cursor delta from initial position
	const deltaX = state.currentPosition.x - state.initialPosition.x;
	const deltaY = state.currentPosition.y - state.initialPosition.y;

	// Position overlay at: initial element position + cursor delta
	// This makes the overlay move with the cursor while maintaining the same
	// relative position as when the drag started
	let left = 0;
	let top = 0;

	if (state.initialRect) {
		// Check if we should snap to gap position
		const droppableRects = getDroppableRects();
		const snapPosition = state.activeId
			? calculateSnapPosition(state.activeId, state.overId, items, droppableRects, state.initialRect)
			: null;

		if (snapPosition) {
			// Snap to the calculated gap position
			left = snapPosition.x;
			top = snapPosition.y;
		} else {
			// Use the stored initial rect for accurate positioning (follow cursor)
			left = state.initialRect.left + deltaX;
			top = state.initialRect.top + deltaY;
		}
	} else {
		// Fallback: position at cursor (less accurate but functional)
		left = state.currentPosition.x - 20;
		top = state.currentPosition.y - 20;
	}

	const style: React.CSSProperties = {
		position: 'fixed',
		left: `${left}px`,
		top: `${top}px`,
		width: state.initialRect ? `${state.initialRect.width}px` : undefined,
		pointerEvents: 'none',
		zIndex: 9999,
		boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
		opacity: 0.95,
		// Smooth transition when snapping to gap, no transition when following cursor
		transition: isSnapping ? 'left 150ms ease, top 150ms ease' : 'none',
	};

	// Render to a portal to escape any overflow: hidden ancestors
	return ReactDOM.createPortal(
		<div className="dnd-overlay" style={style}>
			{children}
		</div>,
		document.body
	);
}

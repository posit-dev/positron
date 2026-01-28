/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useDndContext } from './DndContext.js';

interface DragOverlayProps {
	children: React.ReactNode;
}

export function DragOverlay({ children }: DragOverlayProps) {
	const { state } = useDndContext();

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
		// Use the stored initial rect for accurate positioning
		left = state.initialRect.left + deltaX;
		top = state.initialRect.top + deltaY;
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
	};

	// Render to a portal to escape any overflow: hidden ancestors
	return ReactDOM.createPortal(
		<div className="dnd-overlay" style={style}>
			{children}
		</div>,
		document.body
	);
}

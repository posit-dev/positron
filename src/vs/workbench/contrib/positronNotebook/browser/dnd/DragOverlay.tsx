/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useDndContext } from './DndContext.js';

// Debug mode - set to true to visualize DnD calculations
const DND_DEBUG = true;

interface SnapPosition {
	x: number;
	y: number;
}

/**
 * Snap-to-gap is disabled. The overlay follows the cursor instead.
 *
 * Visual feedback for drop position comes from the FLIP animations
 * that shift cells to show where the dragged item will be inserted.
 *
 * Previous attempts at snap-to-gap had issues:
 * - Snap position didn't match FLIP animation state
 * - Tall cells caused snap to be off-screen
 * - Scroll position made calculations unreliable
 */
function calculateSnapPosition(
	_activeId: string,
	_overId: string | null,
	_items: string[],
	_droppableRects: Map<string, DOMRect>,
	_initialRect: DOMRect,
	_cursorY: number
): SnapPosition | null {
	// Return null to disable snapping - overlay follows cursor
	return null;
}

/**
 * Debug visualization component that renders overlays showing DnD state
 */
function DebugOverlay({
	droppableRects,
	items,
	activeId,
	overId,
	insertionIndex,
	snapPosition,
	cursorPosition,
	initialRect,
}: {
	droppableRects: Map<string, DOMRect>;
	items: string[];
	activeId: string | null;
	overId: string | null;
	insertionIndex: number | null;
	snapPosition: SnapPosition | null;
	cursorPosition: { x: number; y: number } | null;
	initialRect: DOMRect | null;
}) {
	if (!DND_DEBUG) {
		return null;
	}

	const activeIndex = activeId ? items.indexOf(activeId) : -1;
	const overIndex = overId ? items.indexOf(overId) : -1;

	// Describe where the item will be inserted
	const getInsertionDescription = () => {
		if (insertionIndex === null || activeIndex === -1) {
			return 'none';
		}
		if (insertionIndex === 0) {
			return 'before first item';
		}
		if (insertionIndex === items.length) {
			return 'after last item';
		}
		return `before item ${insertionIndex}`;
	};

	return ReactDOM.createPortal(
		<>
			{/* Debug info panel */}
			<div style={{
				position: 'fixed',
				top: 10,
				right: 10,
				background: 'rgba(0,0,0,0.85)',
				color: '#fff',
				padding: 12,
				borderRadius: 6,
				fontSize: 11,
				fontFamily: 'monospace',
				zIndex: 10001,
				maxWidth: 320,
				lineHeight: 1.4,
			}}>
				<div style={{ fontWeight: 'bold', marginBottom: 8, color: '#4fc3f7' }}>DnD Debug</div>
				<div><b>activeId:</b> {activeId ?? 'null'} (idx: {activeIndex})</div>
				<div><b>overId:</b> {overId ?? 'null'} (idx: {overIndex})</div>
				<div style={{ color: '#4caf50' }}>
					<b>insertionIndex:</b> {insertionIndex ?? 'null'} ({getInsertionDescription()})
				</div>
				<div><b>items:</b> {items.length} cells</div>
				<div style={{ marginTop: 8, borderTop: '1px solid #555', paddingTop: 8 }}>
					<div style={{ color: snapPosition ? '#4caf50' : '#ff9800' }}>
						<b>snapPosition:</b> {snapPosition ? `(${Math.round(snapPosition.x)}, ${Math.round(snapPosition.y)})` : 'null (following cursor)'}
					</div>
					{cursorPosition && (
						<div><b>cursor:</b> ({Math.round(cursorPosition.x)}, {Math.round(cursorPosition.y)})</div>
					)}
					{initialRect && (
						<div><b>initialRect:</b> ({Math.round(initialRect.left)}, {Math.round(initialRect.top)}) {Math.round(initialRect.width)}x{Math.round(initialRect.height)}</div>
					)}
					{overId && droppableRects.get(overId) && (
						<div><b>overRect (shifted):</b> top={Math.round(droppableRects.get(overId)!.top)}, bottom={Math.round(droppableRects.get(overId)!.bottom)}, h={Math.round(droppableRects.get(overId)!.height)}</div>
					)}
					<div style={{ marginTop: 4, color: '#aaa', fontSize: 10 }}>
						{activeIndex !== -1 && insertionIndex !== null && (
							<span>Direction: {insertionIndex > activeIndex ? 'DOWN ↓' : insertionIndex < activeIndex ? 'UP ↑' : 'SAME'}</span>
						)}
					</div>
				</div>
				<div style={{ marginTop: 8, fontSize: 10, color: '#aaa' }}>
					<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
						<span><span style={{ color: '#f44336' }}>■</span> active cell</span>
						<span><span style={{ color: '#4caf50' }}>■</span> over cell</span>
						<span><span style={{ color: '#2196f3' }}>■</span> other cells</span>
						<span><span style={{ color: '#ffeb3b' }}>●</span> snap target</span>
					</div>
				</div>
			</div>

			{/* Render rect overlays for each droppable */}
			{Array.from(droppableRects.entries()).map(([id, rect], idx) => {
				const isActive = id === activeId;
				const isOver = id === overId;
				let borderColor = '#2196f3'; // blue for normal
				let bgColor = 'rgba(33, 150, 243, 0.1)';
				if (isActive) {
					borderColor = '#f44336'; // red for active
					bgColor = 'rgba(244, 67, 54, 0.15)';
				} else if (isOver) {
					borderColor = '#4caf50'; // green for over
					bgColor = 'rgba(76, 175, 80, 0.2)';
				}

				return (
					<div
						key={id}
						style={{
							position: 'fixed',
							left: rect.left,
							top: rect.top,
							width: rect.width,
							height: rect.height,
							border: `2px dashed ${borderColor}`,
							background: bgColor,
							pointerEvents: 'none',
							zIndex: 10000,
							display: 'flex',
							alignItems: 'flex-start',
							justifyContent: 'flex-start',
						}}
					>
						<span style={{
							background: borderColor,
							color: '#fff',
							fontSize: 10,
							padding: '2px 6px',
							fontFamily: 'monospace',
						}}>
							{idx}: {id.slice(0, 8)}...
							{isActive && ' [ACTIVE]'}
							{isOver && ' [OVER]'}
						</span>
					</div>
				);
			})}

			{/* Snap position marker */}
			{snapPosition && initialRect && (
				<div
					style={{
						position: 'fixed',
						left: snapPosition.x,
						top: snapPosition.y,
						width: initialRect.width,
						height: Math.min(initialRect.height, 60),
						border: '3px solid #ffeb3b',
						background: 'rgba(255, 235, 59, 0.3)',
						pointerEvents: 'none',
						zIndex: 10000,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<span style={{
						background: '#ffeb3b',
						color: '#000',
						fontSize: 11,
						padding: '2px 8px',
						fontWeight: 'bold',
						fontFamily: 'monospace',
					}}>
						SNAP TARGET
					</span>
				</div>
			)}
		</>,
		document.body
	);
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

	// Get droppable rects once for both debug and positioning
	const droppableRects = getDroppableRects();

	// Calculate snap position (used for both overlay and debug)
	const snapPosition = state.status === 'dragging' && state.activeId && state.initialRect && state.currentPosition
		? calculateSnapPosition(state.activeId, state.overId, items, droppableRects, state.initialRect, state.currentPosition.y)
		: null;

	// Always render debug overlay when dragging (even if no children)
	const debugOverlay = state.status === 'dragging' ? (
		<DebugOverlay
			activeId={state.activeId}
			cursorPosition={state.currentPosition}
			droppableRects={droppableRects}
			initialRect={state.initialRect}
			insertionIndex={state.insertionIndex}
			items={items}
			overId={state.overId}
			snapPosition={snapPosition}
		/>
	) : null;

	if (state.status !== 'dragging' || !state.currentPosition || !state.initialPosition) {
		return debugOverlay;
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
	return (
		<>
			{debugOverlay}
			{ReactDOM.createPortal(
				<div className="dnd-overlay" style={style}>
					{children}
				</div>,
				document.body
			)}
		</>
	);
}

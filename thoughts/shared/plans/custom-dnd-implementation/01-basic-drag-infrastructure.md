---
type: implementation-plan
title: "Plan 01: Basic Drag Infrastructure"
created: 2026-01-28
status: draft
estimated_scope: "~400 lines of code"
prerequisites: none
---

# Plan 01: Basic Drag Infrastructure

## Context Loading Instructions

**BEFORE starting implementation, the agent MUST:**

1. Read `thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md`
2. Read this file completely
3. Run prerequisite verification (below)

## Prerequisites Verification

```bash
# Verify current dnd-kit implementation works
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list

# Verify build works
npm run compile
```

All tests should pass before proceeding.

## Objective

Create the foundational drag-and-drop infrastructure using pointer events. This plan produces a working (but basic) drag-and-drop that passes E2E tests, without animations or keyboard support.

## What We're Building

```
src/vs/workbench/contrib/positronNotebook/browser/dnd/
├── DndContext.tsx          # React context for drag state
├── useDraggable.ts         # Hook for draggable items
├── useDroppable.ts         # Hook for drop zones
├── collisionDetection.ts   # Simple closest-center algorithm
├── DragOverlay.tsx         # Preview that follows cursor
└── index.ts                # Public exports
```

## What We're NOT Doing (Deferred to Later Plans)

- Keyboard navigation (Plan 02)
- Auto-scroll (Plan 02)
- FLIP animations (Plan 03)
- Screen reader announcements (Plan 03)
- Touch support (Plan 04)

## Implementation Steps

### Step 1: Create Directory Structure

```bash
mkdir -p src/vs/workbench/contrib/positronNotebook/browser/dnd
```

### Step 2: Create Core Types

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/types.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DragState {
	status: 'idle' | 'dragging';
	activeId: string | null;
	overId: string | null;
	initialPosition: { x: number; y: number } | null;
	currentPosition: { x: number; y: number } | null;
	// Initial rect of the dragged element - used for overlay positioning
	initialRect: DOMRect | null;
}

export interface DroppableEntry {
	id: string;
	node: HTMLElement;
	rect: DOMRect;
}

export interface DragStartEvent {
	active: { id: string };
}

export interface DragMoveEvent {
	active: { id: string };
	over: { id: string } | null;
	delta: { x: number; y: number };
}

export interface DragEndEvent {
	active: { id: string };
	over: { id: string } | null;
}

export interface DragCancelEvent {
	active: { id: string };
}
```

### Step 3: Create Collision Detection

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/collisionDetection.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DroppableEntry } from './types.js';

/**
 * Find the droppable closest to the given point using center-to-center distance.
 * This is the same algorithm as dnd-kit's closestCenter.
 */
export function closestCenter(
	point: { x: number; y: number },
	droppables: DroppableEntry[],
	activeId: string | null
): DroppableEntry | null {
	let closest: DroppableEntry | null = null;
	let minDistance = Infinity;

	for (const droppable of droppables) {
		// Skip the currently dragged item
		if (droppable.id === activeId) {
			continue;
		}

		const centerX = droppable.rect.left + droppable.rect.width / 2;
		const centerY = droppable.rect.top + droppable.rect.height / 2;

		const distance = Math.sqrt(
			Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2)
		);

		if (distance < minDistance) {
			minDistance = distance;
			closest = droppable;
		}
	}

	return closest;
}
```

### Step 4: Create DndContext

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/DndContext.tsx`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DragState, DroppableEntry, DragStartEvent, DragEndEvent, DragCancelEvent } from './types.js';
import { closestCenter } from './collisionDetection.js';

interface DndContextValue {
	state: DragState;
	registerDroppable: (id: string, node: HTMLElement) => void;
	unregisterDroppable: (id: string) => void;
	startDrag: (id: string, position: { x: number; y: number }, initialRect: DOMRect | null) => void;
	updateDrag: (position: { x: number; y: number }) => void;
	endDrag: () => void;
	cancelDrag: () => void;
}

const DndReactContext = React.createContext<DndContextValue | null>(null);

interface DndContextProps {
	children: React.ReactNode;
	onDragStart?: (event: DragStartEvent) => void;
	onDragEnd?: (event: DragEndEvent) => void;
	onDragCancel?: (event: DragCancelEvent) => void;
	activationDistance?: number; // Pixels to move before drag activates (default: 10)
}

export function DndContext({
	children,
	onDragStart,
	onDragEnd,
	onDragCancel,
	activationDistance = 10,
}: DndContextProps) {
	const [state, setState] = React.useState<DragState>({
		status: 'idle',
		activeId: null,
		overId: null,
		initialPosition: null,
		currentPosition: null,
		initialRect: null,
	});

	const droppablesRef = React.useRef<Map<string, DroppableEntry>>(new Map());
	const pendingDragRef = React.useRef<{
		id: string;
		startPosition: { x: number; y: number };
		initialRect: DOMRect | null;
	} | null>(null);

	const registerDroppable = React.useCallback((id: string, node: HTMLElement) => {
		droppablesRef.current.set(id, {
			id,
			node,
			rect: node.getBoundingClientRect(),
		});
	}, []);

	const unregisterDroppable = React.useCallback((id: string) => {
		droppablesRef.current.delete(id);
	}, []);

	const startDrag = React.useCallback((id: string, position: { x: number; y: number }, initialRect: DOMRect | null) => {
		// Store pending drag - actual drag starts after activation distance
		pendingDragRef.current = { id, startPosition: position, initialRect };
	}, []);

	const updateDrag = React.useCallback((position: { x: number; y: number }) => {
		// Check if we need to activate pending drag
		if (pendingDragRef.current && state.status === 'idle') {
			const { id, startPosition, initialRect } = pendingDragRef.current;
			const distance = Math.sqrt(
				Math.pow(position.x - startPosition.x, 2) +
				Math.pow(position.y - startPosition.y, 2)
			);

			if (distance >= activationDistance) {
				// Activate drag
				pendingDragRef.current = null;
				setState({
					status: 'dragging',
					activeId: id,
					overId: null,
					initialPosition: startPosition,
					currentPosition: position,
					initialRect,
				});
				onDragStart?.({ active: { id } });
				return;
			}
			return;
		}

		if (state.status !== 'dragging') {
			return;
		}

		// Update droppable rects (they may have changed)
		for (const [id, entry] of droppablesRef.current) {
			entry.rect = entry.node.getBoundingClientRect();
		}

		// Find closest droppable
		const closest = closestCenter(
			position,
			Array.from(droppablesRef.current.values()),
			state.activeId
		);

		setState(prev => ({
			...prev,
			currentPosition: position,
			overId: closest?.id ?? null,
		}));
	}, [state.status, state.activeId, activationDistance, onDragStart]);

	const endDrag = React.useCallback(() => {
		pendingDragRef.current = null;

		if (state.status !== 'dragging') {
			return;
		}

		onDragEnd?.({
			active: { id: state.activeId! },
			over: state.overId ? { id: state.overId } : null,
		});

		setState({
			status: 'idle',
			activeId: null,
			overId: null,
			initialPosition: null,
			currentPosition: null,
			initialRect: null,
		});
	}, [state, onDragEnd]);

	const cancelDrag = React.useCallback(() => {
		pendingDragRef.current = null;

		if (state.status !== 'dragging') {
			return;
		}

		onDragCancel?.({ active: { id: state.activeId! } });

		setState({
			status: 'idle',
			activeId: null,
			overId: null,
			initialPosition: null,
			currentPosition: null,
			initialRect: null,
		});
	}, [state, onDragCancel]);

	// Global pointer event handlers
	React.useEffect(() => {
		const handlePointerMove = (e: PointerEvent) => {
			updateDrag({ x: e.clientX, y: e.clientY });
		};

		const handlePointerUp = () => {
			endDrag();
		};

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				cancelDrag();
			}
		};

		if (state.status === 'dragging' || pendingDragRef.current) {
			window.addEventListener('pointermove', handlePointerMove);
			window.addEventListener('pointerup', handlePointerUp);
			window.addEventListener('keydown', handleKeyDown);
		}

		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [state.status, updateDrag, endDrag, cancelDrag]);

	const value = React.useMemo(
		() => ({
			state,
			registerDroppable,
			unregisterDroppable,
			startDrag,
			updateDrag,
			endDrag,
			cancelDrag,
		}),
		[state, registerDroppable, unregisterDroppable, startDrag, updateDrag, endDrag, cancelDrag]
	);

	return (
		<DndReactContext.Provider value={value}>
			{children}
		</DndReactContext.Provider>
	);
}

export function useDndContext() {
	const context = React.useContext(DndReactContext);
	if (!context) {
		throw new Error('useDndContext must be used within a DndContext');
	}
	return context;
}
```

### Step 5: Create useDraggable Hook

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/useDraggable.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useDndContext } from './DndContext.js';

interface UseDraggableProps {
	id: string;
}

export function useDraggable({ id }: UseDraggableProps) {
	const { state, startDrag } = useDndContext();
	const nodeRef = React.useRef<HTMLElement | null>(null);
	const activatorRef = React.useRef<HTMLElement | null>(null);

	const isDragging = state.activeId === id;

	const setNodeRef = React.useCallback((node: HTMLElement | null) => {
		nodeRef.current = node;
	}, []);

	const setActivatorNodeRef = React.useCallback((node: HTMLElement | null) => {
		activatorRef.current = node;
	}, []);

	const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		// Store initial element rect for overlay positioning
		const rect = nodeRef.current?.getBoundingClientRect();
		startDrag(id, { x: e.clientX, y: e.clientY }, rect ?? null);
	}, [id, startDrag]);

	// Attributes for the draggable element
	const attributes = {
		role: 'button',
		tabIndex: 0,
		'aria-pressed': isDragging,
		'aria-describedby': `dnd-instructions-${id}`,
	};

	// Event listeners for the activator (drag handle)
	const listeners = {
		onPointerDown: handlePointerDown,
	};

	// NOTE: The dragging item does NOT get a cursor-following transform.
	// - The DragOverlay follows the cursor (rendered in portal)
	// - The original element stays in place with reduced opacity
	// - FLIP transforms (items shifting) are calculated in Plan 03's animation system
	// For now, return null. Plan 03 will add FLIP transforms for non-dragging items.

	return {
		setNodeRef,
		setActivatorNodeRef,
		attributes,
		listeners,
		isDragging,
		transform: null, // FLIP transforms added in Plan 03
		nodeRef, // Expose for initial rect access
	};
}
```

### Step 6: Create useDroppable Hook

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/useDroppable.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useDndContext } from './DndContext.js';

interface UseDroppableProps {
	id: string;
}

export function useDroppable({ id }: UseDroppableProps) {
	const { state, registerDroppable, unregisterDroppable } = useDndContext();
	const nodeRef = React.useRef<HTMLElement | null>(null);

	const isOver = state.overId === id;

	const setNodeRef = React.useCallback((node: HTMLElement | null) => {
		if (nodeRef.current) {
			unregisterDroppable(id);
		}
		nodeRef.current = node;
		if (node) {
			registerDroppable(id, node);
		}
	}, [id, registerDroppable, unregisterDroppable]);

	// Cleanup on unmount
	React.useEffect(() => {
		return () => {
			unregisterDroppable(id);
		};
	}, [id, unregisterDroppable]);

	return {
		setNodeRef,
		isOver,
	};
}
```

### Step 7: Create DragOverlay

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/DragOverlay.tsx`

```typescript
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
		<div style={style} className="dnd-overlay">
			{children}
		</div>,
		document.body
	);
}
```

### Step 8: Create Public Exports

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/index.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export { DndContext, useDndContext } from './DndContext.js';
export { useDraggable } from './useDraggable.js';
export { useDroppable } from './useDroppable.js';
export { DragOverlay } from './DragOverlay.js';
export { closestCenter } from './collisionDetection.js';
export { SortableContext } from './SortableContext.js';
export { useSortable } from './useSortable.js';
export type {
	DragState,
	DragStartEvent,
	DragEndEvent,
	DragCancelEvent,
	DroppableEntry,
} from './types.js';
```

### Step 9: Create Sortable Wrapper Components

These components provide a higher-level API similar to what dnd-kit/sortable provides.

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/SortableContext.tsx`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DndContext, useDndContext } from './DndContext.js';
import { DragOverlay } from './DragOverlay.js';
import { DragEndEvent, DragStartEvent } from './types.js';

interface SortableContextProps {
	items: string[];
	children: React.ReactNode;
	onReorder: (oldIndex: number, newIndex: number) => void;
	renderDragOverlay?: (activeId: string) => React.ReactNode;
	disabled?: boolean;
	onDragStart?: () => void;
	onDragEnd?: () => void;
}

export function SortableContext({
	items,
	children,
	onReorder,
	renderDragOverlay,
	disabled = false,
	onDragStart: onDragStartProp,
	onDragEnd: onDragEndProp,
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
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={handleDragCancel}
		>
			{children}
			<DragOverlay>
				{activeId && renderDragOverlay ? renderDragOverlay(activeId) : null}
			</DragOverlay>
		</DndContext>
	);
}
```

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/useSortable.ts`

```typescript
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
```

### Step 10: Update SortableCellList to Use Custom Implementation

**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCellList.tsx`

Replace dnd-kit imports with custom implementation. **Important**: Preserve the body class management from the original implementation.

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
// Replace dnd-kit imports with custom implementation
import { SortableContext } from '../dnd/SortableContext.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

interface SortableCellListProps {
	cells: IPositronNotebookCell[];
	onReorder: (oldIndex: number, newIndex: number) => void;
	children: React.ReactNode;
	renderDragOverlay?: (cell: IPositronNotebookCell) => React.ReactNode;
	disabled?: boolean; // For read-only mode
}

export function SortableCellList({
	cells,
	onReorder,
	children,
	renderDragOverlay,
	disabled = false,
}: SortableCellListProps) {
	const items = React.useMemo(
		() => cells.map(c => c.handleId),
		[cells]
	);

	// Callbacks to manage body class for drag styling (cursor, etc.)
	const handleDragStart = React.useCallback(() => {
		DOM.getActiveWindow().document.body.classList.add('dragging-notebook-cell');
	}, []);

	const handleDragEnd = React.useCallback(() => {
		DOM.getActiveWindow().document.body.classList.remove('dragging-notebook-cell');
	}, []);

	const renderOverlay = React.useCallback((activeId: string) => {
		if (!renderDragOverlay) {
			return null;
		}
		const cell = cells.find(c => c.handleId === activeId);
		return cell ? (
			<div className="cell-drag-overlay">
				{renderDragOverlay(cell)}
			</div>
		) : null;
	}, [cells, renderDragOverlay]);

	return (
		<SortableContext
			items={items}
			onReorder={onReorder}
			renderDragOverlay={renderOverlay}
			disabled={disabled}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			{children}
		</SortableContext>
	);
}
```

### Step 11: Update SortableCell to Use Custom Implementation

**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCell.tsx`

**Important**: Preserve the existing behavior:
- CSS import for styles
- `maxDragHeight` logic to limit overlay size for large cells
- `useNotebookInstance()` for container reference
- Conditional content wrapping when dragging

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './SortableCell.css';

// React.
import * as React from 'react';
// Replace dnd-kit imports with custom implementation
import { useSortable } from '../dnd/useSortable.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';

interface SortableCellProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}

export function SortableCell({ cell, children }: SortableCellProps) {
	const notebookInstance = useNotebookInstance();
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: cell.handleId });

	// Calculate max height for dragging state (1/3 of container height)
	// Use a minimum of 200px to ensure the cell remains visible
	const maxDragHeight = React.useMemo(() => {
		const container = notebookInstance.cellsContainer;
		const height = container?.clientHeight || DOM.getActiveWindow().innerHeight;
		const calculatedHeight = Math.floor(height / 3);
		return Math.max(calculatedHeight, 200);
	}, [notebookInstance.cellsContainer]);

	// Build transform string (for FLIP animations in Plan 03)
	const transformStyle = transform
		? `translate3d(${transform.x}px, ${transform.y}px, 0)`
		: undefined;

	const style: React.CSSProperties = {
		transform: transformStyle,
		transition,
		opacity: isDragging ? 0.5 : 1,
		position: 'relative',
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={isDragging ? 'sortable-cell dragging' : 'sortable-cell'}
		>
			<button
				ref={setActivatorNodeRef}
				className="cell-drag-handle"
				type="button"
				aria-label="Drag to reorder cell"
				{...attributes}
				{...listeners}
			>
				<span className="codicon codicon-gripper" />
			</button>
			{/* Wrap content with max height constraint when dragging to limit overlay size */}
			{isDragging ? (
				<div className="drag-content-wrapper" style={{ maxHeight: maxDragHeight }}>
					{children}
				</div>
			) : children}
		</div>
	);
}
```

## Verification Checklist

After implementation, run these checks:

```bash
# 1. TypeScript compilation
npm run compile

# 2. E2E tests - see TEST-EXPECTATIONS.md for details
# Plan 01 expects 13/14 tests to pass (auto-scroll test will fail)
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --grep-invert "auto-scroll"

# 3. Manual smoke test
./scripts/code.sh &
# - Open a notebook with 3+ cells
# - Verify drag handle appears on hover
# - Drag cell from position 1 to position 3
# - Verify cell moved
# - Press Ctrl/Cmd+Z to undo
# - Verify cell returned to original position
```

## Success Criteria

See `TEST-EXPECTATIONS.md` for the full test matrix.

**Must Pass (13 tests):**
- [ ] All 6 non-drag tests (Action Bar, Keyboard, Boundaries, Multi-move, Undo/redo, Multiselect)
- [ ] Drag handle visibility test
- [ ] Basic drag tests (swap, move to end, move from beginning)
- [ ] Drag undo/redo tests
- [ ] Escape cancels test

**Expected to Fail (1 test):**
- [ ] Auto-scroll test (not implemented until Plan 02)

**Functional Criteria:**
- [ ] TypeScript compiles without errors
- [ ] Drag handle visible on cell hover
- [ ] Cells can be reordered via drag
- [ ] Escape key cancels drag
- [ ] Undo/redo works after drag

## Known Limitations (To Be Addressed in Later Plans)

- No keyboard navigation (Plan 02)
- No auto-scroll when dragging near viewport edges (Plan 02) - **auto-scroll test expected to fail**
- No smooth animation when items shift (Plan 03)
- No screen reader announcements (Plan 03)

## Handoff Protocol

After completing this plan:

1. **Update CONTEXT.md** with:
   - List of files created
   - Any deviations from plan
   - Test results

2. **Commit changes**:
   ```bash
   git add .
   git commit -m "feat(notebooks): [Plan 01] Basic custom drag-and-drop infrastructure"
   ```

3. **Record verification results**:
   - E2E test pass/fail status
   - Any manual testing observations

4. **Document blockers** if any exist for Plan 02

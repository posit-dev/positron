---
type: implementation-plan
title: "Plan 03: FLIP Animations and Accessibility"
created: 2026-01-28
status: draft
estimated_scope: "~300 lines of code"
prerequisites: "Plan 02 completed and verified"
---

# Plan 03: FLIP Animations and Accessibility

## Context Loading Instructions

**BEFORE starting implementation, the agent MUST:**

1. Read `thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md` for current state
2. Read this file completely
3. Run prerequisite verification (below)

## Prerequisites Verification

```bash
# Verify Plan 02 is complete - E2E tests must pass
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list

# Verify keyboard and auto-scroll files exist
ls src/vs/workbench/contrib/positronNotebook/browser/dnd/autoScroll.ts
ls src/vs/workbench/contrib/positronNotebook/browser/dnd/keyboardCoordinates.ts

# Verify build works
npm run compile
```

## Objective

Implement the FLIP (First, Last, Invert, Play) animation system so items smoothly shift out of the way during drag operations. Also add screen reader announcements for accessibility compliance.

This is the key differentiator from VS Code's native drag-and-drop - the smooth visual feedback makes the interaction feel polished.

## Understanding FLIP Animation

FLIP is an animation technique:

1. **First**: Record initial positions of all items
2. **Last**: Apply the DOM change (conceptually - in our case, calculate where items would be)
3. **Invert**: Calculate the transform to move items from their "last" position back to "first"
4. **Play**: Remove the transform with a transition, animating items to their new positions

In drag-and-drop context:
- When an item is dragged over another, other items need to shift to show where the drop would occur
- We calculate where each item would move to make room for the dragged item
- Apply inverse transforms so items appear in original positions
- Animate to new positions over ~200ms

## Files to Modify/Create

```
src/vs/workbench/contrib/positronNotebook/browser/dnd/
├── animations.ts           # NEW - FLIP animation system
├── Announcer.tsx           # NEW - Screen reader live region
├── DndContext.tsx          # MODIFY - Add animation + announcer
├── useSortable.ts          # MODIFY - Return transform/transition
└── types.ts                # MODIFY - Add animation types
```

## Implementation Steps

### Step 1: Add Animation Types

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/types.ts`

Add to existing types:

```typescript
export interface ItemTransform {
	x: number;
	y: number;
	scaleX?: number;
	scaleY?: number;
}

export interface AnimationConfig {
	duration?: number;      // ms, default 200
	easing?: string;        // CSS easing, default 'ease'
}

export interface SortingState {
	activeId: string | null;
	overId: string | null;
	itemTransforms: Map<string, ItemTransform>;
}
```

### Step 2: Create FLIP Animation System

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/animations.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemTransform } from './types.js';

interface ItemPosition {
	id: string;
	rect: DOMRect;
}

/**
 * Calculate transforms for a vertical sortable list.
 * When an item is dragged over position X, items at and after X shift down.
 */
export function calculateSortingTransforms(
	items: string[],
	rects: Map<string, DOMRect>,
	activeId: string | null,
	overId: string | null
): Map<string, ItemTransform> {
	const transforms = new Map<string, ItemTransform>();

	if (!activeId || !overId || activeId === overId) {
		return transforms;
	}

	const activeIndex = items.indexOf(activeId);
	const overIndex = items.indexOf(overId);

	if (activeIndex === -1 || overIndex === -1) {
		return transforms;
	}

	const activeRect = rects.get(activeId);
	if (!activeRect) {
		return transforms;
	}

	// Calculate the height of the active item (what we're making room for)
	const activeHeight = activeRect.height;

	// Determine which items need to shift
	// If dragging down (activeIndex < overIndex): items between active and over shift up
	// If dragging up (activeIndex > overIndex): items between over and active shift down
	const isDraggingDown = activeIndex < overIndex;

	for (let i = 0; i < items.length; i++) {
		const id = items[i];

		// Skip the active item (it follows the cursor via DragOverlay)
		if (id === activeId) {
			continue;
		}

		let shouldShift = false;
		let shiftDirection = 0;

		if (isDraggingDown) {
			// Dragging down: items between active+1 and over (inclusive) shift up
			if (i > activeIndex && i <= overIndex) {
				shouldShift = true;
				shiftDirection = -1; // Shift up
			}
		} else {
			// Dragging up: items between over and active-1 (inclusive) shift down
			if (i >= overIndex && i < activeIndex) {
				shouldShift = true;
				shiftDirection = 1; // Shift down
			}
		}

		if (shouldShift) {
			transforms.set(id, {
				x: 0,
				y: shiftDirection * activeHeight,
			});
		}
	}

	return transforms;
}

/**
 * Convert ItemTransform to CSS transform string.
 */
export function transformToString(transform: ItemTransform | null): string | undefined {
	if (!transform) {
		return undefined;
	}

	const parts: string[] = [];

	if (transform.x !== 0 || transform.y !== 0) {
		parts.push(`translate3d(${transform.x}px, ${transform.y}px, 0)`);
	}

	if (transform.scaleX !== undefined && transform.scaleX !== 1) {
		parts.push(`scaleX(${transform.scaleX})`);
	}

	if (transform.scaleY !== undefined && transform.scaleY !== 1) {
		parts.push(`scaleY(${transform.scaleY})`);
	}

	return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Get CSS transition string for smooth animation.
 */
export function getTransition(
	duration: number = 200,
	easing: string = 'ease'
): string {
	return `transform ${duration}ms ${easing}`;
}
```

### Step 3: Create Screen Reader Announcer

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/Announcer.tsx`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

interface AnnouncerProps {
	message: string;
	assertive?: boolean;
}

/**
 * ARIA live region for screen reader announcements.
 * Changes to `message` will be announced automatically.
 */
export function Announcer({ message, assertive = false }: AnnouncerProps) {
	return (
		<div
			role="status"
			aria-live={assertive ? 'assertive' : 'polite'}
			aria-atomic="true"
			style={{
				position: 'absolute',
				width: '1px',
				height: '1px',
				padding: 0,
				margin: '-1px',
				overflow: 'hidden',
				clip: 'rect(0, 0, 0, 0)',
				whiteSpace: 'nowrap',
				border: 0,
			}}
		>
			{message}
		</div>
	);
}

/**
 * Generate announcement messages for drag events.
 */
export function getAnnouncement(
	event: 'start' | 'move' | 'end' | 'cancel',
	activeIndex: number,
	overIndex: number | null,
	totalItems: number
): string {
	switch (event) {
		case 'start':
			return `Picked up cell ${activeIndex + 1} of ${totalItems}. Use arrow keys to move, Enter to drop, Escape to cancel.`;
		case 'move':
			if (overIndex === null) {
				return `Cell ${activeIndex + 1} is being dragged.`;
			}
			if (overIndex === activeIndex) {
				return `Cell is at its original position.`;
			}
			return `Cell ${activeIndex + 1} is over position ${overIndex + 1} of ${totalItems}.`;
		case 'end':
			if (overIndex === null || overIndex === activeIndex) {
				return `Cell ${activeIndex + 1} was dropped at its original position.`;
			}
			return `Cell was moved from position ${activeIndex + 1} to position ${overIndex + 1}.`;
		case 'cancel':
			return `Drag cancelled. Cell ${activeIndex + 1} returned to its original position.`;
	}
}
```

### Step 4: Create Animation Context

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/AnimationContext.tsx`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ItemTransform, AnimationConfig } from './types.js';
import { calculateSortingTransforms, getTransition } from './animations.js';

interface AnimationContextValue {
	getTransform: (id: string) => ItemTransform | null;
	getTransitionStyle: () => string | undefined;
	updateSortingState: (
		items: string[],
		rects: Map<string, DOMRect>,
		activeId: string | null,
		overId: string | null
	) => void;
	clearAnimations: () => void;
}

const AnimationReactContext = React.createContext<AnimationContextValue | null>(null);

interface AnimationProviderProps {
	children: React.ReactNode;
	config?: AnimationConfig;
}

export function AnimationProvider({ children, config = {} }: AnimationProviderProps) {
	const { duration = 200, easing = 'ease' } = config;
	const [transforms, setTransforms] = React.useState<Map<string, ItemTransform>>(new Map());
	const [isAnimating, setIsAnimating] = React.useState(false);

	const getTransform = React.useCallback((id: string): ItemTransform | null => {
		return transforms.get(id) ?? null;
	}, [transforms]);

	const getTransitionStyle = React.useCallback((): string | undefined => {
		return isAnimating ? getTransition(duration, easing) : undefined;
	}, [isAnimating, duration, easing]);

	const updateSortingState = React.useCallback((
		items: string[],
		rects: Map<string, DOMRect>,
		activeId: string | null,
		overId: string | null
	) => {
		const newTransforms = calculateSortingTransforms(items, rects, activeId, overId);
		setTransforms(newTransforms);
		setIsAnimating(newTransforms.size > 0);
	}, []);

	const clearAnimations = React.useCallback(() => {
		setTransforms(new Map());
		setIsAnimating(false);
	}, []);

	const value = React.useMemo(() => ({
		getTransform,
		getTransitionStyle,
		updateSortingState,
		clearAnimations,
	}), [getTransform, getTransitionStyle, updateSortingState, clearAnimations]);

	return (
		<AnimationReactContext.Provider value={value}>
			{children}
		</AnimationReactContext.Provider>
	);
}

export function useAnimationContext() {
	const context = React.useContext(AnimationReactContext);
	if (!context) {
		throw new Error('useAnimationContext must be used within an AnimationProvider');
	}
	return context;
}
```

### Step 5: Update DndContext to Include Animation and Announcements

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/DndContext.tsx`

Add animation and announcer integration:

```typescript
// Add imports
import { AnimationProvider, useAnimationContext } from './AnimationContext.js';
import { Announcer, getAnnouncement } from './Announcer.js';

// Update DndContextProps to include animation config
interface DndContextProps {
	// ... existing props ...
	animationConfig?: AnimationConfig;
}

// Inside DndContext, add announcement state
const [announcement, setAnnouncement] = React.useState('');

// Update onDragStart handler to announce
const handleInternalDragStart = React.useCallback((id: string) => {
	// ... existing logic ...

	// Announce for screen readers
	const items = Array.from(droppablesRef.current.keys());
	const activeIndex = items.indexOf(id);
	setAnnouncement(getAnnouncement('start', activeIndex, null, items.length));
}, [/* deps */]);

// Update when overId changes to announce position
React.useEffect(() => {
	if (state.status === 'dragging' && state.activeId) {
		const items = Array.from(droppablesRef.current.keys());
		const activeIndex = items.indexOf(state.activeId);
		const overIndex = state.overId ? items.indexOf(state.overId) : null;
		setAnnouncement(getAnnouncement('move', activeIndex, overIndex, items.length));
	}
}, [state.overId]);

// Wrap children with AnimationProvider and add Announcer
return (
	<AnimationProvider config={animationConfig}>
		<DndReactContext.Provider value={value}>
			{children}
			<Announcer message={announcement} />
		</DndReactContext.Provider>
	</AnimationProvider>
);
```

### Step 6: Update useSortable to Return Animation Values

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/useSortable.ts`

```typescript
// Add import
import { useAnimationContext } from './AnimationContext.js';
import { transformToString } from './animations.js';

export function useSortable({ id }: UseSortableProps) {
	const draggable = useDraggable({ id });
	const droppable = useDroppable({ id });
	const { getTransform, getTransitionStyle } = useAnimationContext();

	// Get animation transform for this item
	const animationTransform = getTransform(id);
	const transition = getTransitionStyle();

	// Combine drag transform with animation transform
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
		transition: draggable.isDragging ? undefined : transition,
	};
}
```

### Step 7: Update DndContext to Expose Droppable Rects

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/DndContext.tsx`

The animation system needs access to droppable rects. Add a getter function to DndContextValue:

```typescript
// Add to DndContextValue interface:
interface DndContextValue {
	// ... existing props ...
	getDroppableRects: () => Map<string, DOMRect>;
}

// Inside DndContext component, add:
const getDroppableRects = React.useCallback((): Map<string, DOMRect> => {
	const rects = new Map<string, DOMRect>();
	for (const [id, entry] of droppablesRef.current) {
		// Get fresh rects
		rects.set(id, entry.node.getBoundingClientRect());
	}
	return rects;
}, []);

// Add to the value object:
const value = React.useMemo(
	() => ({
		state,
		registerDroppable,
		unregisterDroppable,
		startDrag,
		updateDrag,
		endDrag,
		cancelDrag,
		getDroppableRects, // NEW
	}),
	[/* ... existing deps ..., getDroppableRects */]
);
```

### Step 7b: Update SortableContext to Trigger Animations

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/SortableContext.tsx`

Now we can access rects via the DndContext:

```typescript
// Inside SortableContext component:
import { useAnimationContext } from './AnimationContext.js';

// Get access to droppable rects via DndContext
const { getDroppableRects } = useDndContext();
const { updateSortingState, clearAnimations } = useAnimationContext();

// Track overId separately since we need it for animations
const [overId, setOverId] = React.useState<string | null>(null);

// Update in DndContext's onDragMove callback (need to add this)
// OR track it via a ref that gets updated during drag

React.useEffect(() => {
	if (activeId) {
		const rects = getDroppableRects();
		updateSortingState(items, rects, activeId, overId);
	} else {
		clearAnimations();
	}
}, [activeId, overId, items, getDroppableRects, updateSortingState, clearAnimations]);
```

**Alternative approach**: Instead of exposing getDroppableRects, merge the animation calculation directly into DndContext's updateDrag function. This is cleaner since rects are already being read there:

```typescript
// In DndContext.tsx updateDrag function, after finding closest droppable:
const closest = closestCenter(
	position,
	Array.from(droppablesRef.current.values()),
	state.activeId
);

// Calculate animation transforms inline
const rects = new Map<string, DOMRect>();
for (const [id, entry] of droppablesRef.current) {
	rects.set(id, entry.rect); // Already updated above
}
// Pass to animation context or calculate here
```

**Recommended**: Use the first approach (expose getDroppableRects) for cleaner separation of concerns.

### Step 8: Update SortableCell to Apply Animations

**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCell.tsx`

The useSortable hook now returns transform and transition, so SortableCell should already work. Verify the style application:

```typescript
const style: React.CSSProperties = {
	transform: transform ? transformToString(transform) : undefined,
	transition,
	opacity: isDragging ? 0.5 : 1,
	position: 'relative',
};
```

### Step 9: Update Index Exports

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/index.ts`

```typescript
export { AnimationProvider, useAnimationContext } from './AnimationContext.js';
export { Announcer, getAnnouncement } from './Announcer.js';
export { calculateSortingTransforms, transformToString, getTransition } from './animations.js';
export type { ItemTransform, AnimationConfig } from './types.js';
```

## Verification Checklist

```bash
# 1. TypeScript compilation
npm run compile

# 2. E2E tests - ALL 14 tests should pass (same as Plan 02)
# See TEST-EXPECTATIONS.md for details
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list

# 3. Manual verification - animations (NO E2E coverage - must test manually)
./scripts/code.sh &
# - Open notebook with 5+ cells
# - Start dragging a cell
# - Move over another cell
# - VERIFY: Other cells smoothly shift up/down to make room
# - Drop the cell
# - VERIFY: Cells animate to final positions (no instant snap)

# 4. Manual verification - screen reader (NO E2E coverage - must test manually)
# - Enable VoiceOver (Mac) or NVDA (Windows)
# - Tab to drag handle
# - Press Space to start drag
# - VERIFY: "Picked up cell X of Y" is announced
# - Press arrow keys
# - VERIFY: Position changes are announced
# - Press Enter to drop
# - VERIFY: Final position is announced
```

## Success Criteria

See `TEST-EXPECTATIONS.md` for the full test matrix.

**Must Pass (ALL 14 tests):**
- [ ] All 6 non-drag tests
- [ ] All 8 drag tests

**Manual Verification Required (no E2E coverage):**
- [ ] Items visually shift during drag (smooth animation)
- [ ] Animation duration is ~200ms (not instant, not sluggish)
- [ ] Screen reader announces drag start, position changes, and drop
- [ ] Escape cancellation is announced

**Functional Criteria:**
- [ ] TypeScript compiles without errors

## Edge Cases to Test

1. **Rapid movement**: Drag quickly across multiple items - animations should not stack/conflict
2. **Direction change**: Drag down then up quickly - items should animate correctly
3. **Long notebooks**: With 20+ cells, verify performance is acceptable
4. **Escape during animation**: Cancel mid-animation - should reset cleanly

## Handoff Protocol

After completing this plan:

1. **Update CONTEXT.md** with:
   - List of files created/modified
   - Animation behavior observations
   - Screen reader testing results

2. **Commit changes**:
   ```bash
   git add .
   git commit -m "feat(notebooks): [Plan 03] Add FLIP animations and screen reader announcements"
   ```

3. **Record verification results**:
   - Animation smoothness observations
   - Any performance concerns
   - Screen reader compatibility notes

4. **Document blockers** if any exist for Plan 04

## After This Plan

At this point, the core custom implementation should be feature-complete and can replace dnd-kit. Consider:

1. **Remove dnd-kit vendor files** (after thorough testing)
2. **Update import maps** to remove dnd-kit entries
3. **Run full E2E suite** to catch any regressions

Plan 04 (touch support, multi-selection) is optional and can be deferred.

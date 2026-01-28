---
type: implementation-plan
title: "Plan 02: Keyboard Navigation and Auto-Scroll"
created: 2026-01-28
status: draft
estimated_scope: "~200 lines of code"
prerequisites: "Plan 01 completed and verified"
---

# Plan 02: Keyboard Navigation and Auto-Scroll

## Context Loading Instructions

**BEFORE starting implementation, the agent MUST:**

1. Read `thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md` for current state
2. Read this file completely
3. Run prerequisite verification (below)

## Prerequisites Verification

```bash
# Verify Plan 01 is complete - E2E tests must pass
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list

# Verify the custom dnd directory exists
ls src/vs/workbench/contrib/positronNotebook/browser/dnd/

# Verify build works
npm run compile
```

## Objective

Add keyboard navigation (arrow keys during drag) and auto-scroll when dragging near viewport edges. This improves accessibility and usability for long notebooks.

## Files to Modify/Create

```
src/vs/workbench/contrib/positronNotebook/browser/dnd/
├── KeyboardSensor.ts       # NEW - Keyboard event handling
├── autoScroll.ts           # NEW - Edge-triggered scrolling
├── DndContext.tsx          # MODIFY - Add keyboard + scroll support
├── useDraggable.ts         # MODIFY - Add keyboard listeners
└── types.ts                # MODIFY - Add sensor types
```

## What We're NOT Doing (Deferred)

- FLIP animations (Plan 03)
- Screen reader announcements (Plan 03)
- Touch support (Plan 04)

## Implementation Steps

### Step 1: Add Sensor Types

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/types.ts`

Add to existing types:

```typescript
// Add to existing types.ts

export interface SensorOptions {
	activationConstraint?: {
		distance?: number;
	};
}

export interface KeyboardCoordinateGetter {
	(event: KeyboardEvent, args: {
		currentCoordinates: { x: number; y: number };
		context: {
			droppableRects: Map<string, DOMRect>;
			activeId: string | null;
		};
	}): { x: number; y: number } | undefined;
}

export interface AutoScrollOptions {
	enabled?: boolean;
	threshold?: number; // Pixels from edge to start scrolling (default: 50)
	speed?: number; // Pixels per frame (default: 10)
}
```

### Step 2: Create Auto-Scroll System

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/autoScroll.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AutoScrollConfig {
	threshold: number;
	speed: number;
}

const DEFAULT_CONFIG: AutoScrollConfig = {
	threshold: 50, // 50px from edge
	speed: 10,     // 10px per frame
};

/**
 * Calculate scroll delta based on pointer position relative to viewport edges.
 * Returns { x, y } deltas - positive values scroll right/down.
 */
export function calculateScrollDelta(
	position: { x: number; y: number },
	scrollContainer: HTMLElement | Window,
	config: AutoScrollConfig = DEFAULT_CONFIG
): { x: number; y: number } {
	const { threshold, speed } = config;

	let rect: DOMRect;
	if (scrollContainer === window) {
		rect = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
	} else {
		rect = (scrollContainer as HTMLElement).getBoundingClientRect();
	}

	let deltaX = 0;
	let deltaY = 0;

	// Vertical scrolling
	if (position.y < rect.top + threshold) {
		// Near top edge - scroll up
		const distance = rect.top + threshold - position.y;
		deltaY = -Math.min(speed, speed * (distance / threshold));
	} else if (position.y > rect.bottom - threshold) {
		// Near bottom edge - scroll down
		const distance = position.y - (rect.bottom - threshold);
		deltaY = Math.min(speed, speed * (distance / threshold));
	}

	// Horizontal scrolling (for wide content)
	if (position.x < rect.left + threshold) {
		const distance = rect.left + threshold - position.x;
		deltaX = -Math.min(speed, speed * (distance / threshold));
	} else if (position.x > rect.right - threshold) {
		const distance = position.x - (rect.right - threshold);
		deltaX = Math.min(speed, speed * (distance / threshold));
	}

	return { x: deltaX, y: deltaY };
}

/**
 * Auto-scroll controller that runs during drag operations.
 */
export class AutoScrollController {
	private animationFrameId: number | null = null;
	private config: AutoScrollConfig;
	private scrollContainer: HTMLElement | Window;

	constructor(
		scrollContainer: HTMLElement | Window = window,
		config: Partial<AutoScrollConfig> = {}
	) {
		this.scrollContainer = scrollContainer;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Start auto-scrolling based on pointer position.
	 * Call this on every pointer move during drag.
	 */
	update(position: { x: number; y: number }) {
		this.stop(); // Cancel any pending frame

		const delta = calculateScrollDelta(position, this.scrollContainer, this.config);

		if (delta.x === 0 && delta.y === 0) {
			return;
		}

		this.animationFrameId = requestAnimationFrame(() => {
			if (this.scrollContainer === window) {
				window.scrollBy(delta.x, delta.y);
			} else {
				(this.scrollContainer as HTMLElement).scrollLeft += delta.x;
				(this.scrollContainer as HTMLElement).scrollTop += delta.y;
			}
		});
	}

	/**
	 * Stop auto-scrolling.
	 */
	stop() {
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
	}

	/**
	 * Update the scroll container (e.g., if the notebook container changes).
	 */
	setScrollContainer(container: HTMLElement | Window) {
		this.scrollContainer = container;
	}
}
```

### Step 3: Create Keyboard Coordinate Getter

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/keyboardCoordinates.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyboardCoordinateGetter } from './types.js';

/**
 * Default keyboard coordinate getter for vertical sortable lists.
 * Maps arrow keys to movement between droppable items.
 */
export const sortableKeyboardCoordinates: KeyboardCoordinateGetter = (
	event,
	{ currentCoordinates, context }
) => {
	const { droppableRects, activeId } = context;

	if (!activeId) {
		return undefined;
	}

	// Get sorted list of droppables by vertical position
	const sortedDroppables = Array.from(droppableRects.entries())
		.filter(([id]) => id !== activeId)
		.sort(([, a], [, b]) => a.top - b.top);

	if (sortedDroppables.length === 0) {
		return undefined;
	}

	// Find current position in the sorted list based on coordinates
	const currentY = currentCoordinates.y;
	let currentIndex = sortedDroppables.findIndex(([, rect]) => {
		const centerY = rect.top + rect.height / 2;
		return currentY < centerY;
	});

	if (currentIndex === -1) {
		currentIndex = sortedDroppables.length;
	}

	let targetIndex = currentIndex;

	switch (event.key) {
		case 'ArrowUp':
			targetIndex = Math.max(0, currentIndex - 1);
			break;
		case 'ArrowDown':
			// Move down one position, clamped to the last valid index
			targetIndex = Math.min(sortedDroppables.length - 1, currentIndex + 1);
			break;
		default:
			return undefined;
	}

	// Ensure we're within bounds (defensive)
	targetIndex = Math.max(0, Math.min(targetIndex, sortedDroppables.length - 1));

	const targetDroppable = sortedDroppables[targetIndex];
	if (!targetDroppable) {
		return undefined;
	}

	const [, targetRect] = targetDroppable;
	return {
		x: targetRect.left + targetRect.width / 2,
		y: targetRect.top + targetRect.height / 2,
	};
};
```

### Step 4: Update DndContext with Keyboard and Scroll Support

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/DndContext.tsx`

Add keyboard sensor and auto-scroll to the existing DndContext:

```typescript
// Add these imports at the top
import { AutoScrollController } from './autoScroll.js';
import { sortableKeyboardCoordinates } from './keyboardCoordinates.js';
import { KeyboardCoordinateGetter, AutoScrollOptions } from './types.js';

// Update DndContextProps interface
interface DndContextProps {
	children: React.ReactNode;
	onDragStart?: (event: DragStartEvent) => void;
	onDragEnd?: (event: DragEndEvent) => void;
	onDragCancel?: (event: DragCancelEvent) => void;
	activationDistance?: number;
	// NEW: Keyboard support
	keyboardCoordinateGetter?: KeyboardCoordinateGetter;
	// NEW: Auto-scroll support
	autoScroll?: AutoScrollOptions;
	scrollContainerRef?: React.RefObject<HTMLElement>;
}

// Inside DndContext component, add:

// Auto-scroll controller
const autoScrollRef = React.useRef<AutoScrollController | null>(null);

React.useEffect(() => {
	if (autoScroll?.enabled !== false) {
		const container = scrollContainerRef?.current ?? window;
		autoScrollRef.current = new AutoScrollController(container, {
			threshold: autoScroll?.threshold,
			speed: autoScroll?.speed,
		});
	}
	return () => {
		autoScrollRef.current?.stop();
	};
}, [autoScroll, scrollContainerRef]);

// Update the updateDrag function to include auto-scroll:
const updateDrag = React.useCallback((position: { x: number; y: number }) => {
	// ... existing activation logic ...

	if (state.status !== 'dragging') {
		return;
	}

	// Auto-scroll when near edges
	autoScrollRef.current?.update(position);

	// ... rest of existing updateDrag logic ...
}, [/* existing deps */]);

// Add keyboard event handling in the useEffect:
const handleKeyDown = (e: KeyboardEvent) => {
	if (e.key === 'Escape') {
		cancelDrag();
		return;
	}

	// Handle arrow keys for keyboard navigation
	if (state.status === 'dragging' && keyboardCoordinateGetter) {
		const droppableRects = new Map<string, DOMRect>();
		for (const [id, entry] of droppablesRef.current) {
			droppableRects.set(id, entry.rect);
		}

		const newCoords = keyboardCoordinateGetter(e, {
			currentCoordinates: state.currentPosition!,
			context: { droppableRects, activeId: state.activeId },
		});

		if (newCoords) {
			e.preventDefault();
			updateDrag(newCoords);
		}
	}
};

// In cleanup, add:
autoScrollRef.current?.stop();
```

### Step 5: Update SortableContext to Pass Keyboard Config

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/SortableContext.tsx`

```typescript
// Add import
import { sortableKeyboardCoordinates } from './keyboardCoordinates.js';

// Update DndContext usage:
<DndContext
	onDragStart={handleDragStart}
	onDragEnd={handleDragEnd}
	onDragCancel={handleDragCancel}
	keyboardCoordinateGetter={sortableKeyboardCoordinates}
	autoScroll={{ enabled: true, threshold: 50, speed: 15 }}
	scrollContainerRef={scrollContainerRef}
>
```

### Step 6: Update useDraggable for Keyboard Activation

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/useDraggable.ts`

Add keyboard activation support:

```typescript
// Add to listeners object:
const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
	// Space or Enter to start drag
	if (e.key === ' ' || e.key === 'Enter') {
		e.preventDefault();
		const rect = nodeRef.current?.getBoundingClientRect();
		if (rect) {
			// Start drag from center of element
			startDrag(id, {
				x: rect.left + rect.width / 2,
				y: rect.top + rect.height / 2,
			});
		}
	}
}, [id, startDrag]);

// Update listeners:
const listeners = {
	onPointerDown: handlePointerDown,
	onKeyDown: handleKeyDown,
};
```

### Step 7: Update Index Exports

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/index.ts`

Add new exports:

```typescript
export { AutoScrollController, calculateScrollDelta } from './autoScroll.js';
export { sortableKeyboardCoordinates } from './keyboardCoordinates.js';
export type { KeyboardCoordinateGetter, AutoScrollOptions } from './types.js';
```

## Verification Checklist

```bash
# 1. TypeScript compilation
npm run compile

# 2. E2E tests - ALL 14 tests should now pass (including auto-scroll)
# See TEST-EXPECTATIONS.md for details
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list

# 3. Manual verification - keyboard navigation
./scripts/code.sh &
# - Open notebook with 3+ cells
# - Tab to drag handle
# - Press Space or Enter to start drag
# - Use Arrow Up/Down to move position
# - Press Enter to drop or Escape to cancel

# 4. Manual verification - auto-scroll
# - Create notebook with 10+ cells
# - Start dragging a cell
# - Move cursor to top/bottom edge of viewport
# - Verify notebook scrolls automatically
```

## Success Criteria

See `TEST-EXPECTATIONS.md` for the full test matrix.

**Must Pass (ALL 14 tests):**
- [ ] All 6 non-drag tests
- [ ] All 8 drag tests (including auto-scroll - now implemented!)

**Functional Criteria:**
- [ ] TypeScript compiles without errors
- [ ] Keyboard navigation works (Space to start, arrows to move, Enter to drop)
- [ ] Auto-scroll activates when dragging near viewport edges
- [ ] Escape still cancels drag during keyboard navigation

## Known Limitations (To Be Addressed in Plan 03)

- No smooth animation when items shift during drag
- No screen reader announcements for drag state changes

## Handoff Protocol

After completing this plan:

1. **Update CONTEXT.md** with:
   - List of files modified
   - Test results
   - Any keyboard/scroll edge cases discovered

2. **Commit changes**:
   ```bash
   git add .
   git commit -m "feat(notebooks): [Plan 02] Add keyboard navigation and auto-scroll to custom DnD"
   ```

3. **Record verification results**:
   - Note if any E2E tests needed adjustment
   - Document auto-scroll behavior observations

4. **Document blockers** if any exist for Plan 03

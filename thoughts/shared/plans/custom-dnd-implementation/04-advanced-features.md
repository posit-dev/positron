---
type: implementation-plan
title: "Plan 04: Advanced Features (Optional)"
created: 2026-01-28
status: draft
estimated_scope: "~100 lines of code per feature"
prerequisites: "Plan 03 completed and verified"
optional: true
---

# Plan 04: Advanced Features (Optional)

## Context Loading Instructions

**BEFORE starting implementation, the agent MUST:**

1. Read `thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md` for current state
2. Read this file completely
3. Run prerequisite verification (below)

**NOTE**: This plan is OPTIONAL. The implementation after Plan 03 is fully functional. Only implement these features if explicitly requested.

## Prerequisites Verification

```bash
# Verify Plan 03 is complete
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list

# Verify animations are working
npm run compile

# Verify dnd-kit can be removed (optional verification)
# Comment out dnd-kit imports and verify custom impl works standalone
```

## Available Features

This plan contains independent features that can be implemented selectively:

| Feature | Lines | Complexity | User Benefit |
|---------|-------|------------|--------------|
| Touch Support | ~100 | Medium | Mobile/tablet usability |
| Multi-Selection Drag | ~150 | High | Power user workflow |
| Drop Animation | ~50 | Low | Visual polish |
| Transform Modifiers | ~80 | Medium | Constrained dragging |

Each feature section below is self-contained. Implement only what's needed.

---

## Feature A: Touch Support

### Objective

Enable drag-and-drop on touch devices (tablets, touch-screen laptops).

### Implementation

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/TouchSensor.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface TouchSensorConfig {
	activationDelay?: number;      // ms before drag activates (default: 250)
	activationDistance?: number;   // px movement to cancel delay (default: 5)
}

const DEFAULT_CONFIG: TouchSensorConfig = {
	activationDelay: 250,
	activationDistance: 5,
};

/**
 * Touch sensor for drag-and-drop on touch devices.
 * Uses a long-press activation to distinguish from scroll gestures.
 */
export function useTouchSensor(
	onActivate: (position: { x: number; y: number }) => void,
	config: TouchSensorConfig = {}
) {
	const { activationDelay, activationDistance } = { ...DEFAULT_CONFIG, ...config };
	const timeoutRef = React.useRef<number | null>(null);
	const startPositionRef = React.useRef<{ x: number; y: number } | null>(null);

	const handleTouchStart = React.useCallback((e: React.TouchEvent) => {
		if (e.touches.length !== 1) {
			return; // Only handle single touch
		}

		const touch = e.touches[0];
		startPositionRef.current = { x: touch.clientX, y: touch.clientY };

		// Start activation delay
		timeoutRef.current = window.setTimeout(() => {
			if (startPositionRef.current) {
				onActivate(startPositionRef.current);
			}
		}, activationDelay);
	}, [activationDelay, onActivate]);

	const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
		if (!startPositionRef.current || e.touches.length !== 1) {
			return;
		}

		const touch = e.touches[0];
		const distance = Math.sqrt(
			Math.pow(touch.clientX - startPositionRef.current.x, 2) +
			Math.pow(touch.clientY - startPositionRef.current.y, 2)
		);

		// Cancel activation if moved too far (user is scrolling)
		if (distance > activationDistance! && timeoutRef.current) {
			window.clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, [activationDistance]);

	const handleTouchEnd = React.useCallback(() => {
		if (timeoutRef.current) {
			window.clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		startPositionRef.current = null;
	}, []);

	// Cleanup on unmount
	React.useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				window.clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	return {
		onTouchStart: handleTouchStart,
		onTouchMove: handleTouchMove,
		onTouchEnd: handleTouchEnd,
		onTouchCancel: handleTouchEnd,
	};
}
```

### Integration

Add touch listeners to `useDraggable`:

```typescript
// In useDraggable.ts
const touchListeners = useTouchSensor(
	(pos) => startDrag(id, pos),
	{ activationDelay: 250 }
);

const listeners = {
	onPointerDown: handlePointerDown,
	onKeyDown: handleKeyDown,
	...touchListeners,
};
```

### Verification

- Test on iPad or touch-screen device
- Long-press (250ms) should initiate drag
- Quick taps should not trigger drag
- Scrolling should not trigger drag

---

## Feature B: Multi-Selection Drag

### Objective

Allow dragging multiple selected cells at once.

### Implementation Overview

This feature requires coordination between the notebook's selection state and the drag system.

**Key Changes:**

1. **DndContext**: Accept array of active IDs instead of single ID
2. **SortableContext**: Pass selected cell IDs to drag system
3. **Animation**: Calculate transforms for grouped items
4. **Overlay**: Render stacked preview of multiple cells

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/MultiDragContext.tsx`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

interface MultiDragState {
	activeIds: string[];
	overId: string | null;
}

// When starting drag, check if dragged item is in selection
// If yes, drag all selected items together
// If no, drag only the single item (and optionally clear selection)

export function useMultiDrag(
	selectedIds: string[],
	onReorder: (fromIndices: number[], toIndex: number) => void
) {
	// Implementation follows similar pattern to single drag
	// but operates on arrays of indices
}
```

### Integration Points

1. **PositronNotebookInstance**: Already has `moveCells()` that accepts array
2. **Selection State**: Use existing `selectionStateMachine` to get selected cells
3. **Visual Feedback**: Show count badge on overlay (e.g., "3 cells")

### Verification

- Select multiple cells (Shift+click or Cmd/Ctrl+click)
- Drag one of the selected cells
- All selected cells should move together
- Drop position should insert all cells at target

---

## Feature C: Drop Animation

### Objective

Animate the dropped item settling into its final position (spring physics).

### Implementation

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/dropAnimation.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DropAnimationConfig {
	duration?: number;
	easing?: string;
	sideEffects?: () => void;
}

const DEFAULT_DROP_ANIMATION: DropAnimationConfig = {
	duration: 250,
	easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)', // Slight overshoot
};

/**
 * Animate element from current position to final position.
 * Returns a promise that resolves when animation completes.
 */
export async function animateDrop(
	element: HTMLElement,
	from: { x: number; y: number },
	to: { x: number; y: number },
	config: DropAnimationConfig = {}
): Promise<void> {
	const { duration, easing, sideEffects } = { ...DEFAULT_DROP_ANIMATION, ...config };

	// Calculate delta
	const dx = to.x - from.x;
	const dy = to.y - from.y;

	// If already at destination, skip animation
	if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
		sideEffects?.();
		return;
	}

	// Apply initial transform (inverted)
	element.style.transform = `translate3d(${-dx}px, ${-dy}px, 0)`;
	element.style.transition = 'none';

	// Force reflow
	element.getBoundingClientRect();

	// Animate to final position
	element.style.transition = `transform ${duration}ms ${easing}`;
	element.style.transform = 'translate3d(0, 0, 0)';

	// Wait for animation to complete
	await new Promise<void>(resolve => {
		const handleEnd = () => {
			element.removeEventListener('transitionend', handleEnd);
			element.style.transform = '';
			element.style.transition = '';
			sideEffects?.();
			resolve();
		};
		element.addEventListener('transitionend', handleEnd);
	});
}
```

### Integration

Call `animateDrop` in `endDrag` before clearing state:

```typescript
// In DndContext, after drop
const activeElement = droppablesRef.current.get(state.activeId)?.node;
if (activeElement && state.currentPosition) {
	const finalRect = activeElement.getBoundingClientRect();
	await animateDrop(
		activeElement,
		state.currentPosition,
		{ x: finalRect.left, y: finalRect.top },
		{ sideEffects: () => onDragEnd?.(event) }
	);
}
```

---

## Feature D: Transform Modifiers

### Objective

Allow constraining or modifying drag transforms (e.g., restrict to vertical axis).

### Implementation

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd/modifiers.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ItemTransform } from './types.js';

export type Modifier = (transform: ItemTransform) => ItemTransform;

/**
 * Restrict movement to vertical axis only.
 */
export const restrictToVerticalAxis: Modifier = (transform) => ({
	...transform,
	x: 0,
});

/**
 * Restrict movement to horizontal axis only.
 */
export const restrictToHorizontalAxis: Modifier = (transform) => ({
	...transform,
	y: 0,
});

/**
 * Snap to grid (e.g., 10px increments).
 */
export const snapToGrid = (gridSize: number): Modifier => (transform) => ({
	...transform,
	x: Math.round(transform.x / gridSize) * gridSize,
	y: Math.round(transform.y / gridSize) * gridSize,
});

/**
 * Apply multiple modifiers in sequence.
 */
export function composeModifiers(...modifiers: Modifier[]): Modifier {
	return (transform) =>
		modifiers.reduce((acc, modifier) => modifier(acc), transform);
}
```

### Integration

Add `modifiers` prop to DndContext and apply in `updateDrag`:

```typescript
interface DndContextProps {
	// ... existing props ...
	modifiers?: Modifier[];
}

// In updateDrag, apply modifiers to transform
let transform = { x: delta.x, y: delta.y };
for (const modifier of modifiers ?? []) {
	transform = modifier(transform);
}
```

---

## Cleanup Task: Remove dnd-kit

After implementing desired features and verifying everything works:

### Step 1: Remove Import Map Entries

**Files to modify:**
- `src/vs/code/electron-browser/workbench/workbench.html`
- `src/vs/code/browser/workbench/workbench.html`
- `src/vs/code/browser/workbench/workbench-dev.html`
- `test/unit/electron/renderer.html`
- `test/unit/browser/renderer.html`

Remove all `@dnd-kit/*` entries from import maps.

### Step 2: Remove Vendor Files

```bash
rm -rf src/esm-package-dependencies/v135/@dnd-kit/
rm src/esm-package-dependencies/core.js
rm src/esm-package-dependencies/sortable.js
rm src/esm-package-dependencies/utilities.js
```

### Step 3: Remove Type Declarations

```bash
rm src/vs/workbench/contrib/positronNotebook/browser/dnd-kit.d.ts
```

### Step 4: Update ThirdPartyNotices.txt

Remove the dnd-kit license entry.

### Step 5: Verify

```bash
npm run compile
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron
```

---

## Handoff Protocol

After implementing any features from this plan:

1. **Update CONTEXT.md** with:
   - Which features were implemented
   - Test results
   - Any dnd-kit cleanup performed

2. **Commit changes**:
   ```bash
   git add .
   git commit -m "feat(notebooks): [Plan 04] Add [feature name] to custom DnD"
   ```

   Or for cleanup:
   ```bash
   git commit -m "chore(notebooks): Remove vendored dnd-kit library"
   ```

3. **Document**:
   - Feature usage instructions
   - Any known limitations
   - Performance observations

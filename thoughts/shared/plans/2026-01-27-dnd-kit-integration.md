---
type: implementation-plan
title: "dnd-kit Integration for Notebook Cell Drag-and-Drop"
created: 2026-01-27
status: draft
---

# dnd-kit Integration for Notebook Cell Drag-and-Drop

## Overview

Add @dnd-kit as a bundled ESM dependency to enable drag-and-drop reordering of notebook cells in Positron Notebooks. This complements the existing keyboard/button-based cell movement with a visual drag-and-drop interface.

## Current State Analysis

### Existing Cell Movement Infrastructure
- Move up/down commands registered at `src/vs/workbench/contrib/positronNotebook/browser/positronNotebook.contribution.ts:1143-1192`
- `moveCellsUp()` and `moveCellsDown()` implemented in `PositronNotebookInstance.ts:1273-1367`
- `moveCells()` method stubbed but unimplemented at `PositronNotebookInstance.ts:1375-1382` - intended for drag-and-drop
- Cell movement uses `CellEditType.Move` edit operation on the text model

### ESM Dependency Pattern
- Wrapper entry points in `src/esm-package-dependencies/*.js`
- Bundled modules from esm.sh in `src/esm-package-dependencies/v135/` or `stable/`
- Import maps configured in workbench HTML files
- Build system copies `src/esm-package-dependencies/**` to output

### Key Discoveries
- React 18.3.1 already bundled and available via import map
- `react-window` pattern shows how to handle packages with dependencies
- Import paths from esm.sh need rewriting to local relative paths
- Source maps included for debugging support

## Desired End State

After implementation:
1. Users can drag notebook cells by a visible drag handle to reorder them
2. Visual feedback shows drop target location during drag
3. Existing move buttons and keyboard shortcuts continue to work
4. @dnd-kit packages are bundled following existing ESM patterns
5. Unit tests verify reorder logic, E2E tests verify user interactions

### Verification
- Drag a cell from position 0 to position 2 → cell moves correctly
- Move buttons still work alongside drag-and-drop
- No console errors when dragging
- Undo/redo works for drag operations

## What We're NOT Doing

- Multi-cell drag selection (future enhancement)
- Drag cells between notebooks
- Touch/mobile drag support optimization
- Custom drag preview animations beyond basic styling
- Auto-scroll during drag (can add later with @dnd-kit/auto-scroll)

## Implementation Approach

1. **Phase 1**: Add @dnd-kit as bundled ESM dependency
2. **Phase 2**: Create sortable cell wrapper components
3. **Phase 3**: Integrate with PositronNotebookComponent
4. **Phase 4**: Add tests

---

## Phase 1: Bundle @dnd-kit ESM Dependencies

### Overview
Download and configure @dnd-kit packages following the existing react-window pattern, accounting for different import map approaches across workbench files.

### Changes Required

#### 1. Create Directory Structure
Create the following directories:
```
src/esm-package-dependencies/v135/@dnd-kit/
├── core@6.3.1/es2022/
├── sortable@10.0.0/es2022/
├── utilities@3.2.2/es2022/
└── accessibility@3.1.1/es2022/
```

#### 2. Download and Patch Bundles
**Script**: `scripts/fetch-dnd-kit-bundles.sh`

```bash
#!/bin/bash
# Download @dnd-kit bundles from esm.sh and patch imports

set -e

BASE_DIR="src/esm-package-dependencies/v135/@dnd-kit"

# Create directories
mkdir -p "$BASE_DIR/core@6.3.1/es2022"
mkdir -p "$BASE_DIR/sortable@10.0.0/es2022"
mkdir -p "$BASE_DIR/utilities@3.2.2/es2022"
mkdir -p "$BASE_DIR/accessibility@3.1.1/es2022"

echo "Downloading @dnd-kit bundles..."

# Download bundles
curl -sL "https://esm.sh/v135/@dnd-kit/core@6.3.1/es2022/core.mjs" > "$BASE_DIR/core@6.3.1/es2022/core.mjs"
curl -sL "https://esm.sh/v135/@dnd-kit/sortable@10.0.0/es2022/sortable.mjs" > "$BASE_DIR/sortable@10.0.0/es2022/sortable.mjs"
curl -sL "https://esm.sh/v135/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs" > "$BASE_DIR/utilities@3.2.2/es2022/utilities.mjs"
curl -sL "https://esm.sh/v135/@dnd-kit/accessibility@3.1.1/es2022/accessibility.mjs" > "$BASE_DIR/accessibility@3.1.1/es2022/accessibility.mjs"

# Download source maps
curl -sL "https://esm.sh/v135/@dnd-kit/core@6.3.1/es2022/core.mjs.map" > "$BASE_DIR/core@6.3.1/es2022/core.mjs.map"
curl -sL "https://esm.sh/v135/@dnd-kit/sortable@10.0.0/es2022/sortable.mjs.map" > "$BASE_DIR/sortable@10.0.0/es2022/sortable.mjs.map"
curl -sL "https://esm.sh/v135/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs.map" > "$BASE_DIR/utilities@3.2.2/es2022/utilities.mjs.map"
curl -sL "https://esm.sh/v135/@dnd-kit/accessibility@3.1.1/es2022/accessibility.mjs.map" > "$BASE_DIR/accessibility@3.1.1/es2022/accessibility.mjs.map"

echo "Patching imports..."

# Note: Adjust paths based on actual esm.sh import format. The repo uses relative imports like ../../../stable/...
# First, check the actual format by inspecting the downloaded files, then patch only @dnd-kit internal references

# Patch @dnd-kit internal imports to use relative paths (leave React imports as-is until verified)
sed -i '' \
  -e 's|from"/@dnd-kit/utilities@[^"]*"|from"../../utilities@3.2.2/es2022/utilities.mjs"|g' \
  -e 's|from"/@dnd-kit/accessibility@[^"]*"|from"../../accessibility@3.1.1/es2022/accessibility.mjs"|g' \
  "$BASE_DIR/core@6.3.1/es2022/core.mjs"

sed -i '' \
  -e 's|from"/@dnd-kit/core@[^"]*"|from"../../core@6.3.1/es2022/core.mjs"|g' \
  -e 's|from"/@dnd-kit/utilities@[^"]*"|from"../../utilities@3.2.2/es2022/utilities.mjs"|g' \
  "$BASE_DIR/sortable@10.0.0/es2022/sortable.mjs"

echo "Manual verification required: Check React import paths match the existing pattern in the repo"
echo "Look at existing files like src/esm-package-dependencies/v135/react-window@1.8.10/es2022/react-window.mjs"
echo "for the correct relative path depth to stable/react@*/es2022/react.mjs"

echo "Done! @dnd-kit bundles ready in $BASE_DIR"
```

**Important**: After running the script:
1. Manually inspect the downloaded files to see the actual import format from esm.sh
2. Compare with existing vendored modules like `react-window` to match the relative import path pattern
3. Update the sed commands to correctly rewrite React imports to match the repo's existing pattern (likely `../../../../stable/react@18.2.0/es2022/react.mjs` or similar)

#### 3. Create Entry Point Wrapper Files

**IMPORTANT**: For browser workbench files that use `addModule()`, the wrapper filename must match the last segment of the package name.

**Option A - Match last segment naming convention:**

**File**: `src/esm-package-dependencies/core.js`
```javascript
/* eslint-disable */
// @dnd-kit/core - MIT License - https://github.com/clauderic/dnd-kit
import "./v135/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs";
import "./v135/@dnd-kit/accessibility@3.1.1/es2022/accessibility.mjs";
export * from "./v135/@dnd-kit/core@6.3.1/es2022/core.mjs";
```

**File**: `src/esm-package-dependencies/sortable.js`
```javascript
/* eslint-disable */
// @dnd-kit/sortable - MIT License - https://github.com/clauderic/dnd-kit
import "./v135/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs";
import "./core.js";
export * from "./v135/@dnd-kit/sortable@10.0.0/es2022/sortable.mjs";
```

**File**: `src/esm-package-dependencies/utilities.js`
```javascript
/* eslint-disable */
// @dnd-kit/utilities - MIT License - https://github.com/clauderic/dnd-kit
export * from "./v135/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs";
```

**Note**: Check for naming conflicts with existing wrappers. If conflicts exist, use Option B below.

**Option B - Enhance addModule() function (if Option A has conflicts):**

Modify the `addModule()` function in browser workbench files to support an optional second parameter for the wrapper filename, then use descriptive names like `dnd-kit-core.js`.

#### 4. Update Import Maps

**File**: `src/vs/code/electron-browser/workbench/workbench.html`

This file has a static `<script type="importmap">` block. Add entries after the react-window entry:
```html
"@dnd-kit/core": "../../../../esm-package-dependencies/core.js",
"@dnd-kit/sortable": "../../../../esm-package-dependencies/sortable.js",
"@dnd-kit/utilities": "../../../../esm-package-dependencies/utilities.js"
```

**File**: `src/vs/code/browser/workbench/workbench.html`

This file uses `addModule()` function. Add in the script section where other modules are added:
```javascript
addModule('@dnd-kit/core');
addModule('@dnd-kit/sortable');
addModule('@dnd-kit/utilities');
```

**File**: `src/vs/code/browser/workbench/workbench-dev.html`

Same as browser workbench - uses `addModule()`:
```javascript
addModule('@dnd-kit/core');
addModule('@dnd-kit/sortable');
addModule('@dnd-kit/utilities');
```

**File**: `test/unit/electron/renderer.html`

Uses `addModule()` function. Add:
```javascript
addModule('@dnd-kit/core');
addModule('@dnd-kit/sortable');
addModule('@dnd-kit/utilities');
```

**File**: `test/unit/browser/renderer.html`

This file has a different structure and doesn't use `addModule()`. If browser unit tests need @dnd-kit imports, add explicit entries to the importmap:
```javascript
'@dnd-kit/core': `${window.location.origin}/esm-package-dependencies/core.js`,
'@dnd-kit/sortable': `${window.location.origin}/esm-package-dependencies/sortable.js`,
'@dnd-kit/utilities': `${window.location.origin}/esm-package-dependencies/utilities.js`
```

#### 5. Add TypeScript Declarations

**File**: `src/vs/workbench/contrib/positronNotebook/browser/dnd-kit.d.ts`

Create minimal type declarations for the @dnd-kit APIs we use:

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Minimal type declarations for @dnd-kit packages used in notebook drag-and-drop

declare module '@dnd-kit/core' {
	export interface DragStartEvent {
		active: { id: string | number };
	}
	export interface DragEndEvent {
		active: { id: string | number };
		over: { id: string | number } | null;
	}
	export interface SensorOptions {
		activationConstraint?: { distance?: number };
		coordinateGetter?: () => any;
	}
	export function useSensor(sensor: any, options?: SensorOptions): any;
	export function useSensors(...sensors: any[]): any;
	export const DndContext: React.FC<any>;
	export const DragOverlay: React.FC<any>;
	export const closestCenter: any;
	export const PointerSensor: any;
	export const KeyboardSensor: any;
}

declare module '@dnd-kit/sortable' {
	export interface UseSortableResult {
		attributes: any;
		listeners: any;
		setNodeRef: (node: HTMLElement | null) => void;
		setActivatorNodeRef: (node: HTMLElement | null) => void;
		transform: any;
		transition: string;
		isDragging: boolean;
	}
	export function useSortable(args: { id: string | number }): UseSortableResult;
	export const SortableContext: React.FC<any>;
	export const sortableKeyboardCoordinates: any;
	export const verticalListSortingStrategy: any;
}

declare module '@dnd-kit/utilities' {
	export const CSS: {
		Transform: {
			toString(transform: any): string;
		};
	};
}
```

#### 6. Update Third-Party Compliance

**File**: `ThirdPartyNotices.txt` (or appropriate compliance tracking file)

Add @dnd-kit license information:
```
@dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, @dnd-kit/accessibility
MIT License
Copyright (c) 2021 Claudéric Demers
https://github.com/clauderic/dnd-kit
```

Update any CG manifest or dependency tracking files as per Positron's standard process.

### Success Criteria

#### Automated Verification:
- [x] Script runs without errors: `bash scripts/fetch-dnd-kit-bundles.sh`
- [x] Files exist: `ls src/esm-package-dependencies/v135/@dnd-kit/*/es2022/*.mjs`
- [x] Entry points exist: `ls src/esm-package-dependencies/{core,sortable,utilities}.js`
- [x] Build succeeds: `npm run compile`
- [ ] No TypeScript errors in notebook code importing @dnd-kit
- [x] Third-party compliance updated in ThirdPartyNotices.txt

#### Manual Verification:
- [ ] Open browser dev tools, verify no 404s for @dnd-kit modules
- [ ] Console shows no module resolution errors
- [ ] Import paths in vendored files correctly reference React and other @dnd-kit modules

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Create Sortable Cell Components

### Overview
Create React components that wrap notebook cells with dnd-kit sortable functionality.

### Changes Required

#### 1. Create SortableCell Component

**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCell.tsx`

```tsx
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IPositronNotebookCell } from './IPositronNotebookCell.js';

interface SortableCellProps {
	cell: IPositronNotebookCell;
	children: React.ReactNode;
}

export function SortableCell({ cell, children }: SortableCellProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: cell.handleId });

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
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
			{children}
		</div>
	);
}
```

#### 2. Create SortableCellList Component

**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCellList.tsx`

```tsx
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import {
	DndContext,
	DragOverlay,
	closestCenter,
	PointerSensor,
	KeyboardSensor,
	useSensor,
	useSensors,
	DragStartEvent,
	DragEndEvent,
} from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { IPositronNotebookCell } from './IPositronNotebookCell.js';

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
	const [activeCell, setActiveCell] = React.useState<IPositronNotebookCell | null>(null);

	// Require 10px movement before drag starts (prevents accidental drags)
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 10,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);

	// If disabled (read-only mode), don't enable drag-and-drop
	if (disabled) {
		return <>{children}</>;
	}

	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		const cell = cells.find(c => c.handleId === event.active.id);
		setActiveCell(cell ?? null);
	}, [cells]);

	const handleDragEnd = React.useCallback((event: DragEndEvent) => {
		const { active, over } = event;
		setActiveCell(null);

		if (over && active.id !== over.id) {
			const oldIndex = cells.findIndex(c => c.handleId === active.id);
			const newIndex = cells.findIndex(c => c.handleId === over.id);
			if (oldIndex !== -1 && newIndex !== -1) {
				onReorder(oldIndex, newIndex);
			}
		}
	}, [cells, onReorder]);

	const handleDragCancel = React.useCallback(() => {
		setActiveCell(null);
	}, []);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={handleDragCancel}
		>
			<SortableContext
				items={cells.map(c => c.handleId)}
				strategy={verticalListSortingStrategy}
			>
				{children}
			</SortableContext>

			<DragOverlay>
				{activeCell && renderDragOverlay ? (
					<div className="cell-drag-overlay">
						{renderDragOverlay(activeCell)}
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
```

#### 3. Add CSS Styles

**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/notebookCells.css`

Add the following styles:

```css
/* Drag handle for sortable cells */
.cell-drag-handle {
	position: absolute;
	left: 4px; /* Positioned inside cell to avoid clipping */
	top: 8px;
	width: 16px;
	height: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: grab;
	opacity: 0;
	transition: opacity 0.15s ease;
	color: var(--vscode-foreground);
	border-radius: 3px;
	border: none;
	background: transparent;
	padding: 0;
	z-index: 10; /* Ensure handle is above cell content */
}

/* Alternative: If left margin is available, use negative positioning with overflow visible on parent */
.sortable-cell {
	overflow: visible; /* Ensure drag handle isn't clipped */
}

.sortable-cell:hover .cell-drag-handle,
.cell-drag-handle:focus-visible {
	opacity: 0.6;
}

.cell-drag-handle:hover {
	opacity: 1;
	background: var(--vscode-toolbar-hoverBackground);
}

.cell-drag-handle:active {
	cursor: grabbing;
}

/* Cell being dragged (placeholder) */
.sortable-cell.dragging {
	opacity: 0.4;
}

/* Drag overlay (preview following cursor) */
.cell-drag-overlay {
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	border-radius: 4px;
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-focusBorder);
	opacity: 0.95;
	pointer-events: none;
}
```

#### 4. Add handleId to Cell Interface

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.ts`

Add to the `IPositronNotebookCell` interface:

```typescript
/**
 * Stable identifier for drag-and-drop operations.
 * Uses the cell's internal handle ID which persists across renders.
 */
readonly handleId: string;
```

#### 5. Implement handleId in Cell Classes

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/PositronNotebookCodeCell.ts`

Add getter:
```typescript
get handleId(): string {
	return this._cell.handle.toString();
}
```

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/PositronNotebookMarkdownCell.ts`

Add same getter:
```typescript
get handleId(): string {
	return this._cell.handle.toString();
}
```

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles: `npm run compile`
- [ ] No lint errors in new files
- [ ] Components export correctly

#### Manual Verification:
- [ ] Import `SortableCellList` in a test file to verify module resolution works

**Implementation Note**: After completing this phase, pause for manual verification before proceeding to Phase 3.

---

## Phase 3: Integrate with PositronNotebookComponent

### Overview
Wire up the sortable components to the notebook, using the existing `moveCells()` method signature and implementing a drag handler.

### Changes Required

#### 1. Implement moveCells() Method Body

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`

The `moveCells()` method already exists with signature `moveCells(cells: IPositronNotebookCell[], targetIndex: number)`.
Implement its body (around line 1375):

```typescript
moveCells(cells: IPositronNotebookCell[], targetIndex: number): void {
	this._assertTextModel();

	const allCells = this.cells.get();

	// Validate inputs
	if (cells.length === 0 || targetIndex < 0 || targetIndex > allCells.length) {
		return;
	}

	// Get indices of cells to move
	const indices = cells.map(cell => allCells.indexOf(cell)).filter(idx => idx !== -1);
	if (indices.length === 0) {
		return;
	}

	// Sort indices to move cells in order
	indices.sort((a, b) => a - b);

	// Check if move is necessary
	const firstIndex = indices[0];
	if (indices.length === 1 && firstIndex === targetIndex) {
		return;
	}

	const textModel = this.textModel;
	const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';

	// Adjust target index based on removal of cells above it
	// This follows the VS Code algorithm from cellDnd.ts
	let adjustedTarget = targetIndex;
	for (const idx of indices) {
		if (idx < targetIndex) {
			adjustedTarget--;
		}
	}

	// Build edit operations
	const edits: ICellEditOperation[] = [];

	// For single cell, use CellEditType.Move
	if (indices.length === 1) {
		edits.push({
			editType: CellEditType.Move,
			index: firstIndex,
			length: 1,
			newIdx: adjustedTarget
		});
	} else {
		// For multiple cells, remove then insert
		// Remove cells (in reverse order to maintain indices)
		for (let i = indices.length - 1; i >= 0; i--) {
			edits.push({
				editType: CellEditType.Replace,
				index: indices[i],
				count: 1,
				cells: []
			});
		}

		// Insert cells at target
		const cellsToInsert = indices.map(idx => allCells[idx]);
		edits.push({
			editType: CellEditType.Replace,
			index: adjustedTarget,
			count: 0,
			cells: cellsToInsert.map(cell => cell.getCellDto())
		});
	}

	// Apply edits with selection tracking
	const beforeSelections = indices.map(idx => ({ start: idx, end: idx + 1 }));
	const afterSelections = Array.from({ length: cells.length }, (_, i) => ({
		start: adjustedTarget + i,
		end: adjustedTarget + i + 1
	}));

	textModel.applyEdits(edits, true, {
		kind: SelectionStateType.Index,
		focus: beforeSelections[0],
		selections: beforeSelections
	}, () => ({
		kind: SelectionStateType.Index,
		focus: afterSelections[0],
		selections: afterSelections
	}), undefined, computeUndoRedo);

	// Update selection to follow the moved cells
	const movedCells = this.cells.get().slice(adjustedTarget, adjustedTarget + cells.length);
	if (movedCells.length > 0) {
		this.selectionStateMachine.selectCell(movedCells[0], 'select');
		for (let i = 1; i < movedCells.length; i++) {
			this.selectionStateMachine.selectCell(movedCells[i], 'add');
		}
	}

	this._onDidChangeContent.fire();
}
```

#### 2. Add Helper Method for Single Cell Move

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`

Add a convenience method for drag-and-drop of single cells:

```typescript
/**
 * Move a single cell from one index to another (for drag-and-drop).
 * @param fromIndex The current index of the cell
 * @param toIndex The target index for the cell
 */
moveCell(fromIndex: number, toIndex: number): void {
	const cells = this.cells.get();
	if (fromIndex < 0 || fromIndex >= cells.length || toIndex < 0 || toIndex > cells.length) {
		return;
	}
	if (fromIndex === toIndex || fromIndex === toIndex - 1) {
		return; // No movement needed
	}

	const cellToMove = cells[fromIndex];
	// Adjust target if moving down (account for removal)
	const targetIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
	this.moveCells([cellToMove], targetIndex);
}
```

#### 3. Update PositronNotebookComponent

**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookComponent.tsx`

Update to use SortableCellList:

```tsx
// Add imports at top
import { SortableCellList } from './notebookCells/SortableCellList.js';
import { SortableCell } from './notebookCells/SortableCell.js';

// In the component, wrap cell rendering with SortableCellList
// Find the cell rendering section and update:

const handleReorder = React.useCallback((oldIndex: number, newIndex: number) => {
	// Use the new moveCell helper for single cell moves
	notebookInstance.moveCell(oldIndex, newIndex);
}, [notebookInstance]);

// Check if notebook is read-only
const isReadOnly = notebookInstance.isReadOnly;

// Wrap the cells rendering:
<SortableCellList
	cells={cells}
	onReorder={handleReorder}
	disabled={isReadOnly}
>
	{/* Existing cell rendering logic, but wrap each cell with SortableCell */}
	{cells.map((cell, index) => (
		<SortableCell key={cell.handleId} cell={cell}>
			{/* Existing NotebookCellWrapper or cell content */}
		</SortableCell>
	))}
</SortableCellList>
```

#### 4. Update NotebookCellWrapper Integration

**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellWrapper.tsx`

Ensure the wrapper works correctly inside SortableCell. May need to adjust styling or event handling to prevent conflicts between selection clicks and drag operations.

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles without errors
- [ ] Existing notebook unit tests pass
- [ ] No runtime errors in console when loading notebook

#### Manual Verification:
- [ ] Open a notebook with multiple cells
- [ ] Hover over a cell to see the drag handle appear on the left
- [ ] Click and drag the handle to reorder cells
- [ ] Verify the cell moves to the new position
- [ ] Verify undo (Cmd+Z) reverts the move
- [ ] Verify existing move buttons still work
- [ ] Verify keyboard shortcuts (Alt+Up/Down) still work

**Implementation Note**: After completing this phase, pause for thorough manual testing of drag-and-drop functionality before proceeding to Phase 4.

---

## Phase 4: Add Tests

### Overview
Add unit tests for the move logic and E2E tests for the drag-and-drop user interaction.

### Changes Required

#### 1. Unit Tests for moveCells

**File**: `src/vs/workbench/contrib/positronNotebook/browser/test/moveCells.test.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
// Import test utilities and mocks as needed

suite('PositronNotebookInstance - moveCells', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('moveCells moves single cell from index 0 to index 2', async () => {
		// Setup notebook with 3 cells
		// const cellToMove = cells[0];
		// Call moveCells([cellToMove], 2)
		// Assert cell order changed correctly
	});

	test('moveCells moves single cell from index 2 to index 0', async () => {
		// Setup notebook with 3 cells
		// const cellToMove = cells[2];
		// Call moveCells([cellToMove], 0)
		// Assert cell order changed correctly
	});

	test('moveCells moves multiple cells', async () => {
		// Setup notebook with 5 cells
		// const cellsToMove = [cells[0], cells[2]];
		// Call moveCells(cellsToMove, 4)
		// Assert both cells moved to end
	});

	test('moveCell helper moves single cell correctly', async () => {
		// Setup notebook with 3 cells
		// Call moveCell(0, 2)
		// Assert cell moved from index 0 to index 1 (adjusted for removal)
	});

	test('moveCells with empty array does nothing', async () => {
		// Setup notebook
		// Call moveCells([], 1)
		// Assert no change
	});

	test('moveCells with invalid target index does nothing', async () => {
		// Setup notebook with 3 cells
		// Call moveCells([cells[0]], -1) or moveCells([cells[0]], 10)
		// Assert no error and no change
	});

	test('moveCells updates selection to follow moved cells', async () => {
		// Setup notebook
		// Select cells at indices 0 and 1
		// Call moveCells([cells[0], cells[1]], 3)
		// Assert selection is now at indices 1 and 2 (adjusted)
	});
});
```

#### 2. E2E Tests for Drag-and-Drop

**File**: `test/e2e/tests/notebooks/notebook-cell-drag.test.ts`

```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.describe('Notebook Cell Drag and Drop', {
	tag: [tags.NOTEBOOKS, tags.EDITOR]
}, () => {
	test.beforeEach(async ({ app }) => {
		// Create a test notebook with multiple cells
		await app.workbench.notebooks.createNewNotebook();
		// Add 3 code cells with distinct content
		await app.workbench.notebooks.addCodeCell('# Cell 1');
		await app.workbench.notebooks.addCodeCell('# Cell 2');
		await app.workbench.notebooks.addCodeCell('# Cell 3');
	});

	test('Can drag cell from first to last position', async ({ app, page }) => {
		// Get the drag handle of the first cell
		const firstCellHandle = page.locator('.sortable-cell').first().locator('.cell-drag-handle');
		const lastCellDrop = page.locator('.sortable-cell').last();

		// Perform drag operation
		await firstCellHandle.dragTo(lastCellDrop);

		// Verify cell order changed
		const cells = page.locator('.sortable-cell');
		await expect(cells.first()).toContainText('# Cell 2');
		await expect(cells.last()).toContainText('# Cell 1');
	});

	test('Can undo drag operation', async ({ app, page }) => {
		const firstCellHandle = page.locator('.sortable-cell').first().locator('.cell-drag-handle');
		const lastCellDrop = page.locator('.sortable-cell').last();

		// Drag and then undo
		await firstCellHandle.dragTo(lastCellDrop);
		await page.keyboard.press('Meta+z'); // or Ctrl+z on Windows

		// Verify original order restored
		const cells = page.locator('.sortable-cell');
		await expect(cells.first()).toContainText('# Cell 1');
	});

	test('Drag handle appears on hover', async ({ page }) => {
		const firstCell = page.locator('.sortable-cell').first();
		const dragHandle = firstCell.locator('.cell-drag-handle');

		// Initially not visible (or low opacity)
		await expect(dragHandle).toHaveCSS('opacity', '0');

		// Hover to reveal
		await firstCell.hover();
		await expect(dragHandle).not.toHaveCSS('opacity', '0');
	});

	test('Move buttons still work alongside drag', async ({ app, page }) => {
		// Click move down button on first cell
		await page.locator('.sortable-cell').first().click();
		await app.workbench.notebooks.moveCellDown();

		// Verify cell moved
		const cells = page.locator('.sortable-cell');
		await expect(cells.first()).toContainText('# Cell 2');
		await expect(cells.nth(1)).toContainText('# Cell 1');
	});
});
```

### Success Criteria

#### Automated Verification:
- [ ] Unit tests pass: `npm run test-extension -- -l positron-notebook --grep "moveCells"`
- [ ] E2E tests pass: `npx playwright test notebook-cell-drag.test.ts --project e2e-electron`

#### Manual Verification:
- [ ] Run full notebook test suite to ensure no regressions
- [ ] Test on both macOS and Windows if possible

---

## Testing Strategy

### Unit Tests
- `moveCells()` logic in PositronNotebookInstance
- Edge cases: invalid indices, same index, empty notebook
- Selection state updates after move

### E2E Tests
- Drag cell from position A to position B
- Drag handle visibility on hover
- Undo/redo support
- Keyboard shortcuts still work
- Move buttons still work

### Manual Testing Steps
1. Create notebook with 5+ cells of mixed types (code and markdown)
2. Drag first cell to last position
3. Drag last cell to first position
4. Drag middle cell to different middle position
5. Try to drag when notebook is read-only (should not work)
6. Test undo after each drag
7. Test that cell selection follows the dragged cell
8. Test that cell focus is correct after drag
9. Test rapid successive drags

## Performance Considerations

- @dnd-kit is lightweight (~53KB total) compared to alternatives
- Drag operations should not cause full notebook re-render
- Use `React.memo` or `useMemo` for cell components if performance issues arise
- Consider virtualization integration if notebooks have 100+ cells

## Rollback Plan

If issues arise:
1. Remove import map entries for @dnd-kit
2. Revert PositronNotebookComponent to previous render logic
3. Keep `moveCells()` implementation (can be used for other features)
4. Bundle files can remain in repo (unused modules don't affect runtime)

## References

- Draft research: `thoughts/shared/research/2026-01-27-dnd-kit-integration-draft.md`
- ESM dependency pattern: `src/esm-package-dependencies/react-window.js`
- Existing move implementation: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts:1273-1382`
- dnd-kit documentation: https://docs.dndkit.com/

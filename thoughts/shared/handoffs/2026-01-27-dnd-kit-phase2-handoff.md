---
type: handoff
title: "dnd-kit Integration - Phase 2 Handoff"
created: 2026-01-27
from_phase: 1
to_phase: 2
status: ready
---

# dnd-kit Integration - Phase 2 Handoff

## Summary

Phase 1 of the dnd-kit integration is complete. The @dnd-kit packages are now bundled as ESM dependencies and available for import. Phase 2 involves creating the React components that will enable drag-and-drop reordering of notebook cells.

## What Was Completed in Phase 1

### Files Created

1. **ESM Bundle Files** (downloaded from esm.sh and patched with relative imports):
   - `src/esm-package-dependencies/v135/@dnd-kit/core@6.3.0/es2022/core.mjs`
   - `src/esm-package-dependencies/v135/@dnd-kit/sortable@10.0.0/es2022/sortable.mjs`
   - `src/esm-package-dependencies/v135/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs`
   - `src/esm-package-dependencies/v135/@dnd-kit/accessibility@3.1.1/es2022/accessibility.mjs`

2. **Entry Point Wrappers**:
   - `src/esm-package-dependencies/core.js` - exports @dnd-kit/core
   - `src/esm-package-dependencies/sortable.js` - exports @dnd-kit/sortable
   - `src/esm-package-dependencies/utilities.js` - exports @dnd-kit/utilities

### Files Modified

1. **Import Maps Updated**:
   - `src/vs/code/electron-browser/workbench/workbench.html` - static importmap entries
   - `src/vs/code/browser/workbench/workbench.html` - addModule() calls
   - `test/unit/electron/renderer.html` - addModule() calls

2. **Dependencies Added**:
   - `package.json` - added @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities for TypeScript types

3. **License Compliance**:
   - `ThirdPartyNotices.txt` - added @dnd-kit MIT license notice

## Phase 2 Objective

Create React components that wrap notebook cells with dnd-kit sortable functionality:
- `SortableCell` - wraps individual cells with drag handle
- `SortableCellList` - provides DndContext and SortableContext

## Key Files to Reference

### Implementation Plan
**Read this first**: `thoughts/shared/plans/2026-01-27-dnd-kit-integration.md`
- Phase 2 section starts around line 319
- Contains exact code for SortableCell.tsx and SortableCellList.tsx

### Existing Notebook Cell Files
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.ts` - cell interface (needs `handleId` property)
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/PositronNotebookCodeCell.ts` - code cell implementation
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/PositronNotebookMarkdownCell.ts` - markdown cell implementation
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/NotebookCellWrapper.tsx` - existing cell wrapper component

### Notebook Component
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookComponent.tsx` - main notebook React component (will integrate SortableCellList in Phase 3)

## Phase 2 Tasks

### 1. Create SortableCell Component
**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCell.tsx`

Key points:
- Uses `useSortable` hook from @dnd-kit/sortable
- Renders a drag handle button with `codicon-gripper` icon
- Wraps children (the actual cell content)
- Uses `cell.handleId` for the sortable ID

### 2. Create SortableCellList Component
**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCellList.tsx`

Key points:
- Provides `DndContext` and `SortableContext`
- Configures PointerSensor with 10px activation distance
- Handles `onDragStart`, `onDragEnd`, `onDragCancel`
- Calls `onReorder(oldIndex, newIndex)` callback
- Supports `disabled` prop for read-only mode
- Optional `DragOverlay` for drag preview

### 3. Add CSS Styles
**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/notebookCells.css`

Add styles for:
- `.cell-drag-handle` - positioned left of cell, visible on hover
- `.sortable-cell.dragging` - reduced opacity for placeholder
- `.cell-drag-overlay` - shadow/border for drag preview

### 4. Add handleId to Cell Interface
**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.ts`

Add to interface:
```typescript
readonly handleId: string;
```

### 5. Implement handleId in Cell Classes
**Files**:
- `PositronNotebookCodeCell.ts`
- `PositronNotebookMarkdownCell.ts`

Add getter:
```typescript
get handleId(): string {
    return this._cell.handle.toString();
}
```

## Import Pattern

When importing @dnd-kit in TypeScript files:
```typescript
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    DndContext,
    DragOverlay,
    closestCenter,
    PointerSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
```

Types are provided by the npm packages installed in node_modules/@dnd-kit/*.

## Success Criteria for Phase 2

### Automated
- [ ] TypeScript compiles: `npm run compile`
- [ ] No lint errors in new files
- [ ] Components export correctly

### Manual
- [ ] Import `SortableCellList` in a test file to verify module resolution

## Notes

- The plan mentions creating a `dnd-kit.d.ts` type declaration file, but this is NOT needed because the npm packages include their own TypeScript types
- The sortable.mjs imports core@6.3.0 (not 6.3.1), so we use core@6.3.0
- utilities.mjs uses react@18.2.0 while other packages use react@18.3.1 - both versions are already bundled in the repo

## Branch

Current branch: `positron-nb-drag-to-reorder-cells-experiment`

## Commands

```bash
# Compile to verify changes
npm run compile

# Run notebook-related tests (after Phase 4)
npm run test-extension -- -l positron-notebooks
```

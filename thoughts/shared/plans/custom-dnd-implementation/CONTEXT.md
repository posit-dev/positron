# Running Implementation Context

This document tracks the state of the custom drag-and-drop implementation across agent sessions. Each agent MUST read this before starting work and update it after completing work.

## Last Updated
- Plan: 02 (Complete)
- Date: 2026-01-28
- Commit: 19c752d392
- Agent: Plan 02 execution

## Current State

**Status**: Plan 02 complete - Keyboard navigation and auto-scroll implemented

The custom DnD implementation now handles:
- Basic mouse-based drag-and-drop operations
- Auto-scroll when dragging near container edges
- Keyboard activation (Space/Enter to start drag)
- Arrow key navigation during drag (though primary navigation is via mouse)

All 14/14 E2E tests pass.

## Files Created/Modified

### Plan Files (initial setup)
- `thoughts/shared/plans/custom-dnd-implementation/00-coordination.md` - Master coordination document
- `thoughts/shared/plans/custom-dnd-implementation/01-basic-drag-infrastructure.md` - Plan 01
- `thoughts/shared/plans/custom-dnd-implementation/02-keyboard-and-scroll.md` - Plan 02
- `thoughts/shared/plans/custom-dnd-implementation/03-animations-and-accessibility.md` - Plan 03
- `thoughts/shared/plans/custom-dnd-implementation/04-advanced-features.md` - Plan 04 (optional)
- `thoughts/shared/plans/custom-dnd-implementation/TEST-EXPECTATIONS.md` - Which tests pass at each stage
- `thoughts/shared/plans/custom-dnd-implementation/ORCHESTRATOR-PROMPT.md` - Prompt for autonomous execution
- `thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md` - This file

### Implementation Files (Plan 01)
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/types.ts` - Core type definitions
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/collisionDetection.ts` - closestCenter algorithm
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/DndContext.tsx` - React context provider
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/useDraggable.ts` - Draggable hook
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/useDroppable.ts` - Droppable hook
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/useSortable.ts` - Combined sortable hook
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/SortableContext.tsx` - High-level sortable API
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/DragOverlay.tsx` - Portal-rendered drag overlay
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/index.ts` - Public exports
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCellList.tsx` - Updated to use custom DnD
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCell.tsx` - Updated to use custom DnD

### Implementation Files (Plan 02 - NEW)
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/autoScroll.ts` - Auto-scroll controller with continuous scrolling loop
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/keyboardCoordinates.ts` - Arrow key coordinate mapping for sortable lists
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/types.ts` - Added SensorOptions, KeyboardCoordinateGetter, AutoScrollOptions
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/DndContext.tsx` - Added keyboard and auto-scroll integration
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/useDraggable.ts` - Added keyboard activation (Space/Enter)
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/SortableContext.tsx` - Added scrollContainerRef prop and keyboard config
- `src/vs/workbench/contrib/positronNotebook/browser/dnd/index.ts` - Exported new types and utilities
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableCellList.tsx` - Added scrollContainerRef prop
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookComponent.tsx` - Passes containerRef to SortableCellList

## Key Decisions Made

1. **Replace dnd-kit with custom implementation** - Eliminates ~53KB external dependency
2. **Preserve existing moveCell() API** - No changes needed to PositronNotebookInstance
3. **Maintain E2E test compatibility** - All 14 existing tests continue passing
4. **Phased approach** - Four discrete plans, each completable by a fresh agent
5. **Context preservation** - This CONTEXT.md file serves as handoff document
6. **Pending drag as state** - Using React state (not just refs) for pending drag to ensure event listeners attach synchronously after state update
7. **Continuous scroll loop** - AutoScrollController uses requestAnimationFrame loop for smooth scrolling while cursor is at edge
8. **Ref-based state tracking** - `isDraggingRef` tracks dragging state to avoid stale closure issues in event handlers

## Implementation Notes (Plan 01)

### Key Technical Details
- **Pending drag tracking**: The `pendingDrag` state triggers a re-render which attaches window event listeners. This ensures `pointermove` events are captured before the test's mouse movements occur.
- **Callback refs**: `onDragStart`, `onDragEnd`, `onDragCancel` callbacks are stored in refs to avoid stale closures in event handlers.
- **Collision detection**: Uses simple center-to-center distance (same as dnd-kit's closestCenter).
- **DragOverlay**: Renders via React portal to document.body, positioned at initial element rect + cursor delta.

## Implementation Notes (Plan 02)

### Key Technical Details
- **Auto-scroll controller**: Uses a continuous `requestAnimationFrame` loop while dragging. Updates position via `update()` method and continues scrolling until `stop()` is called.
- **Scroll container ref**: Passed from PositronNotebookComponent through SortableCellList -> SortableContext -> DndContext. The AutoScrollController reads `.current` lazily to handle initial mount timing.
- **Threshold and speed**: Auto-scroll triggers within 100px of container edges, scrolling at 15px per frame for responsive feedback.
- **isDraggingRef**: Critical for avoiding stale closures. The `state.status` in effect closures may be stale; the ref always has the current value.
- **Keyboard activation**: Space/Enter on drag handle starts drag from element center. Arrow keys during drag update position via `sortableKeyboardCoordinates`.

### Deferred Features
- FLIP animations (Plan 03)
- Screen reader announcements (Plan 03)
- Touch support (Plan 04)

## Known Issues/TODOs

- [ ] dnd-kit still vendored (remove after Plan 03 verified)
- [x] E2E tests reference dnd-kit class names (verified - tests use generic selectors, no dnd-kit references)
- [x] Auto-scroll test (now passing with Plan 02 implementation)

## Verification Commands

**IMPORTANT**: See `TEST-EXPECTATIONS.md` for which tests should pass at each plan stage.

```bash
# Verify build
npm run compile

# Plan 02+ verification (all 14 tests)
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list
```

## Test Results (Plan 02)

All 14 tests passed:
- Action Bar: swap 1st and 2nd cell
- Keyboard: swap 1st and 2nd cell
- Boundaries: first-up and last-down are no-ops
- Multi-move: move first to end then one up
- Undo/redo cell move operation
- Multiselect: move multiple cells
- Drag handle: visible on hover, hidden otherwise
- Drag-and-drop: swap 1st and 2nd cell
- Drag-and-drop: move cell to end
- Drag-and-drop: move cell from end to beginning
- Drag-and-drop: undo restores original order
- Drag-and-drop: redo reapplies reorder
- Drag-and-drop: escape cancels drag operation
- Drag-and-drop: auto-scroll when dragging in long notebook (NEW - Plan 02)

## State at Handoff

- **Current**: Custom DnD implementation with mouse support, auto-scroll, and keyboard activation
- **Next Action**: Execute Plan 03 (FLIP Animations and Accessibility)

## Plan Execution Checklist

- [x] Plan 01: Basic Drag Infrastructure
- [x] Plan 02: Keyboard Navigation and Auto-Scroll
- [ ] Plan 03: FLIP Animations and Accessibility
- [ ] Plan 04: Advanced Features (Optional)
- [ ] Cleanup: Remove dnd-kit vendor files

## Notes for Next Agent

1. Start by reading this file and Plan 03
2. Run verification commands before making changes
3. Plan 03 should add:
   - FLIP animations for smooth item transitions during drag
   - Screen reader announcements for accessibility
4. Update this file after completing your plan
5. Commit with message format: `feat(notebooks): [Plan 03] description`

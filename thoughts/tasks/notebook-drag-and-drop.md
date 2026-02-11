# Task: Notebook Cell Drag-and-Drop

**Status:** in-progress
**Last Updated:** 2026-02-05 (Fixed primary cell ordering and visual gap issues in multi-drag)

## Context for Claude

When working with this task, keep this file updated:
- **Current State**: Update when features/components are completed
- **Decisions Made**: Add when you choose between approaches (include why)
- **Key Files**: Add files you discover that are central but weren't listed
- **Gap detection**: If you had to look something up that should have been documented here, add it immediately

Keep updates concise - bullet points, not paragraphs.

## Overview

Custom drag-and-drop system for Positron Notebooks, replacing a vendored dnd-kit library (~53KB) with a minimal custom implementation. The goal is to enable cell reordering via mouse/keyboard/touch while maintaining smooth FLIP animations (items visually shift during drag).

## Key Files

- `browser/dnd/DndContext.tsx` - Core React context provider; manages drag state, collision detection, auto-scroll
- `browser/dnd/DragOverlay.tsx` - Renders the dragged cell visual; currently snaps to insertion position
- `browser/dnd/animations.ts` - FLIP animation calculations (slot heights, transforms); includes `calculateMultiSortingTransforms` for multi-cell drag
- `browser/dnd/AnimationContext.tsx` - React context for animation state; `updateSortingState` accepts `activeIds[]` for multi-drag
- `browser/dnd/MultiDragContext.tsx` - React context for multi-cell drag state; tracks activeIds, provides `startMultiDrag`/`endMultiDrag`
- `browser/dnd/SortableContext.tsx` - Coordinates DndContext with MultiDragContext; handles batch reorder
- `browser/dnd/useSortable.ts` - Hook combining draggable/droppable behavior for cells
- `browser/notebookCells/SortableCell.tsx` - Cell wrapper applying sortable behavior; uses `useMultiDragState` for collapse visual
- `browser/notebookCells/SortableCell.css` - Drag handle, lift effects, overlay styling; includes `.collapsed-drag` for non-primary cells
- `browser/notebookCells/SortableCellList.tsx` - Integrates DndContext with notebook cells; wraps with MultiDragProvider
- `browser/PositronNotebookComponent.tsx` - Passes `selectedIds` and `handleBatchReorder` to SortableCellList
- `test/e2e/tests/notebooks-positron/notebook-cell-reordering.test.ts` - E2E tests for drag-and-drop (14 single-cell + 6 multi-cell)
- `test/e2e/pages/notebooksPositron.ts` - Page object with drag helpers: `dragMultiCellToPosition`, `moveDragToCell`, `expectNoCellOverlaps`

## Decisions Made

- **In-place animation vs overlay clone**: Animate the actual cell rather than hiding it and showing a clone - reduces visual complexity and prevents "where did my cell go" confusion
- **Slot heights for transforms**: Use distance between item tops rather than item heights to prevent overlap with variable-height cells
- **Capture rects at drag start**: Store initial droppable rects and adjust for scroll to prevent feedback loops from CSS transforms affecting measurements
- **Items array for collision order**: Pass authoritative items array to DndContext for stable collision detection (droppables map order was unreliable)
- **Infer gap for edge cases**: Calculate CSS gap from adjacent rects rather than hardcoding - ensures last item's slot height includes the gap for proper edge positioning
- **Multi-drag via separate context**: MultiDragContext works alongside DndContext rather than modifying it - keeps single-cell drag unchanged
- **scaleY collapse for non-primary cells**: Non-primary dragged cells collapse via CSS scaleY transform with thin colored bar indicator - simpler than height animation
- **Gap-closing shifts for collapsed cells**: When non-primary cells collapse, adjacent items shift to close the visual gap - maintains compact visual during drag rather than showing accurate final positions

## Current State

**Completed:**
- Custom DnD infrastructure (Plans 01-04 complete)
- dnd-kit vendor files removed
- Mouse, keyboard, touch activation
- Auto-scroll near edges
- FLIP animations (items shift during drag)
- Accessibility announcements
- All 14 single-cell E2E tests passing
- Multi-cell drag-and-drop basic implementation

**Multi-Cell Drag Bug Status:**

Run tests with:
```bash
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list
```

**Fixed: Multi-cell drag DOWN overlap bug** (17 out of 24 tests pass)
- Root cause was in `animations.ts:calculateMultiSortingTransforms()`: non-active items were shifting by `primarySlotHeight` instead of `totalActiveSlotHeight` when dragging DOWN
- Additional fixes: save activeIds before clearing in handleDragEnd, use ref for selectedIds in startMultiDrag

**Remaining Issues:**
1. ~~Multi-drag UP has cursor positioning issues (cells sometimes go to wrong position or wrong order)~~ (likely fixed by primary cell ordering fix)
2. Non-adjacent multi-drag tests timeout (Cmd/Ctrl+click selection may not work correctly)
3. Auto-scroll test pre-existing failure

**E2E Tests for Multi-Cell Drag:**
- `Multi-drag: move two selected cells down` - PASS
- `Multi-drag: move two selected cells up` - PASS
- `Multi-drag: cells do not overlap when dragging down` - PASS
- `Multi-drag: cells do not overlap when dragging up` - FAIL (test cursor positioning issue)
- `Multi-drag: undo restores original order` - PASS
- `Multi-drag: escape cancels operation` - PASS

**Non-adjacent multi-drag tests (4 tests) - ALL FAIL (timeout on selection):**
- `Multi-drag non-adjacent: move cells 1 and 3 down`
- `Multi-drag non-adjacent: move cells 2 and 4 up`
- `Multi-drag non-adjacent: drag unselected cell moves only that cell`
- `Multi-drag non-adjacent: three non-adjacent cells`

**Page Object Helpers Added:**
- `dragMultiCellToPosition(primaryIndex, toIndex)` - complete multi-drag operation
- `moveDragToCell(targetIndex, position)` - move cursor during active drag
- `releaseDrag()` - release mouse to complete drag
- `getCellBoundingBoxes()` - get visual positions during drag animations
- `expectNoCellOverlaps(tolerance)` - verify no visual overlaps

**In Progress - Other Visual Bugs:**
- Overlay positioning doesn't always align with insertion point
- ~~Animation timing issues (stuttering, not smooth)~~ (improved in 8be122f80c)
- Cell jumps/flickers during or after drag
- ~~Edge overlap when dragging to first/last position~~ (fixed in b22fca705b)
- ~~Animation snap when returning to original position~~ (fixed in 8be122f80c)
- ~~Excessive visual gap during multi-cell drag~~ (fixed 2026-02-05 with gap-closing shifts)

**Recent Changes (post-Plan-04):**
- E2E tests for multi-cell drag (uncommitted)
  - `notebook-cell-reordering.test.ts` - Added 6 multi-cell drag tests including overlap detection
  - `notebooksPositron.ts` - Added page object helpers for multi-drag testing
- Multi-cell drag-and-drop implementation (uncommitted)
  - `animations.ts` - Added `calculateMultiSortingTransforms()` for multi-cell transform calculations
  - `AnimationContext.tsx` - Updated to accept `activeIds[]` instead of single `activeId`
  - `MultiDragContext.tsx` - Added `useOptionalMultiDragContext()` hook
  - `SortableContext.tsx` - Integrated with MultiDragContext, added batch reorder logic
  - `SortableCellList.tsx` - Wrapped with MultiDragProvider, passes selectedIds
  - `PositronNotebookComponent.tsx` - Gets selected IDs from selection machine, adds batch handler
  - `SortableCell.tsx` - Uses `useMultiDragState` for collapse visual, uses `transformToString`
  - `SortableCell.css` - Added `.collapsed-drag` styles with thin bar indicator
- `8be122f80c` - Fix animation snap when returning to original position; snappier timing (150ms, ease-out)
- `b22fca705b` - Fix edge overlap by inferring CSS gap for last item slot height
- `155351d1a9` - Snap drag overlay to gap position
- `c94d1ef48a` - Animate dragged cell in-place (major refactor)
- `96fa6115b2` - Attempt to fix slot-finding behavior
- `5c0270a624` - Inner element styling for drag visual

## Related Docs

- `thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md` - Implementation context (slightly stale)
- `thoughts/shared/plans/custom-dnd-implementation/00-coordination.md` - Plan coordination
- `thoughts/shared/research/2026-01-28-dnd-kit-replacement-analysis.md` - Original research

## Fix Applied: Primary Cell Ordering and Visual Gaps (2026-02-05)

**Problem 1: Wrong cell treated as primary during multi-drag**
- When selecting cell A then cell B, then dragging cell B, the `activeIds` array was `[A, B]`
- Code used `activeIds[0]` as primary, so cell A was full-size while cell B (the one being dragged) collapsed
- This was backwards - the cell under the cursor should be primary

**Fix in `MultiDragContext.tsx:startMultiDrag`:**
```typescript
// Before: used selectedIds directly (wrong cell could be primary)
const idsToMove = currentSelectedIds.includes(primaryId)
    ? currentSelectedIds
    : [primaryId];

// After: primaryId (the dragged cell) is always first
const idsToMove = currentSelectedIds.includes(primaryId)
    ? [primaryId, ...currentSelectedIds.filter(id => id !== primaryId)]
    : [primaryId];
```

**Problem 2: Excessive visual gaps during multi-cell drag**
- Non-primary cells collapse to 4px lines during drag
- But shift calculations used full `totalActiveSlotHeight`, creating gaps where collapsed cells "should" be

**Fix in `animations.ts:calculateMultiSortingTransforms`:**
- Dragging DOWN: items between active and insertion shift by `totalActiveSlotHeight` (fill vacated space); items at/after insertion shift UP by `gapToClose` (close visual gap from collapsed cells)
- Dragging UP: items between insertion and first active shift by `visualDragSize` (only what's visually needed); items after last active shift UP by `gapToClose` (fill vacated space)
- `gapToClose = totalActiveSlotHeight - visualDragSize` where `visualDragSize = primarySlotHeight + (nonPrimaryCount * (collapsedHeight + gap))`

## Fix Applied: Multi-Drag Collision Detection Bug (2026-02-04)

**Original plan:** Update `detectInsertionIndex` to accept `activeIds: string[]` instead of `activeId: string | null`

**Changes made:**
1. `collisionDetection.ts` - Changed signature to accept `activeIds: string[]`; exclude ALL active IDs from insertion calculations

2. `types.ts` - Added `activeIds: string[]` to DragState interface

3. `DndContext.tsx`:
   - Import `useOptionalMultiDragContext`
   - Capture activeIds from multi-drag context at drag start
   - Store in DndContext's own state to avoid stale closures
   - **Critical fix:** Added `callbackFired` flag to prevent callbacks from being called multiple times when React calls setState callbacks multiple times

4. `SortableContext.tsx:handleDragEnd` - Use `multiDrag.getActiveIds()` for synchronous access

5. `MultiDragContext.tsx` - Already had `activeIdsRef` and `getActiveIds()` from previous fixes

## Previous Fix: Multi-Drag DOWN Bug (2026-02-04)

**Changes made:**
1. `animations.ts:329` - Changed shift amount calculation (note: further revised in 2026-02-05 fix above)

2. `SortableContext.tsx:handleDragEnd` - Save activeIds BEFORE calling endMultiDrag (which clears them)

3. `MultiDragContext.tsx:startMultiDrag` - Use ref for selectedIds to avoid stale closure issues

## Remaining Issues to Fix

**"cells do not overlap when dragging up" test failure:**
- Test cursor positioning ends up above Cell0's midpoint when targeting Cell1
- Test captures positions BEFORE drag, but final cursor position is too high
- May need different target offset for multi-drag UP vs single-drag UP
- **Update 2026-02-05:** Primary cell ordering fix may resolve this - the wrong cell was being treated as primary, affecting visual positions

**Non-adjacent multi-drag selection timeout:**
- Cmd/Ctrl+click selection via `selectCellAtIndex(..., { addToSelection: true })` times out
- May be an issue with the selection state machine or test page object implementation
- Not related to drag-and-drop code

## Notes

- The "in-place animation" approach (commit c94d1ef48a) was a significant shift from the overlay-clone pattern - may need further refinement
- Variable cell heights complicate transform calculations; slot-height approach was chosen but may have edge cases
- E2E tests now include mid-drag position checks via `expectNoCellOverlaps()` - catches visual bugs, not just final state
- Multi-cell drag uses existing `moveCells()` method on PositronNotebookInstance which handles non-contiguous selection and atomic undo
- `useOptionalMultiDragContext()` allows graceful fallback when MultiDragProvider is not present (backward compatibility)
- Multi-cell collapse animation uses scaleY transform with `transform-origin: top` - if this causes accessibility or scroll issues, consider actual height animation

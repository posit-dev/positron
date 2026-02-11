# Notebook Drag-and-Drop Review Findings

## Finding 1
- File: `src/vs/workbench/contrib/positronNotebook/browser/dnd/useDraggable.ts:31`
- Severity: `P2`
- Title: Touch long-press behavior is bypassed by pointer path
- Details: `useDraggable` starts pending drag on every `pointerdown`, including touch pointers, while also wiring touch long-press handlers. This can activate drag from movement threshold instead of long-press on touch hardware, hurting scroll versus drag separation.

## Finding 2
- File: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts:1395`
- Severity: `P1`
- Title: Non-contiguous multi-drag moves unintended cells
- Details: `moveCells` collapses selected indices to a single contiguous range from `firstIndex` to `lastIndex` and moves that whole block. For selections like `[1,3]`, this also moves the unselected cell at index `2`, so drop results are incorrect.

## Finding 3
- File: `src/vs/workbench/contrib/positronNotebook/browser/dnd/SortableContext.tsx:130`
- Severity: `P1`
- Title: Read-only path can render `SortableCell` without `DndContext`
- Details: When `disabled` is `true`, `SortableContext` returns `children` directly, but children still include `SortableCell` which calls `useSortable` and `useDndContext`. That hook throws outside `DndContext`, so read-only notebooks are at risk of runtime failure.

## Finding 4
- File: `src/vs/workbench/contrib/positronNotebook/browser/dnd/DndContext.tsx:191`
- Severity: `P1`
- Title: Keyboard drag lifecycle is incomplete
- Details: Space or Enter sets a pending drag, but pending drag only activates from pointer movement distance. Arrow key handling requires status `dragging`, so keyboard-only drag never enters a movable state, and there is no Enter/Space drop path in `DndContext`.

## Finding 5
- File: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts:1401`
- Severity: `P2`
- Title: Batch drop no-op can still emit content changes
- Details: Batch reorder always calls `onBatchReorder`, and `moveCells` only treats `targetIndex === firstIndex` as a no-op before adjustment. Drops at `lastActiveIndex + 1` can still run `applyEdits` and fire `onDidChangeContent` even when order is unchanged.

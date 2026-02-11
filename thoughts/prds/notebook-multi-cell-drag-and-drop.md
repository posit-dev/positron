# PRD: Notebook Multi-Cell Drag-and-Drop

## Problem Statement

Data scientists frequently need to reorganize groups of related notebook cells (e.g., a setup cell with its dependent function, or a visualization with its data prep). Today, moving multiple cells requires either:

1. **One-by-one dragging** - Tedious and error-prone when maintaining relative order
2. **Cut/paste** - Breaks flow, loses visual position context

This creates friction in a common notebook workflow: iterating on structure as analysis evolves.

Jupyter and other notebook editors support multi-cell drag natively - Positron's absence of this creates a feature gap.

## Target Users

Data scientists and developers using Positron notebooks who:
- Work with notebooks containing 10+ cells
- Regularly reorganize cells as their analysis develops
- Are familiar with multi-select patterns (Shift+click, Cmd+click)

## Solution

Extend the existing custom drag-and-drop system to support multi-cell dragging.

### Initiation

When user drags a cell's handle while multiple cells are selected:
- If the dragged cell is part of the selection, drag all selected cells
- If the dragged cell is NOT in selection, drag only that cell (matches file manager conventions)

### Visual During Drag

- The primary dragged cell remains fully visible (current behavior)
- Other selected cells collapse into thin neutral lines (4-6px height)
- Lines are positioned relative to the primary cell: cells above in the selection appear as lines above, cells below appear as lines below
- This communicates the structure of what's being dragged

### Animations

- **Collapse**: Cells animate from full size to thin lines over ~150ms when drag starts (instant fallback if complex)
- **Drop**: Collapsed lines expand smoothly back into full cells at their final positions using existing FLIP animation infrastructure

### Selection Support

- Contiguous selection (Shift+click): Supported
- Non-contiguous selection (Cmd+click): Supported - preserves original relative order on drop

### Behavioral Details

| Behavior | Specification |
|----------|---------------|
| Drag threshold | Same 5px as single-cell |
| Post-drop selection | Keep all moved cells selected |
| Cancel (Escape) | Return all cells to original positions |
| Undo granularity | Single undo for entire operation |

### Technical Approach

- Integrate existing `MultiDragContext.tsx` (already written, not connected)
- Connect selection state from `selectionMachine.ts` to DnD context
- Extend `calculateSortingTransforms` to handle multiple active IDs
- Update `onReorder` signature to support batch moves

## Success Criteria

1. **Feature parity**: Multi-cell drag works as users expect
2. **E2E tests pass**: Automated tests verify:
   - Move multiple selected cells together
   - Multi-select drag with undo/redo
   - Multi-select drag across scroll boundary
   - Non-contiguous selection drag
3. **Animation smoothness**: No visual glitches, stuttering, or position jumps

## Non-Goals

- **Cross-notebook drag**: Dragging cells between different notebook tabs
- **Touch/mobile support**: Multi-cell drag on touch devices
- **Telemetry**: No usage tracking for this feature

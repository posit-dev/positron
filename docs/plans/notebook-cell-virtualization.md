# Cell Virtualization for PositronNotebookComponent

## Problem

The notebook currently renders all cells unconditionally -- every cell mounts its full React subtree (Monaco editor widget, outputs, action bars, context key services) regardless of viewport visibility. For notebooks with 50+ cells, this causes:

- Slow initial mount (each Monaco editor is expensive)
- High memory usage (DOM nodes, editor models, context key scopes)
- Sluggish scroll on lower-end hardware (too many mutation observers, resize observers)

## Design Constraints

1. **Cells have unknown, dynamic heights.** Code cells grow when outputs appear; markdown cells change height on edit/preview toggle. Classic fixed-row virtualization doesn't work.
2. **Scroll restoration must still work.** The existing `startScrollRestorationLoop` resolves a target `scrollTop` via `getCellTop(cell)`, which walks the real DOM. Offscreen cells won't have DOM nodes.
3. **Drag-and-drop (dnd-kit) measures droppable rects.** `SortableCellList` uses `MeasuringStrategy.WhileDragging` and relies on each cell having a measurable bounding rect.
4. **Monaco editors are expensive to mount/unmount.** Repeatedly creating and destroying editor widgets defeats the purpose. Editors should be recycled or at least preserved for recently-visible cells.
5. **Cell selection, focus, and keyboard navigation** work via `cell.container` (attached in `NotebookCellWrapper`). Offscreen cells have no container -- the selection machine must still navigate through them.
6. **`cell.reveal()` and `cell.highlightTemporarily()`** need to bring an offscreen cell into view. The virtualization layer must support scrolling to an unmounted cell and rendering it on demand.
7. **Outputs can be arbitrarily tall** (data explorer embeds, large images, long text output). The virtualization needs to handle cells whose height exceeds the viewport.

## Approach: Hybrid Virtualization with Height Estimation

Rather than a fully generic virtual list, build a purpose-built solution that exploits what we know about notebook cells:

- **Placeholder divs** for offscreen cells that occupy the cell's last-known height (or an estimated height for cells never measured)
- **Overscan window** renders cells within N pixels above/below the viewport to smooth scrolling
- **Height cache** stores measured heights keyed by cell handle, survives re-renders
- **Measurement pass** on first render: measure each cell once it mounts, then cache

This is similar to how VS Code's upstream notebook (`NotebookCellList`) works -- it uses a custom virtual list with a height map -- but implemented in React.

## Architecture

```
NotebookBody
  |
  +-- VirtualCellList (new)
  |     |-- manages scroll listener on cells-container
  |     |-- maintains heightMap: Map<cellHandle, number>
  |     |-- computes visibleRange from scrollTop + container height
  |     |-- renders:
  |     |     - spacer div (top, sum of offscreen-above heights)
  |     |     - visible cells (with overscan)
  |     |     - spacer div (bottom, sum of offscreen-below heights)
  |     |
  |     +-- For each visible cell:
  |           SortableCell > NotebookCell (existing tree)
  |           + ResizeObserver to track height changes -> update cache
  |
  +-- GhostCell (unchanged)
```

### Key Components

#### 1. `CellHeightMap` (plain class, not React)

```ts
interface CellHeightMap {
  get(handle: number): number;        // cached or estimated
  set(handle: number, height: number): void;
  getTotalHeight(): number;
  getOffsetTop(index: number): number; // sum of heights 0..index-1
  getIndexAtOffset(scrollTop: number): number; // binary search
}
```

Default estimate: ~120px for code cells (editor min-height + toolbar), ~60px for markdown cells. Refine with running averages as cells get measured.

#### 2. `useVirtualCells` hook

Inputs: cells array, container ref, overscan (px)
Outputs: `{ visibleCells, topSpacer, bottomSpacer, measureRef }`

- Listens to scroll events on the container
- Computes which cell indices are in the visible window + overscan
- Returns spacer heights and the slice of cells to render
- Provides a `measureRef` callback that each rendered cell calls with its measured height

#### 3. Integration with existing systems

| System | Adaptation needed |
|--------|-------------------|
| **Scroll restoration** | `getCellTop(cell)` must work for offscreen cells. Use `heightMap.getOffsetTop(cell.index)` instead of walking DOM. |
| **Drag-and-drop** | During a drag, expand the render window to include all cells (or switch to a simplified measurement that uses the height map). Alternatively, provide synthetic rects from the height map to dnd-kit's `MeasuringConfiguration`. |
| **Cell selection / keyboard nav** | `cell.reveal()` first scrolls the container so the cell's estimated offset is in viewport, which triggers the virtualization to render it, then the existing reveal logic runs. |
| **`isInViewport()`** | Can use the height map's computed offsets instead of `getBoundingClientRect()` for the fast path. |
| **`attachContainer` / context keys** | Only called when the cell actually renders. Offscreen cells have no container -- this is already handled (the cell checks `if (!this._container)`). |
| **AddCellButtons** | Rendered between visible cells. The top/bottom spacers absorb the gap for offscreen buttons. OR: render add-buttons for visible cells only; they're interaction-only elements. |
| **DeletionSentinels** | Sentinels appear at specific indices. If the sentinel's index is in the visible range, render it; otherwise its height is part of a spacer. Sentinels are short-lived (animation), so they'll almost always be near the viewport. |

## Implementation Phases

### Phase 1: Height Map + Measurement Infrastructure

**Goal:** Build and populate the height cache without changing rendering behavior.

1. Create `CellHeightMap` class with estimate-based defaults
2. Add `ResizeObserver` to each rendered cell (via a wrapper or hook) that reports measured height to the map
3. Wire `getCellTop()` to prefer the height map over DOM walking
4. Verify scroll restoration still works with the new `getCellTop`

**Outcome:** Height data is tracked; rendering unchanged. This is a safe, testable foundation.

### Phase 2: Virtual Rendering Core

**Goal:** Only render cells in/near the viewport.

1. Create `useVirtualCells` hook
2. Replace the `renderCellsAndSentinels` call with the virtual cell list
3. Render top/bottom spacer divs
4. Handle the "first render" case where no heights are cached (render all briefly, measure, then virtualize -- or use estimates and correct as cells scroll into view)

**Outcome:** Large notebooks render fast; scrolling is smooth. Some edge cases (drag, reveal) may regress.

### Phase 3: Scroll-to-Cell and Reveal

**Goal:** `cell.reveal()` works for offscreen cells.

1. Compute estimated scroll position from height map
2. Set `container.scrollTop` to bring the cell into the visible window
3. The scroll event triggers `useVirtualCells` to include the cell in its render set
4. After mount + measure, run the existing scroll correction if the estimate was off

**Outcome:** Keyboard navigation (up/down arrow past viewport), "Go to Cell", and find-and-replace all work.

### Phase 4: Drag-and-Drop Compatibility

**Goal:** Cell reordering works with virtualized cells.

Options (pick one):
- **A) Expand render window during drag.** When `DragStartEvent` fires, temporarily render all cells (defeats virtualization during drag, but drags are short). Simple, correct.
- **B) Synthetic rects.** Provide dnd-kit with virtual rects computed from the height map. More complex but keeps the DOM light during drag.

Recommendation: Start with (A). Drags are infrequent and short-lived; the perf impact of temporarily rendering all cells is acceptable. Optimize to (B) later if profiling shows issues with very large notebooks.

### Phase 5: Editor Recycling (Stretch)

**Goal:** Reduce the cost of scrolling through code cells by recycling Monaco editor instances.

- Maintain a pool of N editor widgets (e.g., 5-10 beyond the visible set)
- When a cell scrolls out of view, detach its editor to the pool instead of destroying it
- When a cell scrolls into view, attach a pooled editor and set its model

This is the most complex phase and may not be necessary if Phase 2 performance is acceptable. Monaco editors take ~15-30ms to create; if the overscan window is large enough, users won't see the mount cost during normal scrolling.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Height estimates are wrong, causing scroll jumps | Correct immediately when measured; use the scroll-restoration-loop pattern (rAF correction until stable). Keep estimates conservative (slightly too tall is better than too short). |
| ResizeObserver storms during execution (many outputs arriving) | Batch height updates per animation frame; only recompute visible range once per frame. |
| Complexity of dnd-kit integration | Phase 4 option A (expand during drag) sidesteps most issues. |
| Accessibility: screen readers expect all cells in the DOM | Add `aria-setsize` and `aria-posinset` on rendered cells. Consider rendering a lightweight `role="article"` placeholder for offscreen cells (just the element, no children) for AT navigation. |
| Find-in-notebook needs to search offscreen cell content | Find already searches the cell model (text content), not the DOM. Highlighting the match requires revealing the cell, which Phase 3 handles. |

## Open Questions

1. **Overscan size:** 1000px? 2000px? Needs profiling. Larger overscan = fewer mounts during fast scroll but more DOM nodes.
2. **Should the height map persist across editor reloads?** (Store in `PositronNotebookInstance`'s view state.) Likely yes -- it makes re-opening a notebook faster.
3. **Should we virtualize outputs within a single cell?** A cell with 1000 lines of text output is already handled by CSS `max-height` + `overflow: auto`. But a cell with 50 separate output items might benefit from output-level virtualization. Probably out of scope for v1.
4. **Interaction with the notebook find widget:** The find widget highlights matches in the rendered DOM. If the match is offscreen, we need to reveal the cell. The existing `cell.reveal()` flow handles this once Phase 3 is complete.

## Non-Goals (v1)

- Column-based virtualization (horizontal virtualization of wide outputs)
- Output-level virtualization within a single cell
- Editor instance pooling (Phase 5 is stretch / v2)
- Virtualization of the action bar or toolbar (these are lightweight)

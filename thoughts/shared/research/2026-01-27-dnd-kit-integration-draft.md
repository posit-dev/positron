# dnd-kit Integration Draft

This document outlines the files needed to add @dnd-kit as a bundled ESM dependency following Positron's existing pattern.

## File Structure

```
src/esm-package-dependencies/
├── dnd-kit-core.js                              # Entry point
├── dnd-kit-sortable.js                          # Entry point
├── v135/
│   ├── @dnd-kit/
│   │   ├── core@6.3.1/
│   │   │   └── es2022/
│   │   │       ├── core.mjs                     # ~40 KB
│   │   │       └── core.mjs.map                 # Source map
│   │   ├── sortable@10.0.0/
│   │   │   └── es2022/
│   │   │       ├── sortable.mjs                 # ~8 KB
│   │   │       └── sortable.mjs.map
│   │   ├── utilities@3.2.2/
│   │   │   └── es2022/
│   │   │       ├── utilities.mjs                # ~4 KB
│   │   │       └── utilities.mjs.map
│   │   └── accessibility@3.1.1/
│   │       └── es2022/
│   │           ├── accessibility.mjs            # ~1 KB
│   │           └── accessibility.mjs.map
```

## Entry Point Files

### `src/esm-package-dependencies/dnd-kit-core.js`

```javascript
/* eslint-disable */
// @dnd-kit/core - MIT License - https://github.com/clauderic/dnd-kit
import "./v135/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs";
import "./v135/@dnd-kit/accessibility@3.1.1/es2022/accessibility.mjs";
export * from "./v135/@dnd-kit/core@6.3.1/es2022/core.mjs";
```

### `src/esm-package-dependencies/dnd-kit-sortable.js`

```javascript
/* eslint-disable */
// @dnd-kit/sortable - MIT License - https://github.com/clauderic/dnd-kit
import "./v135/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs";
export * from "./v135/@dnd-kit/sortable@10.0.0/es2022/sortable.mjs";
```

## Import Map Updates

### `src/vs/code/electron-browser/workbench/workbench.html`

Add to the existing importmap (around line 75-85):

```html
<script type="importmap">
{
  "imports": {
    "he": "../../../../esm-package-dependencies/he.js",
    "react": "../../../../esm-package-dependencies/react.js",
    "react-dom": "../../../../esm-package-dependencies/react-dom.js",
    "react-dom/client": "../../../../esm-package-dependencies/client.js",
    "react-window": "../../../../esm-package-dependencies/react-window.js",
    "@dnd-kit/core": "../../../../esm-package-dependencies/dnd-kit-core.js",
    "@dnd-kit/sortable": "../../../../esm-package-dependencies/dnd-kit-sortable.js"
  }
}
</script>
```

### Also update:
- `src/vs/code/browser/workbench/workbench.html`
- `src/vs/code/browser/workbench/workbench-dev.html`

## Bundle Download Script

Create a script to download and patch the bundles:

```bash
#!/bin/bash
# scripts/fetch-dnd-kit-bundles.sh

BASE_DIR="src/esm-package-dependencies/v135/@dnd-kit"

# Create directories
mkdir -p "$BASE_DIR/core@6.3.1/es2022"
mkdir -p "$BASE_DIR/sortable@10.0.0/es2022"
mkdir -p "$BASE_DIR/utilities@3.2.2/es2022"
mkdir -p "$BASE_DIR/accessibility@3.1.1/es2022"

# Download bundles
curl -s "https://esm.sh/@dnd-kit/core@6.3.1/es2022/core.mjs" > "$BASE_DIR/core@6.3.1/es2022/core.mjs"
curl -s "https://esm.sh/@dnd-kit/sortable@10.0.0/es2022/sortable.mjs" > "$BASE_DIR/sortable@10.0.0/es2022/sortable.mjs"
curl -s "https://esm.sh/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs" > "$BASE_DIR/utilities@3.2.2/es2022/utilities.mjs"
curl -s "https://esm.sh/@dnd-kit/accessibility@3.1.1/es2022/accessibility.mjs" > "$BASE_DIR/accessibility@3.1.1/es2022/accessibility.mjs"

# Download source maps
curl -s "https://esm.sh/@dnd-kit/core@6.3.1/es2022/core.mjs.map" > "$BASE_DIR/core@6.3.1/es2022/core.mjs.map"
curl -s "https://esm.sh/@dnd-kit/sortable@10.0.0/es2022/sortable.mjs.map" > "$BASE_DIR/sortable@10.0.0/es2022/sortable.mjs.map"
curl -s "https://esm.sh/@dnd-kit/utilities@3.2.2/es2022/utilities.mjs.map" > "$BASE_DIR/utilities@3.2.2/es2022/utilities.mjs.map"
curl -s "https://esm.sh/@dnd-kit/accessibility@3.1.1/es2022/accessibility.mjs.map" > "$BASE_DIR/accessibility@3.1.1/es2022/accessibility.mjs.map"

echo "Downloaded dnd-kit bundles"
```

## Import Rewriting

The downloaded bundles will have esm.sh import paths like:
```javascript
import{...}from"/react@>=16.8.0?target=es2022";
import{...}from"/@dnd-kit/utilities@^3.2.2?target=es2022";
```

These need to be rewritten to local paths:
```javascript
import{...}from"../../../stable/react@18.3.1/es2022/react.mjs";
import{...}from"../../utilities@3.2.2/es2022/utilities.mjs";
```

### Rewrite Script

```bash
#!/bin/bash
# scripts/patch-dnd-kit-imports.sh

BASE_DIR="src/esm-package-dependencies/v135/@dnd-kit"

# Patch core.mjs
sed -i '' \
  -e 's|from"/react@>=16.8.0?target=es2022"|from"../../../../stable/react@18.3.1/es2022/react.mjs"|g' \
  -e 's|from"/react-dom@>=16.8.0?target=es2022"|from"../../../../v135/react-dom@18.3.1/es2022/react-dom.mjs"|g' \
  -e 's|from"/@dnd-kit/utilities@\^3.2.2?target=es2022"|from"../../utilities@3.2.2/es2022/utilities.mjs"|g' \
  -e 's|from"/@dnd-kit/accessibility@\^3.1.1?target=es2022"|from"../../accessibility@3.1.1/es2022/accessibility.mjs"|g' \
  "$BASE_DIR/core@6.3.1/es2022/core.mjs"

# Patch sortable.mjs
sed -i '' \
  -e 's|from"/react@>=16.8.0?target=es2022"|from"../../../../stable/react@18.3.1/es2022/react.mjs"|g' \
  -e 's|from"/@dnd-kit/core@\^6.3.0?target=es2022"|from"../../core@6.3.1/es2022/core.mjs"|g' \
  -e 's|from"/@dnd-kit/utilities@\^3.2.2?target=es2022"|from"../../utilities@3.2.2/es2022/utilities.mjs"|g' \
  "$BASE_DIR/sortable@10.0.0/es2022/sortable.mjs"

# Patch utilities.mjs
sed -i '' \
  -e 's|from"/react@>=16.8.0?target=es2022"|from"../../../../stable/react@18.3.1/es2022/react.mjs"|g' \
  "$BASE_DIR/utilities@3.2.2/es2022/utilities.mjs"

# Patch accessibility.mjs
sed -i '' \
  -e 's|from"/react@>=16.8.0?target=es2022"|from"../../../../stable/react@18.3.1/es2022/react.mjs"|g' \
  "$BASE_DIR/accessibility@3.1.1/es2022/accessibility.mjs"

echo "Patched dnd-kit imports"
```

## Usage in Positron Notebooks

### Example: Sortable Notebook Cells

```tsx
// src/vs/workbench/contrib/positronNotebook/browser/notebookCells/SortableNotebookCells.tsx

import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IPositronNotebookCell } from '../PositronNotebookCells';

interface SortableCellProps {
  cell: IPositronNotebookCell;
  children: React.ReactNode;
}

function SortableCell({ cell, children }: SortableCellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cell.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* Drag handle - only this triggers drag */}
      <div className="cell-drag-handle" {...listeners}>
        ⋮⋮
      </div>
      {children}
    </div>
  );
}

interface SortableNotebookCellsProps {
  cells: IPositronNotebookCell[];
  onReorder: (oldIndex: number, newIndex: number) => void;
  renderCell: (cell: IPositronNotebookCell) => React.ReactNode;
}

export function SortableNotebookCells({
  cells,
  onReorder,
  renderCell,
}: SortableNotebookCellsProps) {
  const [activeCell, setActiveCell] = React.useState<IPositronNotebookCell | null>(null);

  // Require 10px movement before drag starts (prevents accidental drags)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const cell = cells.find(c => c.id === event.active.id);
    setActiveCell(cell ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCell(null);

    if (over && active.id !== over.id) {
      const oldIndex = cells.findIndex(c => c.id === active.id);
      const newIndex = cells.findIndex(c => c.id === over.id);
      onReorder(oldIndex, newIndex);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={cells.map(c => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {cells.map(cell => (
          <SortableCell key={cell.id} cell={cell}>
            {renderCell(cell)}
          </SortableCell>
        ))}
      </SortableContext>

      {/* Custom drag preview - rendered in a portal */}
      <DragOverlay>
        {activeCell ? (
          <div className="cell-drag-preview">
            {renderCell(activeCell)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
```

### Integration with PositronNotebookInstance

```tsx
// In PositronNotebookComponent.tsx

import { SortableNotebookCells } from './SortableNotebookCells';
import { arrayMove } from '@dnd-kit/sortable';

function PositronNotebookComponent() {
  const notebookInstance = useNotebookInstance();
  const cells = useObservedValue(notebookInstance.cells);

  const handleReorder = (oldIndex: number, newIndex: number) => {
    // This calls the existing moveCells infrastructure
    notebookInstance.moveCellToIndex(cells[oldIndex], newIndex);
  };

  return (
    <div className="positron-notebook">
      <SortableNotebookCells
        cells={cells}
        onReorder={handleReorder}
        renderCell={(cell) => (
          cell.cellKind === CellKind.Code
            ? <NotebookCodeCell cell={cell} />
            : <NotebookMarkdownCell cell={cell} />
        )}
      />
    </div>
  );
}
```

## CSS for Drag States

```css
/* src/vs/workbench/contrib/positronNotebook/browser/notebookCells/sortableCells.css */

.cell-drag-handle {
  cursor: grab;
  padding: 4px 8px;
  color: var(--vscode-foreground);
  opacity: 0.5;
  user-select: none;
}

.cell-drag-handle:hover {
  opacity: 1;
}

.cell-drag-handle:active {
  cursor: grabbing;
}

/* Preview shown during drag */
.cell-drag-preview {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  background: var(--vscode-editor-background);
  opacity: 0.95;
}

/* Cell being dragged (in original position) */
[data-dragging="true"] {
  opacity: 0.5;
}
```

## Build Filter Updates

### `build/filters.js`

Add to the existing exclusions (around line 168):

```javascript
'!src/esm-package-dependencies/dnd-kit-core.js',
'!src/esm-package-dependencies/dnd-kit-sortable.js',
```

## Total Bundle Sizes

| Package | Size |
|---------|------|
| @dnd-kit/core | ~40 KB |
| @dnd-kit/sortable | ~8 KB |
| @dnd-kit/utilities | ~4 KB |
| @dnd-kit/accessibility | ~1 KB |
| **Total** | **~53 KB** |

For comparison:
- react.mjs: 9.4 KB
- react-window.mjs: 24 KB

## Summary

This approach:
1. **Follows existing patterns** - Same structure as react, react-window
2. **No npm dependency** - Bundles are checked into the repo
3. **Easy to update** - Re-run fetch script, re-apply patches
4. **Full debugging** - Source maps included
5. **Small footprint** - ~53 KB total, similar to react-window

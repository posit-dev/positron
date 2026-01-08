# Fix Deletion Sentinel - Restore Button Implementation Plan

## Overview

The "Undo" button on the deletion sentinel (visual feedback for deleted notebook cells) currently behaves the same as the dismiss button - it removes the sentinel but doesn't actually restore the deleted cell. This is because the undo command may not succeed if there's nothing to undo, but the sentinel is removed regardless.

**Key Insight**: The VS Code undo/redo service only supports undoing the most recent operation (`undo(resource)`), not targeting specific elements. This means if the user deletes multiple cells or performs other operations after deletion, clicking "undo" on a specific sentinel won't restore that particular cell.

## Solution: "Restore" Instead of "Undo"

We will change the approach from "undo" to "restore":
- Store the complete cell data (content, type, language, metadata) when creating the sentinel
- **Note**: Outputs are intentionally omitted in the initial implementation to avoid memory concerns with large outputs. The design allows easy addition of output restoration later.
- The button directly re-inserts the cell at a smart position, bypassing the undo stack
- This allows users to selectively restore any deleted cell, regardless of what other operations have occurred

### Benefits:
- **Predictable**: Click restore on cell 3's sentinel → cell 3 is restored
- **Selective**: Users can choose which cells to restore when multiple are deleted
- **Independent**: Works regardless of undo stack state

### Trade-offs:
- Restoration creates a new cell (new handle), not technically "undoing"
- If user presses Ctrl+Z after restore, it undoes the restoration (expected behavior)
- The original deletion remains in the undo stack

## Current State Analysis

When the AI assistant deletes a cell, it creates a deletion sentinel that shows:
- A preview of the deleted cell content
- An "Undo" button that should restore the cell
- A "Dismiss" button that removes the sentinel

### Key Files:
- `src/vs/workbench/contrib/positronNotebook/browser/IPositronNotebookInstance.ts` - IDeletionSentinel interface
- `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts` - addDeletionSentinel, removeDeletionSentinel
- `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeletionSentinel.tsx` - React component
- `src/vs/workbench/api/browser/positron/mainThreadNotebookFeatures.ts` - $deleteCell API

### Existing Patterns:
- `cellToCellDto2()` in `cellClipboardUtils.ts` - converts cell to serializable format
- `pasteCells()` in `PositronNotebookInstance.ts` - inserts cells using `textModel.applyEdits`

### Current Gap in cellToCellDto2:
The existing `cellToCellDto2()` function does NOT capture important metadata:
```typescript
// Current implementation loses:
mime: undefined,           // Should be: cellModel.mime
metadata: {},              // Should be: cellModel.metadata (cell tags, custom properties)
internalMetadata: {},      // Should be: cellModel.internalMetadata (execution order, timing, success)
collapseState: undefined   // Should be: cellModel.collapseState (UI collapse state)
```

This needs to be fixed for proper cell restoration (see Phase 1).

## Desired End State

After implementation:
1. The "Restore" button restores the specific deleted cell it represents
2. Multiple sentinels can be restored in any order
3. The sentinel is removed after successful restoration
4. Global undo (Ctrl+Z) that happens to restore a deleted cell also cleans up the corresponding sentinel

### Success Verification:
- Delete a cell via AI assistant → sentinel appears
- Click "Restore" button on sentinel → cell is restored at original position and sentinel disappears
- Delete cells 3, 5, and 7 → click restore on cell 5's sentinel → only cell 5 is restored
- Delete a cell, perform other operations, click "Restore" → cell is still restored correctly
- Delete a cell, use global Ctrl+Z → cell is restored AND sentinel is automatically removed

## What We're NOT Doing

- Not changing the visual design of deletion sentinels (beyond button label)
- Not modifying the timeout behavior
- Not changing how AI assistant triggers deletions
- Not implementing a custom undo stack

---

## Phase 1: Store Full Cell Data with Sentinel

### Overview
Update the sentinel interface and creation to store complete cell data for restoration. This includes:
1. Creating a new `cellToCellDtoForRestore()` function that captures all metadata (but omits outputs for now)
2. Updating the sentinel interface to store this data
3. Adding the restore functionality

### Design Decision: Outputs Omitted Initially
Outputs are intentionally omitted to avoid memory concerns with large outputs (images, plots, DataFrames). The design allows easy addition later by:
- Changing `outputs: []` to `outputs: cellModel.outputs.map(...)` in the capture function
- No other changes needed - the ICellDto2 structure already supports outputs
- Make sure to add a comment in the code explaining this decision for future maintainers.

### Changes Required:

#### 1. Refactor cellToCellDto2 with Base Function
**File**: `src/vs/workbench/contrib/positronNotebook/browser/cellClipboardUtils.ts`
**Changes**: Refactor existing function into a base function with options, then expose two specialized functions for clipboard and restore use cases.

```typescript
/**
 * Options for controlling what cell data is preserved during conversion.
 */
interface CellDtoOptions {
	/** Include cell outputs (images, plots, etc.) - can be large */
	includeOutputs?: boolean;
	/** Include cell metadata (mime, tags, execution info, collapse state) */
	includeMetadata?: boolean;
}

/**
 * Base function for converting a Positron notebook cell to ICellDto2 format.
 * Use the specialized functions `cellToCellDto2` or `cellToCellDtoForRestore` instead.
 */
function cellToCellDtoBase(cell: IPositronNotebookCell, options: CellDtoOptions): ICellDto2 {
	const cellModel = cell.model;

	return {
		source: cell.getContent(),
		language: cellModel.language,
		mime: options.includeMetadata ? cellModel.mime : undefined,
		cellKind: cellModel.cellKind,
		outputs: options.includeOutputs
			? cellModel.outputs.map(output => ({
				outputId: output.outputId,
				outputs: output.outputs.map(item => ({
					mime: item.mime,
					data: item.data
				}))
			}))
			: [],
		metadata: options.includeMetadata ? cellModel.metadata : {},
		internalMetadata: options.includeMetadata ? cellModel.internalMetadata : {},
		collapseState: options.includeMetadata ? cellModel.collapseState : undefined
	};
}

/**
 * Converts a Positron notebook cell to ICellDto2 format for clipboard storage.
 * Preserves outputs for pasting but omits metadata.
 */
export function cellToCellDto2(cell: IPositronNotebookCell): ICellDto2 {
	return cellToCellDtoBase(cell, { includeOutputs: true, includeMetadata: false });
}

/**
 * Converts a Positron notebook cell to ICellDto2 format for restoration.
 * Preserves metadata for faithful restoration but omits outputs to save memory.
 *
 * To add output restoration later, change to: { includeOutputs: true, includeMetadata: true }
 */
export function cellToCellDtoForRestore(cell: IPositronNotebookCell): ICellDto2 {
	return cellToCellDtoBase(cell, { includeOutputs: false, includeMetadata: true });
}
```

**Why this approach?** Using a base function with options:
- Centralizes the cell-to-DTO conversion logic
- Makes it easy to adjust what's preserved for each use case
- Allows future expansion (e.g., adding output restoration by changing one flag)
- Keeps the existing `cellToCellDto2` behavior unchanged for clipboard operations

**Implementation note:** Add a file-level comment or JSDoc explaining why outputs are omitted for restore (memory concerns) and how to enable them in the future by changing the options flag.

#### 2. Update IDeletionSentinel Interface
**File**: `src/vs/workbench/contrib/positronNotebook/browser/IPositronNotebookInstance.ts`
**Changes**: Add cell data for restoration

```typescript
import { ICellDto2, CellKind } from '../../notebook/common/notebookCommon.js';

export interface IDeletionSentinel {
	/** Unique identifier for the sentinel */
	id: string;
	/** The original index where the cell was deleted */
	originalIndex: number;
	/** Timestamp when the sentinel was created */
	timestamp: number;
	/** Preview content for display (first few lines) */
	previewContent: string;
	/** The type of cell that was deleted */
	cellKind: CellKind;
	/** The language of the cell (for code cells) */
	language?: string;
	/** Complete cell data for restoration (outputs omitted to save memory) */
	cellData: ICellDto2;
}
```

#### 3. Update addDeletionSentinel Signature
**File**: `src/vs/workbench/contrib/positronNotebook/browser/IPositronNotebookInstance.ts`
**Changes**: Update method signature in interface

```typescript
/**
 * Add a deletion sentinel at the specified cell index.
 * @param cellIndex The index where the cell was deleted
 * @param cellData The complete cell data for potential restoration
 */
addDeletionSentinel(cellIndex: number, cellData: ICellDto2): void;
```

#### 4. Update addDeletionSentinel Implementation
**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`
**Changes**: Store full cell data and generate preview

```typescript
addDeletionSentinel(cellIndex: number, cellData: ICellDto2): void {
	// Generate preview content (first 3 lines)
	const lines = cellData.source.split('\n');
	const previewContent = lines.slice(0, 3).join('\n');
	const truncated = lines.length > 3;

	const sentinel: IDeletionSentinel = {
		id: `sentinel-${Date.now()}-${cellIndex}`,
		originalIndex: cellIndex,
		timestamp: Date.now(),
		previewContent: truncated ? previewContent + '\n...' : previewContent,
		cellKind: cellData.cellKind,
		language: cellData.language,
		cellData  // Store complete data for restoration
	};

	const current = this._deletionSentinels.get();
	this._deletionSentinels.set([...current, sentinel], undefined);
}
```

#### 5. Add restoreCell Method
**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`
**Changes**: Add method to restore a cell from sentinel data

```typescript
/**
 * Restores a deleted cell from its sentinel data.
 * @param sentinel The deletion sentinel containing cell data to restore
 */
restoreCell(sentinel: IDeletionSentinel): void {
	this._assertTextModel();

	const textModel = this.textModel;
	const computeUndoRedo = !this.isReadOnly || textModel.viewType === 'interactive';

	// Clamp insertion index to valid range (handles case where notebook was modified)
	const maxIndex = textModel.cells.length;
	const insertIndex = Math.min(sentinel.originalIndex, maxIndex);

	const focusRange = { start: insertIndex, end: insertIndex + 1 };

	textModel.applyEdits([
		{
			editType: CellEditType.Replace,
			index: insertIndex,
			count: 0,
			cells: [sentinel.cellData]
		}
	],
		true, // synchronous - ensures operations are serialized
		{ kind: SelectionStateType.Index, focus: focusRange, selections: [focusRange] },
		() => ({ kind: SelectionStateType.Index, focus: focusRange, selections: [focusRange] }),
		undefined,
		computeUndoRedo
	);

	this._onDidChangeContent.fire();

	// Remove the sentinel after successful restoration
	this.removeDeletionSentinel(sentinel.id);
}
```

#### 6. Update Interface to Expose restoreCell
**File**: `src/vs/workbench/contrib/positronNotebook/browser/IPositronNotebookInstance.ts`
**Changes**: Add method to interface

```typescript
/**
 * Restores a deleted cell from its sentinel data.
 * @param sentinel The deletion sentinel containing cell data to restore
 */
restoreCell(sentinel: IDeletionSentinel): void;
```

#### 7. Update AI Assistant Integration
**File**: `src/vs/workbench/api/browser/positron/mainThreadNotebookFeatures.ts`
**Changes**: Use cellToCellDtoForRestore to capture full cell data

```typescript
import { cellToCellDtoForRestore } from '../../../contrib/positronNotebook/browser/cellClipboardUtils.js';

async $deleteCell(notebookUri: string, cellIndex: number): Promise<void> {
	const instance = this._getInstanceByUri(notebookUri);
	if (!instance) {
		throw new Error(`No notebook found with URI: ${notebookUri}`);
	}

	const cells = instance.cells.get();
	if (cellIndex < 0 || cellIndex >= cells.length) {
		throw new Error(`Cell not found at index: ${cellIndex}`);
	}

	const cellToDelete = cells[cellIndex];

	// Capture complete cell data before deletion (outputs omitted for memory)
	const cellData = cellToCellDtoForRestore(cellToDelete);

	// Delete the cell
	instance.deleteCell(cellToDelete);

	// Add sentinel with complete cell data
	instance.addDeletionSentinel(cellIndex, cellData);
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `npm run compile`
- [ ] No linting errors: `npm run lint`

#### Manual Verification:
- [ ] Deletion sentinels still appear when AI assistant deletes cells
- [ ] Sentinel displays correct preview content
- [ ] No regressions in basic deletion functionality

---

## Phase 2: Update Sentinel Component to Use Restore

### Overview
Update the DeletionSentinel React component to call `restoreCell` instead of the undo command.

### Changes Required:

#### 1. Update DeletionSentinel Component
**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeletionSentinel.tsx`
**Changes**: Replace undo with restore, update button label

```typescript
const handleRestore = () => {
	// Clear auto-dismiss timeout
	if (timeoutRef.current) {
		clearTimeout(timeoutRef.current);
	}

	// Restore the cell (this also removes the sentinel)
	instance.restoreCell(sentinel);
};

// In the JSX, update the button:
<ActionButton
	ariaLabel={localize('notebook.restore', "Restore")}
	className="deletion-sentinel-restore"
	onPressed={handleRestore}
>
	{localize('notebook.restore', "Restore")}
</ActionButton>
```

#### 2. Update CSS Class (if needed)
**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeletionSentinel.css`
**Changes**: Rename `.deletion-sentinel-undo` to `.deletion-sentinel-restore` (or keep both for compatibility)

#### 3. Update Sentinel Display to Use previewContent
**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeletionSentinel.tsx`
**Changes**: Use `sentinel.previewContent` instead of `sentinel.cellContent`

```typescript
<pre className="deletion-sentinel-code-text">
	{sentinel.previewContent}
</pre>
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `npm run compile`
- [ ] Component renders without errors

#### Manual Verification:
- [ ] Button displays "Restore" label
- [ ] Clicking "Restore" restores the cell at the correct position
- [ ] Sentinel is removed after restore
- [ ] Multiple sentinels can be restored in any order
- [ ] Restore works correctly even after other operations

---

## Phase 3: Auto-cleanup Sentinels on Global Undo

### Overview
When the user performs a global undo (Ctrl+Z) that happens to restore a deleted cell, automatically clean up the corresponding sentinel.

### Changes Required:

#### 1. Track Cell Restoration in _syncCells
**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`
**Changes**: Detect restored cells and clean up matching sentinels by comparing content

```typescript
private _syncCells() {
	this._assertTextModel();
	const modelCells = this.textModel.cells;

	// ... existing cell mapping logic ...

	const currentOp = this.getAndResetCurrentOperation();

	// Check for sentinel cleanup when cells are added during undo
	if (currentOp === NotebookOperationType.Undo) {
		this._cleanupSentinelsForRestoredCells(newlyAddedCells);
	}

	// ... rest of existing logic ...
}

/**
 * Cleans up sentinels for cells that have been restored via undo.
 * Matches by comparing cell content since handles change on restoration.
 */
private _cleanupSentinelsForRestoredCells(restoredCells: IPositronNotebookCell[]): void {
	if (restoredCells.length === 0) {
		return;
	}

	const sentinels = this._deletionSentinels.get();
	if (sentinels.length === 0) {
		return;
	}

	// Build a set of restored cell contents for quick lookup
	const restoredContents = new Set(restoredCells.map(cell => cell.getContent()));

	// Remove sentinels whose cell content matches a restored cell
	const remainingSentinels = sentinels.filter(sentinel => {
		return !restoredContents.has(sentinel.cellData.source);
	});

	if (remainingSentinels.length < sentinels.length) {
		this._deletionSentinels.set(remainingSentinels, undefined);
	}
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `npm run compile`
- [ ] Existing notebook tests still pass

#### Manual Verification:
- [ ] Delete cell via AI, use Ctrl+Z → cell restored AND sentinel removed
- [ ] Delete multiple cells, undo all → all sentinels cleaned up
- [ ] Non-deletion undos don't affect sentinels
- [ ] Sentinel cleanup doesn't interfere with other undo operations

---

## Testing Strategy

### Manual Testing Steps:
1. Open a notebook with multiple cells
2. Use AI assistant to delete a cell in the middle
3. Verify sentinel appears with correct preview
4. Click "Restore" button → verify cell restored and sentinel removed
5. Delete cells 3, 5, and 7 → verify 3 sentinels appear
6. Click restore on cell 5's sentinel → verify only cell 5 is restored
7. Verify sentinels for cells 3 and 7 are still present
8. Delete a cell, use Ctrl+Z → verify automatic sentinel cleanup
9. Delete a cell, perform other edits, click restore → verify cell still restores correctly

## Performance Considerations

- **Outputs omitted**: Cell data capture intentionally omits outputs to avoid memory issues with large outputs (images, plots, DataFrames). Design allows easy addition later.
- **Lightweight metadata**: The metadata we capture (internalMetadata, metadata, collapseState) is typically ~200-500 bytes per cell, negligible overhead.
- Sentinel cleanup during _syncCells is O(n*m) where n=sentinels, m=restored cells (acceptable given small n,m)
- Auto-dismiss timeout (default 10 seconds) limits how long sentinels consume memory

## Edge Cases and Known Limitations

### Handled Edge Cases:
1. **Invalid insertion index**: If notebook is modified and original index is invalid, we clamp to the valid range (cell inserted at end if original position no longer exists)
2. **Race conditions between restores**: `applyEdits` with `synchronous: true` ensures operations are serialized
3. **Cell identity**: Restored cells get new handles/URIs (this is by design, same as paste behavior)

### Known Limitations:
1. **Outputs not restored**: Restored cells have empty outputs. User can re-execute to regenerate.
2. **Content-based sentinel cleanup**: Global undo cleanup matches by cell content, which could have edge cases with duplicate cell content.
3. **No sentinel recreation on restoration undo**: If user restores a cell then presses Ctrl+Z, the sentinel doesn't reappear.

### Future Improvements (if needed):
- Add output restoration with configurable size limits
- Improve sentinel cleanup to use timestamp correlation in addition to content matching

## Migration Notes

This change is backward compatible:
- The sentinel interface is extended, not changed incompatibly
- Existing behavior (dismiss button, auto-timeout) remains unchanged
- The "Undo" button becomes "Restore" with clearer semantics

## References

- Original issue: User report of undo button not working
- Related code: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeletionSentinel.tsx`
- Cell clipboard utils: `src/vs/workbench/contrib/positronNotebook/browser/cellClipboardUtils.ts`
- AI integration: `src/vs/workbench/api/browser/positron/mainThreadNotebookFeatures.ts`

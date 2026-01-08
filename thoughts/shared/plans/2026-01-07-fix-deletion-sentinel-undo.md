# Fix Deletion Sentinel Undo Button Implementation Plan

## Overview

The undo button on the deletion sentinel (visual feedback for deleted notebook cells) currently behaves the same as the dismiss button - it removes the sentinel but doesn't actually restore the deleted cell. This is because the undo command may not succeed if there's nothing to undo, but the sentinel is removed regardless.

## Current State Analysis

When the AI assistant deletes a cell, it creates a deletion sentinel that shows:
- A preview of the deleted cell content
- An "Undo" button that should restore the cell
- A "Dismiss" button that removes the sentinel

### Key Discoveries:
- The undo button executes the 'undo' command but doesn't verify success (`DeletionSentinel.tsx:60`)
- The sentinel is removed immediately after the command, regardless of outcome (`DeletionSentinel.tsx:63`)
- There's no automatic cleanup of sentinels when cells are restored through global undo
- The undo stack may be empty or may contain unrelated operations

### Root Cause:
The deletion sentinel is created AFTER the cell deletion is complete, which means:
1. The undo stack already has the deletion operation when the sentinel is created
2. BUT if the user performs other operations after deletion, those go on the undo stack
3. When clicking the sentinel's undo button, it undoes the LAST operation, not necessarily the deletion

## Desired End State

After implementation:
1. The undo button should only restore the specific deleted cell it represents
2. The sentinel should only be removed if the cell was successfully restored
3. The fix should handle cases where the undo stack has changed since deletion
4. Global undo operations should also clean up relevant sentinels

### Success Verification:
- Delete a cell via AI assistant → sentinel appears
- Click undo button on sentinel → cell is restored and sentinel disappears
- Delete a cell, perform other operations, click undo on sentinel → cell is restored (not the other operations)
- Delete a cell, use global Ctrl+Z → cell is restored AND sentinel is automatically removed

## What We're NOT Doing

- Not changing the visual design of deletion sentinels
- Not modifying the timeout behavior
- Not changing how AI assistant triggers deletions
- Not implementing a custom undo stack

## Implementation Approach

We need to make the deletion sentinel's undo operation more intelligent by:
1. Storing the actual undo element reference when creating the sentinel
2. Using that specific element for targeted undo
3. Verifying restoration success before removing the sentinel
4. Automatically cleaning up sentinels when cells are restored via any undo path

## Phase 1: Store Undo Element with Sentinel

### Overview
Capture and store the undo element created by the deletion operation so we can undo it specifically.

### Changes Required:

#### 1. Update IDeletionSentinel Interface
**File**: `src/vs/workbench/contrib/positronNotebook/browser/IPositronNotebookInstance.ts`
**Changes**: Add undo element reference to the interface

```typescript
export interface IDeletionSentinel {
	id: string;
	originalIndex: number;
	timestamp: number;
	cellContent: string;
	cellKind: CellKind;
	language?: string;
	undoElement?: IUndoRedoElement; // Add this line
}
```

#### 2. Capture Undo Element During Deletion
**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`
**Changes**: Store the last undo element after deletion

```typescript
// In the deleteCell method, after the deleteCells call:
deleteCell(cellToDelete?: IPositronNotebookCell): IUndoRedoElement | undefined {
	const cell = cellToDelete ?? getActiveCell(this.selectionStateMachine.state.get());

	if (!cell) {
		return undefined;
	}

	// Get the undo stack before deletion
	const undoElements = this.undoRedoService.getElements(this.uri);
	const pastStackHeight = undoElements.past.length;

	this.deleteCells([cell]);

	// Get the new undo element created by the deletion
	const newUndoElements = this.undoRedoService.getElements(this.uri);
	if (newUndoElements.past.length > pastStackHeight) {
		return newUndoElements.past[newUndoElements.past.length - 1];
	}

	return undefined;
}
```

#### 3. Pass Undo Element to Sentinel
**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`
**Changes**: Update addDeletionSentinel to accept undo element

```typescript
addDeletionSentinel(originalIndex: number, cellContent: string, cellKind: CellKind, language?: string, undoElement?: IUndoRedoElement): void {
	// Truncate content to first 3 lines for preview
	const lines = cellContent.split('\n');
	const truncatedContent = lines.slice(0, 3).join('\n');

	const sentinel: IDeletionSentinel = {
		id: `sentinel-${Date.now()}-${originalIndex}`,
		originalIndex,
		timestamp: Date.now(),
		cellContent: truncatedContent,
		cellKind,
		language,
		undoElement // Store the undo element
	};

	const current = this._deletionSentinels.get();
	this._deletionSentinels.set([...current, sentinel], undefined);
}
```

#### 4. Update AI Assistant Integration
**File**: `src/vs/workbench/api/browser/positron/mainThreadNotebookFeatures.ts`
**Changes**: Capture and pass undo element

```typescript
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

	// Capture cell content before deletion
	const cellContent = cellToDelete.getContent();
	const cellKind = cellToDelete.kind;
	const language = cellToDelete.isCodeCell() ? cellToDelete.model.language : undefined;

	// Delete the cell and capture the undo element
	const undoElement = instance.deleteCell(cellToDelete);

	// Add sentinel with cell content and undo element
	instance.addDeletionSentinel(cellIndex, cellContent, cellKind, language, undoElement);
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `npm run compile`
- [ ] No linting errors: `npm run lint`
- [ ] Unit tests pass: `npm test`

#### Manual Verification:
- [ ] Deletion sentinels still appear when AI assistant deletes cells
- [ ] Sentinel data structure contains undo element reference
- [ ] No regressions in basic deletion functionality

---

## Phase 2: Implement Targeted Undo in Sentinel

### Overview
Update the deletion sentinel component to use the stored undo element for targeted restoration.

### Changes Required:

#### 1. Update DeletionSentinel Component
**File**: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeletionSentinel.tsx`
**Changes**: Implement targeted undo with verification

```typescript
const handleUndo = async () => {
	// Clear timeout
	if (timeoutRef.current) {
		clearTimeout(timeoutRef.current);
	}

	try {
		// Check if we have a specific undo element for this deletion
		if (sentinel.undoElement) {
			// Get the undo/redo service
			const undoRedoService = commandService._getService(IUndoRedoService);

			// Check if the element is still in the undo stack
			const elements = undoRedoService.getElements(instance.uri);
			const elementInStack = elements.past.includes(sentinel.undoElement);

			if (elementInStack) {
				// Undo this specific element
				await undoRedoService.undoTo(instance.uri, sentinel.undoElement);
				// Remove sentinel after successful undo
				instance.removeDeletionSentinel(sentinel.id);
				return;
			}
		}

		// Fallback: Try general undo if no specific element or not in stack
		// This handles the case where user may have already partially undone
		const cellsBefore = instance.cells.get().length;
		await commandService.executeCommand('undo');
		const cellsAfter = instance.cells.get().length;

		// Only remove sentinel if a cell was actually restored
		if (cellsAfter > cellsBefore) {
			instance.removeDeletionSentinel(sentinel.id);
		} else {
			// Show a message that undo is not available
			console.warn('Unable to undo cell deletion - operation may have already been undone');
		}
	} catch (error) {
		console.error('Failed to undo cell deletion:', error);
	}
};
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `npm run compile`
- [ ] Component renders without errors

#### Manual Verification:
- [ ] Clicking undo on sentinel restores the specific deleted cell
- [ ] Sentinel is only removed if restoration succeeds
- [ ] Works correctly even after other operations are performed
- [ ] Fallback behavior works when undo element is not available

---

## Phase 3: Auto-cleanup Sentinels on Global Undo

### Overview
Automatically remove deletion sentinels when cells are restored through any undo path (Ctrl+Z, menu, etc.).

### Changes Required:

#### 1. Track Cell Restoration in _syncCells
**File**: `src/vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance.ts`
**Changes**: Detect restored cells and clean up sentinels

```typescript
private _syncCells(): void {
	this._assertTextModel();

	const textModel = this.textModel;
	const modelCells = textModel.cells;

	// Create map of existing cells before sync
	const existingCellsMap = new Map<number, IPositronNotebookCell>();
	for (const cell of this.cells.get()) {
		existingCellsMap.set(cell.model.handle, cell);
	}

	// Track indices of newly appearing cells
	const restoredIndices: number[] = [];

	// Build the new cells array
	const newCells: IPositronNotebookCell[] = [];
	modelCells.forEach((modelCell, index) => {
		let cell = existingCellsMap.get(modelCell.handle);
		if (cell) {
			cell.setIndex(index);
			existingCellsMap.delete(modelCell.handle);
		} else {
			cell = this.cellAt(index);
			// This is a newly appearing cell (could be from undo)
			restoredIndices.push(index);
		}
		newCells.push(cell);
	});

	// Get the current operation type
	const currentOp = this.getAndResetCurrentOperation();

	// Clean up sentinels for restored cells during undo
	if (currentOp === NotebookOperationType.Undo && restoredIndices.length > 0) {
		const sentinels = this._deletionSentinels.get();
		const remainingSentinels = sentinels.filter(sentinel => {
			// Remove sentinels whose original index matches restored cells
			return !restoredIndices.includes(sentinel.originalIndex);
		});

		if (remainingSentinels.length < sentinels.length) {
			this._deletionSentinels.set(remainingSentinels, undefined);
		}
	}

	// Rest of the existing _syncCells logic...
	// [existing code continues]
}
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compilation passes: `npm run compile`
- [ ] Existing notebook tests still pass: `npm run test`

#### Manual Verification:
- [ ] Delete cell via AI, use Ctrl+Z → cell restored AND sentinel removed
- [ ] Delete multiple cells, undo all → all sentinels cleaned up
- [ ] Non-deletion undos don't affect sentinels
- [ ] Sentinel cleanup doesn't interfere with other undo operations

---

## Phase 4: Add E2E Tests

### Overview
Add comprehensive end-to-end tests to verify the fix works correctly.

### Changes Required:

#### 1. Add Deletion Sentinel Undo Test
**File**: `test/e2e/tests/notebooks-positron/notebook-deletion-sentinel.test.ts` (new file)
**Changes**: Create comprehensive test suite

```typescript
import { test, expect } from '@playwright/test';
import { Application } from '../../application';

test.describe('Notebook Deletion Sentinels', () => {
	let app: Application;

	test.beforeEach(async ({ page }) => {
		app = new Application(page);
		await app.notebook.createNewNotebook();
	});

	test('undo button on sentinel restores deleted cell', async () => {
		// Add a cell with content
		await app.notebook.addCodeCell();
		await app.notebook.typeInCell(0, 'print("test cell")');

		// Delete via AI assistant (simulate)
		await app.notebook.deleteCell(0, { viaAssistant: true });

		// Verify sentinel appears
		const sentinel = await app.page.locator('.deletion-sentinel');
		await expect(sentinel).toBeVisible();

		// Click undo on sentinel
		await sentinel.locator('.deletion-sentinel-undo').click();

		// Verify cell is restored
		const cellContent = await app.notebook.getCellContent(0);
		expect(cellContent).toBe('print("test cell")');

		// Verify sentinel is removed
		await expect(sentinel).not.toBeVisible();
	});

	test('global undo removes sentinel automatically', async () => {
		// Add and delete a cell
		await app.notebook.addCodeCell();
		await app.notebook.typeInCell(0, 'print("test")');
		await app.notebook.deleteCell(0, { viaAssistant: true });

		// Verify sentinel appears
		const sentinel = await app.page.locator('.deletion-sentinel');
		await expect(sentinel).toBeVisible();

		// Use global undo
		await app.page.keyboard.press('ControlOrMeta+z');

		// Verify cell is restored and sentinel removed
		const cellContent = await app.notebook.getCellContent(0);
		expect(cellContent).toBe('print("test")');
		await expect(sentinel).not.toBeVisible();
	});

	test('undo after other operations still works', async () => {
		// Setup: Create two cells
		await app.notebook.addCodeCell();
		await app.notebook.typeInCell(0, 'cell 1');
		await app.notebook.addCodeCell();
		await app.notebook.typeInCell(1, 'cell 2');

		// Delete first cell via assistant
		await app.notebook.deleteCell(0, { viaAssistant: true });

		// Perform another operation (edit remaining cell)
		await app.notebook.typeInCell(0, ' edited');

		// Click undo on sentinel (should restore deleted cell, not undo edit)
		const sentinel = await app.page.locator('.deletion-sentinel');
		await sentinel.locator('.deletion-sentinel-undo').click();

		// Verify: First cell restored, second cell still edited
		expect(await app.notebook.getCellContent(0)).toBe('cell 1');
		expect(await app.notebook.getCellContent(1)).toBe('cell 2 edited');

		// Sentinel should be gone
		await expect(sentinel).not.toBeVisible();
	});
});
```

### Success Criteria:

#### Automated Verification:
- [ ] All new tests pass: `npx playwright test notebook-deletion-sentinel.test.ts`
- [ ] No regressions in existing tests: `npx playwright test notebooks-positron/`
- [ ] Tests cover all edge cases

#### Manual Verification:
- [ ] Tests accurately reflect user experience
- [ ] Test failures provide clear diagnostic information

---

## Testing Strategy

### Unit Tests:
- Test sentinel creation with undo element
- Test undo element retrieval from undo service
- Test sentinel cleanup logic in _syncCells

### Integration Tests:
- Test full flow from AI deletion to undo restoration
- Test interaction between multiple sentinels
- Test timeout vs manual dismissal vs undo

### Manual Testing Steps:
1. Open a notebook with multiple cells
2. Use AI assistant to delete a cell in the middle
3. Verify sentinel appears with correct preview
4. Click undo button → verify cell restored and sentinel removed
5. Delete another cell, edit a different cell, then click undo on sentinel
6. Verify only the deleted cell is restored
7. Delete a cell, use Ctrl+Z → verify automatic sentinel cleanup
8. Delete multiple cells → verify multiple sentinels work correctly

## Performance Considerations

- Storing undo element references has minimal memory impact
- Sentinel cleanup during _syncCells is O(n) where n is number of sentinels
- No performance regression expected for normal notebook operations

## Migration Notes

No migration needed - the change is backward compatible. Existing sentinels without undo elements will use the fallback behavior.

## References

- Original issue: User report of undo button not working
- Related code: `src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeletionSentinel.tsx`
- Undo/redo system: `src/vs/workbench/contrib/positronNotebook/browser/contrib/undoRedo/positronNotebookUndoRedo.ts`
- AI integration: `src/vs/workbench/api/browser/positron/mainThreadNotebookFeatures.ts`
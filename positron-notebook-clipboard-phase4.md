# Phase 4: Testing and Validation

## Objective
Ensure the clipboard functionality is robust, reliable, and provides a seamless user experience through focused testing of untested areas.

## Testing Strategy

Focus on areas not covered by existing comprehensive E2E tests in `cell-deletion-focus.test.ts`.

## Unit Tests

### Cell Clipboard Utilities

**File**: `src/vs/workbench/contrib/positronNotebook/test/browser/cellClipboardUtils.test.ts`

**Purpose**: Test complex data transformations and cross-application compatibility not covered by E2E tests.

```typescript
import { assert } from 'chai';
import { CellKind } from '../../../notebook/common/notebookCommon';
import { 
    cellToCellDto2, 
    serializeCellsToClipboard, 
    deserializeCellsFromClipboard 
} from '../../browser/cellClipboardUtils';
import { IPositronNotebookCell } from '../../../services/positronNotebook/browser/IPositronNotebookCell';

suite('Cell Clipboard Utilities', () => {
    
    test('should convert cell to ICellDto2 format', () => {
        // Create a mock Positron notebook cell
        const originalCell: IPositronNotebookCell = createMockPositronCell({
            content: 'print("Hello World")',
            kind: CellKind.Code,
            outputs: [{ outputType: 'stream', text: 'Hello World' }]
        });
        
        // Convert to ICellDto2 format
        const cellDto = cellToCellDto2(originalCell);
        
        // Verify properties are preserved
        assert.equal(cellDto.source, 'print("Hello World")');
        assert.equal(cellDto.cellKind, CellKind.Code);
        assert.equal(cellDto.language, originalCell.cellModel.language);
        
        // Verify outputs are properly converted
        assert.equal(cellDto.outputs.length, 1);
    });
    
    test('should serialize cells to clipboard format', () => {
        const cells: IPositronNotebookCell[] = [
            createMockPositronCell({ content: 'code1', kind: CellKind.Code }),
            createMockPositronCell({ content: '# Markdown', kind: CellKind.Markup })
        ];
        
        const serialized = serializeCellsToClipboard(cells);
        const parsed = JSON.parse(serialized);
        
        assert.equal(parsed.cells.length, 2);
        assert.equal(parsed.cells[0].cell_type, 'code');
        assert.equal(parsed.cells[1].cell_type, 'markdown');
    });
    
    test('should deserialize Jupyter format clipboard data', () => {
        const jupyterData = JSON.stringify({
            cells: [
                {
                    cell_type: 'code',
                    source: ['print("external")\n'],
                    metadata: {},
                    outputs: []
                }
            ]
        });
        
        const cells = deserializeCellsFromClipboard(jupyterData);
        
        assert.isNotNull(cells);
        assert.equal(cells!.length, 1);
        assert.equal(cells![0].source, 'print("external")\n');
    });
    
    test('should handle malformed clipboard data gracefully', () => {
        assert.isNull(deserializeCellsFromClipboard('invalid json'));
        assert.isNull(deserializeCellsFromClipboard('{"not": "notebook format"}'));
    });
    
    test('should preserve output mime types in conversion', () => {
        const cell: IPositronNotebookCell = createMockPositronCell({
            outputs: [
                { outputType: 'display_data', data: { 'image/png': 'base64data', 'text/plain': 'alt' } }
            ]
        });
        
        const cellDto = cellToCellDto2(cell);
        
        assert.equal(cellDto.outputs[0].outputs.length, 2);
        const mimes = cellDto.outputs[0].outputs.map(o => o.mime);
        assert.include(mimes, 'image/png');
        assert.include(mimes, 'text/plain');
    });
});
```

## E2E Tests

### Extend Existing Test

**File**: `test/e2e/tests/notebook/cell-deletion-focus.test.ts`

Add copy scenario to existing comprehensive test that already covers cut operations.

```typescript
// Add to existing test suite in cell-deletion-focus.test.ts
test('copy and paste with keyboard shortcuts', async function ({ app }) {
    await app.workbench.notebooks.createNewNotebook();
    await app.workbench.notebooksPositron.expectToBeVisible();
    
    // Create test cells using existing helper pattern
    await app.workbench.notebooksPositron.addCodeToCellAtIndex('print("Hello World")', 0);
    await app.workbench.notebooksPositron.addCodeToCellAtIndex('# Empty cell', 1);
    
    // Select first cell using existing pattern
    await app.workbench.notebooksPositron.selectCellAtIndex(0);
    
    // Copy with keyboard shortcut (similar to cutCellsWithKeyboard)
    await app.code.driver.page.keyboard.press('Escape');
    const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await app.code.driver.page.keyboard.press(`${modifierKey}+KeyC`);
    
    // Select target cell and paste
    await app.workbench.notebooksPositron.selectCellAtIndex(1);
    await app.code.driver.page.keyboard.press(`${modifierKey}+KeyV`);
    
    // Verify using existing helper functions
    expect(await getCellCount(app)).toBe(3); // Original + pasted
    expect(await getCellContent(app, 2)).toBe('print("Hello World")');
});
});
```

## Manual Testing Checklist

### Basic Operations
- [ ] Copy single cell with Ctrl/Cmd+C
- [ ] Copy multiple selected cells
- [ ] Cut single cell with Ctrl/Cmd+X
- [ ] Cut multiple selected cells
- [ ] Paste with Ctrl/Cmd+V
- [ ] Paste above with Ctrl/Cmd+Shift+V

### Context Menu
- [ ] Right-click shows context menu
- [ ] Copy option works from menu
- [ ] Cut option works from menu
- [ ] Paste options work from menu
- [ ] Menu items correctly enabled/disabled

### Edge Cases
- [ ] Copy/paste empty cell
- [ ] Copy/paste cell with large output
- [ ] Copy/paste between different notebook types
- [ ] Operations with no selection
- [ ] Operations in read-only notebook

### Cell Types
- [ ] Copy/paste code cells
- [ ] Copy/paste markdown cells
- [ ] Copy/paste cells with outputs
- [ ] Copy/paste cells with errors

### Platform Testing
- [ ] Windows: All shortcuts work
- [ ] macOS: Cmd key variants work
- [ ] Linux: All shortcuts work

## Performance Testing

### Load Testing Script

```typescript
async function performanceTest() {
    const notebook = await createLargeNotebook(1000); // 1000 cells
    
    console.time('Copy 100 cells');
    await notebook.selectCells(0, 100);
    await notebook.copyCells();
    console.timeEnd('Copy 100 cells');
    
    console.time('Paste 100 cells');
    await notebook.pasteCells();
    console.timeEnd('Paste 100 cells');
    
    // Verify memory usage
    const memoryBefore = process.memoryUsage().heapUsed;
    
    // Perform multiple operations
    for (let i = 0; i < 10; i++) {
        await notebook.copyCells();
        await notebook.pasteCells();
    }
    
    const memoryAfter = process.memoryUsage().heapUsed;
    const memoryIncrease = (memoryAfter - memoryBefore) / 1024 / 1024;
    
    console.log(`Memory increase: ${memoryIncrease.toFixed(2)} MB`);
    assert.isBelow(memoryIncrease, 100, 'Memory leak detected');
}
```

## Key Testing Focus Areas

1. **Text Model Registration**: Ensure pasted cells use ICellDto2 format and go through proper cell creation pipeline
2. **Cross-Application Compatibility**: Test clipboard data from external notebook applications  
3. **Edge Case Handling**: Invalid clipboard data, malformed JSON, empty cells
4. **Output Preservation**: Complex cell outputs with multiple mime types

## Success Criteria

- [ ] Unit tests for clipboard utilities pass
- [ ] E2E copy test added to existing test suite
- [ ] Manual testing checklist complete  
- [ ] No memory leaks detected
- [ ] Cross-application clipboard compatibility verified

### Performance Benchmarks
- Copy operation: < 100ms for 10 cells
- Paste operation: < 200ms for 10 cells  
- Memory usage: < 10MB increase for 100 operations

## Implementation Notes

**Key Learning**: Clipboard storage uses `ICellDto2[]` format instead of `NotebookCellTextModel[]` to avoid text model registration issues. Pasted cells go through the proper `_syncCells()` mechanism.

**Testing Approach**: Build on existing comprehensive E2E test infrastructure in `cell-deletion-focus.test.ts` rather than creating redundant test files.
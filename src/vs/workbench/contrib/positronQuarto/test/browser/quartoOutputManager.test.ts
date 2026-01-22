/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';

suite('QuartoOutputManager', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const logService = new NullLogService();

	suite('Output Preservation When Cells Move', () => {
		/**
		 * This test simulates the bug where inserting a new cell at the top of the document
		 * causes all existing outputs to be deleted.
		 *
		 * The bug occurs because:
		 * 1. Cell IDs include the index (e.g., "0-abc12345-unlabeled")
		 * 2. When a new cell is inserted at the top, all existing cells shift down
		 * 3. Their IDs change (e.g., "0-abc12345-unlabeled" becomes "1-abc12345-unlabeled")
		 * 4. The output manager looks up cells by their OLD IDs
		 * 5. Since those IDs don't exist anymore, it thinks the cells were deleted
		 * 6. It incorrectly removes the outputs/view zones
		 *
		 * This test verifies that we can correctly remap outputs when cells move
		 * by using content hashes to track cell identity across position changes.
		 */
		test('outputs should be preserved when a new cell is inserted above existing cells', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			disposables.add(model);

			// Initial state: two cells with outputs
			assert.strictEqual(model.cells.length, 2);
			const originalCell0Id = model.cells[0].id;
			const originalCell1Id = model.cells[1].id;
			const cell0ContentHash = model.cells[0].contentHash;
			const cell1ContentHash = model.cells[1].contentHash;

			// Simulate having outputs stored for these cells
			// In the real output manager, this would be: _viewZones.set(cellId, viewZone)
			const viewZonesByCellId = new Map<string, { cellId: string; contentHash: string }>();
			viewZonesByCellId.set(originalCell0Id, { cellId: originalCell0Id, contentHash: cell0ContentHash });
			viewZonesByCellId.set(originalCell1Id, { cellId: originalCell1Id, contentHash: cell1ContentHash });

			// Insert a new cell at the top
			textModel.applyEdits([{
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 1,
					endColumn: 1
				},
				text: '```{python}\nz = 0\n```\n\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// Now we have 3 cells
			assert.strictEqual(model.cells.length, 3);

			// Simulate what _updateViewZonePositionsImmediate currently does (the buggy behavior):
			// It looks up cells by their OLD IDs, which no longer exist
			const removedByBuggyLogic: string[] = [];
			for (const [cellId, _viewZone] of viewZonesByCellId) {
				const cell = model.getCellById(cellId);
				if (!cell) {
					// BUG: Cell ID changed, so getCellById returns undefined
					// The buggy logic thinks the cell was deleted and removes the output
					removedByBuggyLogic.push(cellId);
				}
			}

			// The buggy logic incorrectly removes BOTH cells because their IDs changed
			assert.strictEqual(removedByBuggyLogic.length, 2, 'Buggy logic removes both cells because IDs changed');
			assert.ok(removedByBuggyLogic.includes(originalCell0Id), 'Original cell 0 is incorrectly removed');
			assert.ok(removedByBuggyLogic.includes(originalCell1Id), 'Original cell 1 is incorrectly removed');

			// The CORRECT behavior: use content hash to find cells that moved
			const remappedViewZones = new Map<string, { cellId: string; contentHash: string }>();
			for (const [cellId, viewZone] of viewZonesByCellId) {
				const cell = model.getCellById(cellId);
				if (cell) {
					// Cell ID still exists - update position normally
					remappedViewZones.set(cellId, viewZone);
				} else {
					// Cell ID doesn't exist - try to find by content hash
					const cellByHash = model.findCellByContentHash(viewZone.contentHash);
					if (cellByHash) {
						// Found the cell - it just moved! Remap to new ID
						remappedViewZones.set(cellByHash.id, {
							cellId: cellByHash.id,
							contentHash: viewZone.contentHash
						});
					}
					// If not found by hash either, THEN the cell was truly deleted
				}
			}

			// With correct logic, both view zones should be preserved with new IDs
			assert.strictEqual(remappedViewZones.size, 2, 'Correct logic preserves both outputs');

			// The view zones should now be keyed by the NEW cell IDs
			const newCell0Id = model.cells[1].id; // Original cell 0 is now at index 1
			const newCell1Id = model.cells[2].id; // Original cell 1 is now at index 2
			assert.ok(remappedViewZones.has(newCell0Id), 'View zone for original cell 0 should be remapped to new ID');
			assert.ok(remappedViewZones.has(newCell1Id), 'View zone for original cell 1 should be remapped to new ID');
		});

		test('outputs should still be removed when a cell is actually deleted', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			disposables.add(model);

			// Initial state: two cells with outputs
			const originalCell0Id = model.cells[0].id;
			const originalCell1Id = model.cells[1].id;
			const cell0ContentHash = model.cells[0].contentHash;
			const cell1ContentHash = model.cells[1].contentHash;

			// Simulate having outputs for these cells
			const viewZonesByCellId = new Map<string, { cellId: string; contentHash: string }>();
			viewZonesByCellId.set(originalCell0Id, { cellId: originalCell0Id, contentHash: cell0ContentHash });
			viewZonesByCellId.set(originalCell1Id, { cellId: originalCell1Id, contentHash: cell1ContentHash });

			// Delete the first cell entirely
			textModel.applyEdits([{
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 5, // Delete the first cell and the blank line after
					endColumn: 1
				},
				text: ''
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// Now we have only 1 cell
			assert.strictEqual(model.cells.length, 1);

			// The remaining cell's content hash should match the original second cell
			assert.strictEqual(model.cells[0].contentHash, cell1ContentHash);

			// Use the correct remapping logic
			const remappedViewZones = new Map<string, { cellId: string; contentHash: string }>();
			for (const [cellId, viewZone] of viewZonesByCellId) {
				const cell = model.getCellById(cellId);
				if (cell) {
					remappedViewZones.set(cellId, viewZone);
				} else {
					const cellByHash = model.findCellByContentHash(viewZone.contentHash);
					if (cellByHash) {
						remappedViewZones.set(cellByHash.id, {
							cellId: cellByHash.id,
							contentHash: viewZone.contentHash
						});
					}
					// Cell was truly deleted - don't add to remapped
				}
			}

			// Only one view zone should be preserved (the second cell, which is now first)
			assert.strictEqual(remappedViewZones.size, 1, 'Only one output should be preserved');

			// The remaining view zone should be for the cell that was originally second
			const newCellId = model.cells[0].id;
			assert.ok(remappedViewZones.has(newCellId), 'View zone for surviving cell should be preserved');
		});
	});
});

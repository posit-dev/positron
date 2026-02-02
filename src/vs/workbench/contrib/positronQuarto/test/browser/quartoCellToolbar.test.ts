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

suite('QuartoCellToolbar - Position Updates', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const logService = new NullLogService();

	/**
	 * Test that verifies the document model fires appropriate events when cells move.
	 * This is a prerequisite for the toolbar controller to update positions correctly.
	 */
	suite('Document Model Events for Cell Movement', () => {

		test('inserting text between cells should update cell line numbers', async () => {
			// Create a document with two cells
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

			// Initial state: verify cell positions
			assert.strictEqual(model.cells.length, 2);
			assert.strictEqual(model.cells[0].startLine, 1);
			assert.strictEqual(model.cells[0].endLine, 3);
			assert.strictEqual(model.cells[1].startLine, 5);
			assert.strictEqual(model.cells[1].endLine, 7);

			const originalCell1ContentHash = model.cells[1].contentHash;

			// Insert some lines between the two cells
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: 'Some new text\nMore new text\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// After insertion, the second cell should have moved down
			assert.strictEqual(model.cells.length, 2);
			assert.strictEqual(model.cells[0].startLine, 1, 'First cell start should not change');
			assert.strictEqual(model.cells[0].endLine, 3, 'First cell end should not change');
			assert.strictEqual(model.cells[1].startLine, 7, 'Second cell start should move down by 2 lines');
			assert.strictEqual(model.cells[1].endLine, 9, 'Second cell end should move down by 2 lines');

			// Content hash should remain the same (content didn't change)
			assert.strictEqual(model.cells[1].contentHash, originalCell1ContentHash);

			// Note: The cell ID may or may not change depending on implementation
			// What matters is that the line numbers are updated
		});

		test('onDidParse should fire when cells move but content stays the same', async () => {
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

			let parseEventFired = false;
			disposables.add(model.onDidParse(() => {
				parseEventFired = true;
			}));

			// Insert text between cells (doesn't change cell content)
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: 'Some new text\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			assert.strictEqual(parseEventFired, true, 'onDidParse should fire after text insertion');
		});

		test('onDidChangeCells does NOT fire when cells move without content change', async () => {
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

			let changeEventFired = false;
			disposables.add(model.onDidChangeCells(() => {
				changeEventFired = true;
			}));

			// Insert text between cells (doesn't change cell content)
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: 'Some new text\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// This is the key insight: onDidChangeCells does NOT fire when cells just move
			// The toolbar controller needs to also listen to onDidParse to update positions
			assert.strictEqual(changeEventFired, false, 'onDidChangeCells should NOT fire for position-only changes');

			// But the cells DO have updated positions
			assert.strictEqual(model.cells[1].startLine, 6, 'Cell should have updated line numbers');
		});

		test('toolbar controller should update positions via onDidParse', async () => {
			// This test documents what the fix should achieve:
			// After inserting text between cells, the toolbar positions should update
			// even if cell content doesn't change

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

			// Track both events
			const eventsFired: string[] = [];
			disposables.add(model.onDidChangeCells(() => {
				eventsFired.push('onDidChangeCells');
			}));
			disposables.add(model.onDidParse(() => {
				eventsFired.push('onDidParse');
			}));

			// Record initial cell positions
			const initialPositions = model.cells.map(c => ({
				id: c.id,
				startLine: c.startLine
			}));

			// Insert text between cells
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: 'New line 1\nNew line 2\nNew line 3\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// onDidParse should always fire after parsing
			assert.ok(eventsFired.includes('onDidParse'), 'onDidParse should fire after text changes');

			// The second cell should have moved
			const newPositions = model.cells.map(c => ({
				id: c.id,
				startLine: c.startLine
			}));

			// First cell unchanged
			assert.strictEqual(newPositions[0].startLine, initialPositions[0].startLine);

			// Second cell moved down by 3 lines
			assert.strictEqual(
				newPositions[1].startLine,
				initialPositions[1].startLine + 3,
				'Second cell should have moved down'
			);

			// The key insight: a toolbar controller listening to onDidParse
			// can refresh cell references and update positions correctly
		});
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';

describe('QuartoCellToolbar - Position Updates', () => {
	const ctx = createTestContainer().build();
	const logService = new NullLogService();

	/**
	 * Test that verifies the document model fires appropriate events when cells move.
	 * This is a prerequisite for the toolbar controller to update positions correctly.
	 */
	describe('Document Model Events for Cell Movement', () => {

		it('inserting text between cells should update cell line numbers', async () => {
			// Create a document with two cells
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			// Initial state: verify cell positions
			expect(model.cells.length).toBe(2);
			expect(model.cells[0].startLine).toBe(1);
			expect(model.cells[0].endLine).toBe(3);
			expect(model.cells[1].startLine).toBe(5);
			expect(model.cells[1].endLine).toBe(7);

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
			expect(model.cells.length).toBe(2);
			expect(model.cells[0].startLine).toBe(1);
			expect(model.cells[0].endLine).toBe(3);
			expect(model.cells[1].startLine).toBe(7);
			expect(model.cells[1].endLine).toBe(9);

			// Content hash should remain the same (content didn't change)
			expect(model.cells[1].contentHash).toBe(originalCell1ContentHash);
		});

		it('onDidParse should fire when cells move but content stays the same', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			let parseEventFired = false;
			ctx.disposables.add(model.onDidParse(() => {
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

			expect(parseEventFired).toBe(true);
		});

		it('onDidChangeCells does NOT fire when cells move without content change', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			let changeEventFired = false;
			ctx.disposables.add(model.onDidChangeCells(() => {
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
			expect(changeEventFired).toBe(false);

			// But the cells DO have updated positions
			expect(model.cells[1].startLine).toBe(6);
		});

		it('toolbar controller should update positions via onDidParse', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			// Track both events
			const eventsFired: string[] = [];
			ctx.disposables.add(model.onDidChangeCells(() => {
				eventsFired.push('onDidChangeCells');
			}));
			ctx.disposables.add(model.onDidParse(() => {
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
			expect(eventsFired.includes('onDidParse')).toBeTruthy();

			// The second cell should have moved
			const newPositions = model.cells.map(c => ({
				id: c.id,
				startLine: c.startLine
			}));

			// First cell unchanged
			expect(newPositions[0].startLine).toBe(initialPositions[0].startLine);

			// Second cell moved down by 3 lines
			expect(newPositions[1].startLine).toBe(initialPositions[1].startLine + 3);
		});
	});
});

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

suite('QuartoDocumentModel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const logService = new NullLogService();

	function createModel(content: string, uri?: URI): QuartoDocumentModel {
		const textModel = createTextModel(content, null, undefined, uri ?? URI.file('/test.qmd'));
		disposables.add(textModel);
		const model = new QuartoDocumentModel(textModel, logService);
		disposables.add(model);
		return model;
	}

	suite('Cell Parsing', () => {
		test('parses simple Python cell', () => {
			const content = `---
title: "Test"
---

\`\`\`{python}
print("Hello")
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.cells.length, 1);
			const cell = model.cells[0];
			assert.strictEqual(cell.language, 'python');
			assert.strictEqual(cell.startLine, 5);
			assert.strictEqual(cell.endLine, 7);
			assert.strictEqual(cell.codeStartLine, 6);
			assert.strictEqual(cell.codeEndLine, 6);
			assert.strictEqual(cell.index, 0);
		});

		test('parses R cell', () => {
			const content = `\`\`\`{r}
x <- 1:10
mean(x)
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].language, 'r');
		});

		test('parses multiple cells', () => {
			const content = `\`\`\`{python}
import pandas as pd
\`\`\`

\`\`\`{python}
df = pd.DataFrame()
\`\`\`

\`\`\`{r}
library(dplyr)
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.cells.length, 3);
			assert.strictEqual(model.cells[0].language, 'python');
			assert.strictEqual(model.cells[0].index, 0);
			assert.strictEqual(model.cells[1].language, 'python');
			assert.strictEqual(model.cells[1].index, 1);
			assert.strictEqual(model.cells[2].language, 'r');
			assert.strictEqual(model.cells[2].index, 2);
		});

		test('parses cell with label', () => {
			const content = `\`\`\`{python setup}
import os
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].label, 'setup');
		});

		test('parses cell with options', () => {
			const content = `\`\`\`{python my-plot, fig.width=10, fig.height=8}
plt.plot([1, 2, 3])
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].label, 'my-plot');
			assert.ok(model.cells[0].options.includes('fig.width=10'));
		});

		test('handles empty cell', () => {
			const content = `\`\`\`{python}
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].codeEndLine, 1);
			assert.strictEqual(model.cells[0].codeStartLine, 2);
			// Content hash should still be generated for empty content
			assert.ok(model.cells[0].contentHash.length > 0);
		});

		test('ignores non-code blocks', () => {
			const content = `# Title

\`\`\`python
# This is a markdown code block, not executable
print("not executed")
\`\`\`

\`\`\`{python}
print("executed")
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.getCellCode(model.cells[0]), 'print("executed")');
		});
	});

	suite('Frontmatter Parsing', () => {
		test('extracts simple jupyter kernel', () => {
			const content = `---
jupyter: python3
---

\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.jupyterKernel, 'python3');
			assert.strictEqual(model.primaryLanguage, 'python');
		});

		test('extracts kernelspec name', () => {
			const content = `---
jupyter:
  kernelspec:
    name: ir
    display_name: R
---

\`\`\`{r}
x <- 1
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.jupyterKernel, 'ir');
			assert.strictEqual(model.primaryLanguage, 'r');
		});

		test('uses first cell language when no jupyter kernel', () => {
			const content = `---
title: "Test"
---

\`\`\`{r}
x <- 1
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.jupyterKernel, undefined);
			assert.strictEqual(model.primaryLanguage, 'r');
		});

		test('handles document without frontmatter', () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.jupyterKernel, undefined);
			assert.strictEqual(model.primaryLanguage, 'python');
		});
	});

	suite('Cell ID Stability', () => {
		test('same content produces same hash', () => {
			const content1 = `\`\`\`{python}
x = 1
\`\`\`
`;
			const content2 = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model1 = createModel(content1);
			const model2 = createModel(content2);

			assert.strictEqual(model1.cells[0].contentHash, model2.cells[0].contentHash);
		});

		test('different content produces different hash', () => {
			const content1 = `\`\`\`{python}
x = 1
\`\`\`
`;
			const content2 = `\`\`\`{python}
x = 2
\`\`\`
`;
			const model1 = createModel(content1);
			const model2 = createModel(content2);

			assert.notStrictEqual(model1.cells[0].contentHash, model2.cells[0].contentHash);
		});

		test('cell ID includes index, hash prefix, and label', () => {
			const content = `\`\`\`{python setup}
import os
\`\`\`
`;
			const model = createModel(content);

			const id = model.cells[0].id;
			assert.ok(id.startsWith('0-'), 'ID should start with index');
			assert.ok(id.endsWith('-setup'), 'ID should end with label');
			assert.strictEqual(id.split('-').length, 3, 'ID should have 3 parts');
		});

		test('unlabeled cell has unlabeled in ID', () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			assert.ok(model.cells[0].id.endsWith('-unlabeled'));
		});
	});

	suite('Cell Lookup', () => {
		test('getCellById finds correct cell', () => {
			const content = `\`\`\`{python setup}
x = 1
\`\`\`

\`\`\`{python plot}
y = 2
\`\`\`
`;
			const model = createModel(content);

			const cell = model.getCellById(model.cells[1].id);
			assert.ok(cell);
			assert.strictEqual(cell.label, 'plot');
		});

		test('getCellAtLine finds cell containing line', () => {
			const content = `\`\`\`{python}
x = 1
y = 2
z = 3
\`\`\`
`;
			const model = createModel(content);

			// Line 1 is opening fence
			const cellAtFence = model.getCellAtLine(1);
			assert.ok(cellAtFence);
			assert.strictEqual(cellAtFence.index, 0);

			// Line 3 is in the middle of the code
			const cellAtCode = model.getCellAtLine(3);
			assert.ok(cellAtCode);
			assert.strictEqual(cellAtCode.index, 0);

			// Line 5 is closing fence
			const cellAtEnd = model.getCellAtLine(5);
			assert.ok(cellAtEnd);
			assert.strictEqual(cellAtEnd.index, 0);

			// Line 6 is outside any cell
			const outsideCell = model.getCellAtLine(6);
			assert.strictEqual(outsideCell, undefined);
		});

		test('getCellByIndex returns correct cell', () => {
			const content = `\`\`\`{python}
a = 1
\`\`\`

\`\`\`{python}
b = 2
\`\`\`
`;
			const model = createModel(content);

			const cell0 = model.getCellByIndex(0);
			assert.ok(cell0);
			assert.strictEqual(model.getCellCode(cell0), 'a = 1');

			const cell1 = model.getCellByIndex(1);
			assert.ok(cell1);
			assert.strictEqual(model.getCellCode(cell1), 'b = 2');

			const cell2 = model.getCellByIndex(2);
			assert.strictEqual(cell2, undefined);
		});

		test('findCellByContentHash finds matching cell', () => {
			const content = `\`\`\`{python}
unique_content_12345
\`\`\`
`;
			const model = createModel(content);

			const hash = model.cells[0].contentHash;
			const found = model.findCellByContentHash(hash);
			assert.ok(found);
			assert.strictEqual(found.index, 0);
		});
	});

	suite('getCellCode', () => {
		test('returns code content without fences', () => {
			const content = `\`\`\`{python}
line1
line2
line3
\`\`\`
`;
			const model = createModel(content);

			const code = model.getCellCode(model.cells[0]);
			assert.strictEqual(code, 'line1\nline2\nline3');
		});

		test('handles single line code', () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.getCellCode(model.cells[0]), 'x = 1');
		});

		test('handles empty cell', () => {
			const content = `\`\`\`{python}
\`\`\`
`;
			const model = createModel(content);

			assert.strictEqual(model.getCellCode(model.cells[0]), '');
		});
	});

	suite('Document URI', () => {
		test('returns correct URI', () => {
			const uri = URI.file('/path/to/document.qmd');
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content, uri);

			assert.strictEqual(model.uri.toString(), uri.toString());
		});
	});

	suite('Cell Position Updates', () => {
		test('cell positions update when line is deleted above cell', async () => {
			// This test verifies that cell positions update correctly when lines
			// are deleted above the cell - reproducing the bug where view zones
			// don't shift up when lines are deleted.
			const content = `Some text above

\`\`\`{python}
x = 1
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			disposables.add(model);

			// Initial state: cell starts at line 3, ends at line 5
			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].startLine, 3);
			assert.strictEqual(model.cells[0].endLine, 5);

			const originalCellId = model.cells[0].id;

			// Delete the first line ("Some text above")
			textModel.applyEdits([{
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 2,
					endColumn: 1
				},
				text: ''
			}]);

			// Wait for debounce (100ms + buffer)
			await new Promise(resolve => setTimeout(resolve, 150));

			// After deleting the line, cell should now start at line 2, end at line 4
			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].startLine, 2, 'Cell startLine should shift up after line deletion');
			assert.strictEqual(model.cells[0].endLine, 4, 'Cell endLine should shift up after line deletion');

			// The cell ID should remain the same (content didn't change)
			assert.strictEqual(model.cells[0].id, originalCellId, 'Cell ID should remain stable');
		});

		test('cell positions update when line is added above cell', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			disposables.add(model);

			// Initial state: cell starts at line 1, ends at line 3
			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].startLine, 1);
			assert.strictEqual(model.cells[0].endLine, 3);

			const originalCellId = model.cells[0].id;

			// Add a line at the beginning
			textModel.applyEdits([{
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 1,
					endColumn: 1
				},
				text: 'New line above\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// After adding the line, cell should now start at line 2, end at line 4
			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].startLine, 2, 'Cell startLine should shift down after line addition');
			assert.strictEqual(model.cells[0].endLine, 4, 'Cell endLine should shift down after line addition');

			// The cell ID should remain the same (content didn't change)
			assert.strictEqual(model.cells[0].id, originalCellId, 'Cell ID should remain stable');
		});

		test('cell ID changes when a new cell is inserted above (but content hash is stable)', async () => {
			// This test documents the current behavior where cell IDs include the index,
			// so inserting a new cell at the top changes the IDs of all subsequent cells.
			// The content hash, however, remains stable and can be used to track cells.
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

			// Initial state: two cells at indices 0 and 1
			assert.strictEqual(model.cells.length, 2);
			const originalCell0Id = model.cells[0].id;
			const originalCell1Id = model.cells[1].id;
			const cell0ContentHash = model.cells[0].contentHash;
			const cell1ContentHash = model.cells[1].contentHash;

			// IDs should start with their index
			assert.ok(originalCell0Id.startsWith('0-'), 'First cell ID should start with 0-');
			assert.ok(originalCell1Id.startsWith('1-'), 'Second cell ID should start with 1-');

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

			// After inserting, we should have 3 cells
			assert.strictEqual(model.cells.length, 3);

			// The new cell is at index 0
			assert.ok(model.cells[0].id.startsWith('0-'), 'New cell should be at index 0');

			// The original cells have CHANGED IDs because their indices shifted
			// This is the root cause of the bug - the output manager can't find cells by their old IDs
			assert.ok(model.cells[1].id.startsWith('1-'), 'Original first cell should now be at index 1');
			assert.ok(model.cells[2].id.startsWith('2-'), 'Original second cell should now be at index 2');
			assert.notStrictEqual(model.cells[1].id, originalCell0Id, 'Original first cell ID should have changed');
			assert.notStrictEqual(model.cells[2].id, originalCell1Id, 'Original second cell ID should have changed');

			// However, content hashes remain stable
			assert.strictEqual(model.cells[1].contentHash, cell0ContentHash, 'Content hash should be stable');
			assert.strictEqual(model.cells[2].contentHash, cell1ContentHash, 'Content hash should be stable');

			// The cells CAN be found by their content hash
			const foundCell0 = model.findCellByContentHash(cell0ContentHash);
			const foundCell1 = model.findCellByContentHash(cell1ContentHash);
			assert.ok(foundCell0, 'Should be able to find original first cell by content hash');
			assert.ok(foundCell1, 'Should be able to find original second cell by content hash');
			assert.strictEqual(foundCell0.index, 1, 'Original first cell should now be at index 1');
			assert.strictEqual(foundCell1.index, 2, 'Original second cell should now be at index 2');
		});
	});

	suite('Change Events', () => {
		test('fires onDidChangeCells when cells change', async () => {
			const content = `\`\`\`{python}
x = 1
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

			// Modify the text model - add a new cell
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: '\n```{python}\ny = 2\n```'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			assert.strictEqual(changeEventFired, true);
			assert.strictEqual(model.cells.length, 2);
		});

		test('fires onDidChangeLanguage when language changes', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			disposables.add(model);

			let newLanguage: string | undefined;
			disposables.add(model.onDidChangeLanguage(lang => {
				newLanguage = lang;
			}));

			// Replace python cell with R cell
			textModel.applyEdits([{
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: '```{r}\nx <- 1\n```\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			assert.strictEqual(newLanguage, 'r');
			assert.strictEqual(model.primaryLanguage, 'r');
		});
	});
});

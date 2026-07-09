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

describe('QuartoDocumentModel', () => {
	const ctx = createTestContainer().build();
	const logService = new NullLogService();

	function createModel(content: string, uri?: URI): QuartoDocumentModel {
		const textModel = createTextModel(content, null, undefined, uri ?? URI.file('/test.qmd'));
		ctx.disposables.add(textModel);
		const model = new QuartoDocumentModel(textModel, logService);
		ctx.disposables.add(model);
		return model;
	}

	describe('Cell Parsing', () => {
		it('parses simple Python cell', () => {
			const content = `---
title: "Test"
---

\`\`\`{python}
print("Hello")
\`\`\`
`;
			const model = createModel(content);

			expect(model.cells.length).toBe(1);
			const cell = model.cells[0];
			expect(cell.language).toBe('python');
			expect(cell.startLine).toBe(5);
			expect(cell.endLine).toBe(7);
			expect(cell.codeStartLine).toBe(6);
			expect(cell.codeEndLine).toBe(6);
			expect(cell.index).toBe(0);
		});

		it('parses R cell', () => {
			const content = `\`\`\`{r}
x <- 1:10
mean(x)
\`\`\`
`;
			const model = createModel(content);

			expect(model.cells.length).toBe(1);
			expect(model.cells[0].language).toBe('r');
		});

		it('parses multiple cells', () => {
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

			expect(model.cells.length).toBe(3);
			expect(model.cells[0].language).toBe('python');
			expect(model.cells[0].index).toBe(0);
			expect(model.cells[1].language).toBe('python');
			expect(model.cells[1].index).toBe(1);
			expect(model.cells[2].language).toBe('r');
			expect(model.cells[2].index).toBe(2);
		});

		it('parses cell with label', () => {
			const content = `\`\`\`{python setup}
import os
\`\`\`
`;
			const model = createModel(content);

			expect(model.cells.length).toBe(1);
			expect(model.cells[0].label).toBe('setup');
		});

		it('parses cell with options', () => {
			const content = `\`\`\`{python my-plot, fig.width=10, fig.height=8}
plt.plot([1, 2, 3])
\`\`\`
`;
			const model = createModel(content);

			expect(model.cells.length).toBe(1);
			expect(model.cells[0].label).toBe('my-plot');
			expect(model.cells[0].options).toContain('fig.width=10');
		});

		it('handles empty cell', () => {
			const content = `\`\`\`{python}
\`\`\`
`;
			const model = createModel(content);

			expect(model.cells.length).toBe(1);
			expect(model.cells[0].codeEndLine).toBe(1);
			expect(model.cells[0].codeStartLine).toBe(2);
			// Content hash should still be generated for empty content
			expect(model.cells[0].contentHash.length).toBeGreaterThan(0);
		});

		it('ignores non-code blocks', () => {
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

			expect(model.cells.length).toBe(1);
			expect(model.getCellCode(model.cells[0])).toBe('print("executed")');
		});
	});

	describe('Frontmatter Parsing', () => {
		it('extracts simple jupyter kernel', () => {
			const content = `---
jupyter: python3
---

\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			expect(model.jupyterKernel).toBe('python3');
			expect(model.primaryLanguage).toBe('python');
		});

		it('extracts kernelspec name', () => {
			const content = [
				'---',
				'jupyter:',
				'  kernelspec:',
				'    name: ir',
				'    display_name: R',
				'---',
				'',
				'```{r}',
				'x <- 1',
				'```',
				'',
			].join('\n');
			const model = createModel(content);

			expect(model.jupyterKernel).toBe('ir');
			expect(model.primaryLanguage).toBe('r');
		});

		it('falls back to first cell language when jupyter kernel name is unrecognized', () => {
			// A custom kernelspec name (e.g. created via `ipykernel install --name ...`)
			// isn't mappable to a known language, so the primary language should fall
			// back to the cell fence language rather than being left undefined.
			const content = `---
jupyter: spectral-comparison-3.14
---

\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			expect(model.jupyterKernel).toBe('spectral-comparison-3.14');
			expect(model.primaryLanguage).toBe('python');
		});

		it('uses first cell language when no jupyter kernel', () => {
			const content = `---
title: "Test"
---

\`\`\`{r}
x <- 1
\`\`\`
`;
			const model = createModel(content);

			expect(model.jupyterKernel).toBe(undefined);
			expect(model.primaryLanguage).toBe('r');
		});

		it('handles document without frontmatter', () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			expect(model.jupyterKernel).toBe(undefined);
			expect(model.primaryLanguage).toBe('python');
		});
	});

	describe('Cell ID Stability', () => {
		it('same content produces same hash', () => {
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

			expect(model1.cells[0].contentHash).toBe(model2.cells[0].contentHash);
		});

		it('different content produces different hash', () => {
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

			expect(model1.cells[0].contentHash).not.toBe(model2.cells[0].contentHash);
		});

		it('cell ID includes index, hash prefix, and label', () => {
			const content = `\`\`\`{python setup}
import os
\`\`\`
`;
			const model = createModel(content);

			const id = model.cells[0].id;
			expect(id.startsWith('0-'), 'ID should start with index').toBe(true);
			expect(id.endsWith('-setup'), 'ID should end with label').toBe(true);
			expect(id.split('-').length, 'ID should have 3 parts').toBe(3);
		});

		it('unlabeled cell has unlabeled in ID', () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			expect(model.cells[0].id.endsWith('-unlabeled')).toBe(true);
		});
	});

	describe('Cell Lookup', () => {
		it('getCellById finds correct cell', () => {
			const content = `\`\`\`{python setup}
x = 1
\`\`\`

\`\`\`{python plot}
y = 2
\`\`\`
`;
			const model = createModel(content);

			const cell = model.getCellById(model.cells[1].id);
			expect(cell).toBeDefined();
			expect(cell!.label).toBe('plot');
		});

		it('getCellAtLine finds cell containing line', () => {
			const content = `\`\`\`{python}
x = 1
y = 2
z = 3
\`\`\`
`;
			const model = createModel(content);

			// Line 1 is opening fence
			const cellAtFence = model.getCellAtLine(1);
			expect(cellAtFence).toBeDefined();
			expect(cellAtFence!.index).toBe(0);

			// Line 3 is in the middle of the code
			const cellAtCode = model.getCellAtLine(3);
			expect(cellAtCode).toBeDefined();
			expect(cellAtCode!.index).toBe(0);

			// Line 5 is closing fence
			const cellAtEnd = model.getCellAtLine(5);
			expect(cellAtEnd).toBeDefined();
			expect(cellAtEnd!.index).toBe(0);

			// Line 6 is outside any cell
			const outsideCell = model.getCellAtLine(6);
			expect(outsideCell).toBe(undefined);
		});

		it('getCellByIndex returns correct cell', () => {
			const content = `\`\`\`{python}
a = 1
\`\`\`

\`\`\`{python}
b = 2
\`\`\`
`;
			const model = createModel(content);

			const cell0 = model.getCellByIndex(0);
			expect(cell0).toBeDefined();
			expect(model.getCellCode(cell0!)).toBe('a = 1');

			const cell1 = model.getCellByIndex(1);
			expect(cell1).toBeDefined();
			expect(model.getCellCode(cell1!)).toBe('b = 2');

			const cell2 = model.getCellByIndex(2);
			expect(cell2).toBe(undefined);
		});

		it('findCellByContentHash finds matching cell', () => {
			const content = `\`\`\`{python}
unique_content_12345
\`\`\`
`;
			const model = createModel(content);

			const hash = model.cells[0].contentHash;
			const found = model.findCellByContentHash(hash);
			expect(found).toBeDefined();
			expect(found!.index).toBe(0);
		});
	});

	describe('getCellCode', () => {
		it('returns code content without fences', () => {
			const content = `\`\`\`{python}
line1
line2
line3
\`\`\`
`;
			const model = createModel(content);

			const code = model.getCellCode(model.cells[0]);
			expect(code).toBe('line1\nline2\nline3');
		});

		it('handles single line code', () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content);

			expect(model.getCellCode(model.cells[0])).toBe('x = 1');
		});

		it('handles empty cell', () => {
			const content = `\`\`\`{python}
\`\`\`
`;
			const model = createModel(content);

			expect(model.getCellCode(model.cells[0])).toBe('');
		});
	});

	describe('Document URI', () => {
		it('returns correct URI', () => {
			const uri = URI.file('/path/to/document.qmd');
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const model = createModel(content, uri);

			expect(model.uri.toString()).toBe(uri.toString());
		});
	});

	describe('Cell Position Updates', () => {
		it('cell positions update when line is deleted above cell', async () => {
			// This test verifies that cell positions update correctly when lines
			// are deleted above the cell - reproducing the bug where view zones
			// don't shift up when lines are deleted.
			const content = `Some text above

\`\`\`{python}
x = 1
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			// Initial state: cell starts at line 3, ends at line 5
			expect(model.cells.length).toBe(1);
			expect(model.cells[0].startLine).toBe(3);
			expect(model.cells[0].endLine).toBe(5);

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
			expect(model.cells.length).toBe(1);
			expect(model.cells[0].startLine, 'Cell startLine should shift up after line deletion').toBe(2);
			expect(model.cells[0].endLine, 'Cell endLine should shift up after line deletion').toBe(4);

			// The cell ID should remain the same (content didn't change)
			expect(model.cells[0].id, 'Cell ID should remain stable').toBe(originalCellId);
		});

		it('cell positions update when line is added above cell', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			// Initial state: cell starts at line 1, ends at line 3
			expect(model.cells.length).toBe(1);
			expect(model.cells[0].startLine).toBe(1);
			expect(model.cells[0].endLine).toBe(3);

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
			expect(model.cells.length).toBe(1);
			expect(model.cells[0].startLine, 'Cell startLine should shift down after line addition').toBe(2);
			expect(model.cells[0].endLine, 'Cell endLine should shift down after line addition').toBe(4);

			// The cell ID should remain the same (content didn't change)
			expect(model.cells[0].id, 'Cell ID should remain stable').toBe(originalCellId);
		});

		it('cell ID changes when a new cell is inserted above (but content hash is stable)', async () => {
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
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			// Initial state: two cells at indices 0 and 1
			expect(model.cells.length).toBe(2);
			const originalCell0Id = model.cells[0].id;
			const originalCell1Id = model.cells[1].id;
			const cell0ContentHash = model.cells[0].contentHash;
			const cell1ContentHash = model.cells[1].contentHash;

			// IDs should start with their index
			expect(originalCell0Id.startsWith('0-'), 'First cell ID should start with 0-').toBe(true);
			expect(originalCell1Id.startsWith('1-'), 'Second cell ID should start with 1-').toBe(true);

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
			expect(model.cells.length).toBe(3);

			// The new cell is at index 0
			expect(model.cells[0].id.startsWith('0-'), 'New cell should be at index 0').toBe(true);

			// The original cells have CHANGED IDs because their indices shifted
			// This is the root cause of the bug - the output manager can't find cells by their old IDs
			expect(model.cells[1].id.startsWith('1-'), 'Original first cell should now be at index 1').toBe(true);
			expect(model.cells[2].id.startsWith('2-'), 'Original second cell should now be at index 2').toBe(true);
			expect(model.cells[1].id, 'Original first cell ID should have changed').not.toBe(originalCell0Id);
			expect(model.cells[2].id, 'Original second cell ID should have changed').not.toBe(originalCell1Id);

			// However, content hashes remain stable
			expect(model.cells[1].contentHash, 'Content hash should be stable').toBe(cell0ContentHash);
			expect(model.cells[2].contentHash, 'Content hash should be stable').toBe(cell1ContentHash);

			// The cells CAN be found by their content hash
			const foundCell0 = model.findCellByContentHash(cell0ContentHash);
			const foundCell1 = model.findCellByContentHash(cell1ContentHash);
			expect(foundCell0, 'Should be able to find original first cell by content hash').toBeDefined();
			expect(foundCell1, 'Should be able to find original second cell by content hash').toBeDefined();
			expect(foundCell0!.index, 'Original first cell should now be at index 1').toBe(1);
			expect(foundCell1!.index, 'Original second cell should now be at index 2').toBe(2);
		});
	});

	describe('Change Events', () => {
		it('fires onDidChangeCells when cells change', async () => {
			const content = `\`\`\`{python}
x = 1
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

			expect(changeEventFired).toBe(true);
			expect(model.cells.length).toBe(2);
		});

		it('fires onDidChangeLanguage when language changes', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			let newLanguage: string | undefined;
			ctx.disposables.add(model.onDidChangeLanguage(lang => {
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

			expect(newLanguage).toBe('r');
			expect(model.primaryLanguage).toBe('r');
		});
	});


	describe('findCellByPreviousId', () => {
		// Two identical chunks: same content hash, different indices.
		const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
x = 1
\`\`\`
`;

		it('prefers the instance at the old index for duplicate chunks', () => {
			const model = createModel(content);
			const second = model.cells[1];
			expect(model.findCellByPreviousId(second.id, second.contentHash)?.index).toBe(1);
		});

		it('falls back to the first hash match when the ID has no index', () => {
			const model = createModel(content);
			const hash = model.cells[0].contentHash;
			expect(model.findCellByPreviousId('bogus-id', hash)?.index).toBe(0);
		});
	});
});

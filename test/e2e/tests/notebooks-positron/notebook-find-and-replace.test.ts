/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Find and Replace', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async function ({ hotKeys }) {
		await hotKeys.minimizeBottomPanel();
	});

	test('Verify replace, replace all, match counter, and undo in code cells', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// 4 matches for 'foo' across 3 code cells
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'foo = 1');
		await notebooksPositron.addCodeToCell(1, 'foo2 = foo + 1');
		await notebooksPositron.addCodeToCell(2, 'print(foo)', { fast: true });

		await notebooksPositron.search('foo');
		await notebooksPositron.expectSearchCountToBe({ current: 1, total: 4 });
		await notebooksPositron.expectSearchDecorationCountToBe(4);

		// Replace a single match and verify the counter decrements
		await notebooksPositron.searchSetReplaceText('bar');
		await notebooksPositron.searchReplaceNext();
		await notebooksPositron.expectSearchCountToBe({ total: 3 });
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'bar = 1');

		// Replace all remaining matches
		await notebooksPositron.searchReplaceAll();
		await notebooksPositron.expectSearchCountToBe({ total: 0 });
		await notebooksPositron.expectCellContentsToBe(['bar = 1', 'bar2 = bar + 1', 'print(bar)']);

		// Replace All applies one bulk edit, so it is a single undo step.
		// With the default per-cell undo stacks (notebook.undoRedoPerCell),
		// undoing from any cell touched by Replace All reverts every cell it
		// changed at once, while cell 0's earlier single replace stays put.
		await notebooksPositron.searchClose('button');
		await notebooksPositron.selectCellAtIndex(1);
		await hotKeys.undo();
		await notebooksPositron.expectCellContentsToBe(['bar = 1', 'foo2 = foo + 1', 'print(foo)']);

		// The single replace is its own undo step in cell 0
		await notebooksPositron.selectCellAtIndex(0);
		await hotKeys.undo();
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'foo = 1');
	});

	test('Verify step-through replace advances and Next skips a match', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// 5 matches for 'apple' in document order. The last cell must not end
		// with a match: the search starts from the cursor (end of the last
		// typed cell), and only wraps to the first match when the cursor sits
		// strictly after the final match.
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'apple = 1');
		await notebooksPositron.addCodeToCell(1, 'apple_two = apple');
		await notebooksPositron.addCodeToCell(2, 'apple_three = apple + 1');

		await notebooksPositron.search('apple');
		await notebooksPositron.expectSearchCountToBe({ current: 1, total: 5 });

		// Replace the first match and verify focus advanced to the next one
		await notebooksPositron.searchSetReplaceText('pear');
		await notebooksPositron.searchReplaceNext();
		await notebooksPositron.expectSearchCountToBe({ current: 1, total: 4 });
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'pear = 1');

		// Skip a match (next without replacing), then replace the following one
		await notebooksPositron.searchNext('button');
		await notebooksPositron.expectSearchCountToBe({ current: 2, total: 4 });
		await notebooksPositron.searchReplaceNext();
		await notebooksPositron.expectSearchCountToBe({ total: 3 });

		// The skipped 'apple_two' prefix match is intact
		await notebooksPositron.expectCellContentsToBe(['pear = 1', 'apple_two = pear', 'apple_three = apple + 1']);
	});

	test('Verify replace updates markdown cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Cell contents are '# Cell 0' (code) and '### Cell 1' (markdown, rendered)
		await notebooksPositron.newNotebook({ codeCells: 1, markdownCells: 1 });

		await notebooksPositron.search('Cell');
		await notebooksPositron.expectSearchCountToBe({ total: 2 });

		await notebooksPositron.searchSetReplaceText('Block');
		await notebooksPositron.searchReplaceAll();
		await notebooksPositron.expectSearchCountToBe({ total: 0 });
		await notebooksPositron.searchClose('button');

		// Source updated in both the code cell and the markdown cell
		await notebooksPositron.expectCellContentAtIndexToBe(0, '# Block 0');
		await notebooksPositron.expectCellContentAtIndexToBe(1, '### Block 1');

		// Rendered markdown reflects the replacement
		await notebooksPositron.expectMarkdownTagToBe('h3', 'Block 1');
	});

	test('Verify case sensitivity and whole word toggles', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'test = Test');
		await notebooksPositron.addCodeToCell(1, 'testing = "test"', { fast: true });

		// Case-insensitive, partial word: test, Test, testing, "test"
		await notebooksPositron.search('test');
		await notebooksPositron.expectSearchCountToBe({ total: 4 });

		// Case-sensitive drops 'Test'
		await notebooksPositron.searchSetToggle('matchCase', true);
		await notebooksPositron.expectSearchCountToBe({ total: 3 });

		// Whole word additionally drops 'testing' (quotes are word boundaries)
		await notebooksPositron.searchSetToggle('wholeWord', true);
		await notebooksPositron.expectSearchCountToBe({ total: 2 });

		// Case-insensitive again: 'Test' matches once more
		await notebooksPositron.searchSetToggle('matchCase', false);
		await notebooksPositron.expectSearchCountToBe({ total: 3 });

		// Replace all with whole word on: 'testing' is untouched
		await notebooksPositron.searchSetReplaceText('exam');
		await notebooksPositron.searchReplaceAll();
		await notebooksPositron.searchClose('button');
		await notebooksPositron.expectCellContentsToBe(['exam = exam', 'testing = "exam"']);
	});

	test('Verify no matches state', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'alpha = 1');

		await notebooksPositron.search('zebra');
		await notebooksPositron.expectSearchCountToBe({ total: 0 });
		await notebooksPositron.expectSearchDecorationCountToBe(0);

		// The widget disables Replace/Replace All only when the  text is
		// empty (matching the editor  widget), so with a query that has
		// zero matches the buttons stay enabled and replacing is a no-op.
		await notebooksPositron.searchExpandReplace();
		await notebooksPositron.expectReplaceButtonsEnabled(true);
		await notebooksPositron.searchSetReplaceText('x');
		await notebooksPositron.searchReplaceAll();
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'alpha = 1');

		// With an empty  text the replace buttons are disabled
		await notebooksPositron.search('', { enterKey: false });
		await notebooksPositron.expectReplaceButtonsEnabled(false);
	});

	test('Verify replacing with an empty string deletes matches', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'hello_world = 1');

		await notebooksPositron.search('_world');
		await notebooksPositron.expectSearchCountToBe({ current: 1, total: 1 });

		await notebooksPositron.searchSetReplaceText('');
		await notebooksPositron.searchReplaceAll();
		await notebooksPositron.expectSearchCountToBe({ total: 0 });
		await notebooksPositron.expectCellContentAtIndexToBe(0, 'hello = 1');
	});

	test('Verify search widget buttons show tooltips on hover', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		// Use a query with a match so every button is enabled (disabled
		// buttons do not receive mouse events, so no tooltip can show)
		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'alpha = 1');
		await notebooksPositron.search('alpha');
		await notebooksPositron.expectSearchCountToBe({ current: 1, total: 1 });
		await notebooksPositron.searchExpandReplace();

		// Tooltips are the button label plus a platform-specific keybinding
		// hint, so assert on the label substring only
		await notebooksPositron.expectSearchButtonTooltip('previous', 'Previous Match');
		await notebooksPositron.expectSearchButtonTooltip('next', 'Next Match');
		await notebooksPositron.expectSearchButtonTooltip('close', 'Close');
		await notebooksPositron.expectSearchButtonTooltip('toggleReplace', 'Toggle Replace');
		await notebooksPositron.expectSearchButtonTooltip('replace', 'Replace');
		await notebooksPositron.expectSearchButtonTooltip('replaceAll', 'Replace All');
	});
});

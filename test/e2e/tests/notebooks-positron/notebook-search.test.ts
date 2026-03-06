/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Search & Replace', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.WEB, tags.WIN]
}, () => {

	test('Verify Basic Search', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const notebookPath = path.join('workspaces', 'pokemon', 'pokemon.ipynb');
		await notebooksPositron.openNotebook(notebookPath);

		// open search and search for 'import'
		await notebooksPositron.search('import');
		await notebooksPositron.expectSearchCountToBe({ current: 1, total: 4 });
		await notebooksPositron.expectSearchDecorationCountToBe(4);

		// click next match
		await notebooksPositron.searchNext('button');
		await notebooksPositron.expectSearchCountToBe({ current: 2, total: 4 });

		// enter for next match
		await notebooksPositron.searchNext('keyboard');
		await notebooksPositron.expectSearchCountToBe({ current: 3, total: 4 });

		// click previous match
		await notebooksPositron.searchPrevious();
		await notebooksPositron.expectSearchCountToBe({ current: 2, total: 4 });

		// close search
		await notebooksPositron.searchClose('button');
		await notebooksPositron.expectSearchDecorationCountToBe(0);
	});

	test('Verify Replace', async function ({ app, hotKeys }) {
		const { notebooksPositron } = app.workbench;

		// create notebook with 3 code cells: "# Cell 0", "# Cell 1", "# Cell 2"
		await notebooksPositron.newNotebook({ codeCells: 3 });

		await test.step('Replace row starts collapsed and can be toggled', async () => {
			await notebooksPositron.search('Cell', { enterKey: false });
			await notebooksPositron.expectReplaceRowVisible(false);
			await notebooksPositron.searchExpandReplace();
			await notebooksPositron.expectReplaceRowVisible(true);
		});

		await test.step('Replace single match', async () => {
			await notebooksPositron.search('Cell', { replaceText: 'Replaced' });
			await notebooksPositron.expectSearchCountToBe({ current: 1, total: 2 });
			await notebooksPositron.expectCellContentsToBe(['# Replaced 0', '# Cell 1', '# Cell 2']);
		});

		await test.step('Undo single replace', async () => {
			// undo while search widget is still open
			await notebooksPositron.editModeAtIndex(0);
			await hotKeys.undo();
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		});

		await test.step('Replace all matches', async () => {
			// re-open search and replace all
			await notebooksPositron.search('Cell', { replaceText: 'New', replaceAll: true });
			await notebooksPositron.expectCellContentsToBe(['# New 0', '# New 1', '# New 2']);
			await notebooksPositron.expectSearchCountToBe({ total: 0 });
		});

		await test.step('Undo replace all', async () => {
			// undo after closing search widget (tests both undo flows)
			await notebooksPositron.searchClose('button');
			await notebooksPositron.editModeAtIndex(0);
			await hotKeys.undo();
			await notebooksPositron.expectCellContentAtIndexToBe(0, '# Cell 0');
		});
	});

	test('Verify replace in markdown cells', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook({ codeCells: 1, markdownCells: 1 });
		await notebooksPositron.addCodeToCell(0, 'x = 1');
		await notebooksPositron.addCodeToCell(1, '# Heading with test\nParagraph with test content');

		await test.step('Replace in markdown cell', async () => {
			await notebooksPositron.search('test');
			await notebooksPositron.expectSearchCountToBe({ total: 2 });
			await notebooksPositron.searchSetReplaceText('example');
			await notebooksPositron.searchReplaceAll();
			await notebooksPositron.expectSearchCountToBe({ total: 0 });
			await notebooksPositron.expectCellContentAtIndexToBe(1, '# Heading with example\nParagraph with example content');
		});

		await notebooksPositron.searchClose();
	});

	test('Verify step-through replace and skip functionality', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await notebooksPositron.addCodeToCell(0, 'test test test');
		await notebooksPositron.addCell('code');
		await notebooksPositron.addCodeToCell(1, 'test test');

		await notebooksPositron.search('test');
		await notebooksPositron.expectSearchCountToBe({ total: 5 });

		await test.step('Replace first match, skip second, replace third', async () => {
			await notebooksPositron.searchSetReplaceText('pass');

			// Replace first occurrence
			await notebooksPositron.searchReplace();
			await notebooksPositron.expectSearchCountToBe({ total: 4 });

			// Skip second occurrence (advance without replacing)
			await notebooksPositron.searchNext();
			await notebooksPositron.expectSearchCountToBe({ current: 2, total: 4 });

			// Replace third occurrence
			await notebooksPositron.searchReplace();
			await notebooksPositron.expectSearchCountToBe({ current: 2, total: 3 });

			// Verify partial replacement
			await notebooksPositron.expectCellContentAtIndexToBe(0, 'pass test pass');
		});

		await notebooksPositron.searchClose();
	});

	test('Verify match counter updates correctly', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.addCodeToCell(0, 'item item item item item');

		await notebooksPositron.search('item');
		await notebooksPositron.expectSearchCountToBe({ total: 5 });

		await test.step('Counter updates after each replace', async () => {
			await notebooksPositron.searchSetReplaceText('thing');

			await notebooksPositron.searchReplace();
			await notebooksPositron.expectSearchCountToBe({ total: 4 });

			await notebooksPositron.searchReplace();
			await notebooksPositron.expectSearchCountToBe({ total: 3 });

			await notebooksPositron.searchReplace();
			await notebooksPositron.expectSearchCountToBe({ total: 2 });
		});

		await notebooksPositron.searchClose();
	});

	test('Verify case sensitivity toggle', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.addCodeToCell(0, 'Test test TEST tEsT');

		await test.step('Case-insensitive search matches all variations', async () => {
			await notebooksPositron.search('test');
			await notebooksPositron.expectSearchCountToBe({ total: 4 });
			await notebooksPositron.searchClose();
		});

		await test.step('Case-sensitive search matches only exact case', async () => {
			await notebooksPositron.search('test');
			await notebooksPositron.searchToggleCaseSensitive();
			await notebooksPositron.expectSearchCountToBe({ total: 1 });
			await notebooksPositron.searchClose();
		});

		await test.step('Case-sensitive "Test" matches only "Test"', async () => {
			await notebooksPositron.search('Test');
			await notebooksPositron.searchToggleCaseSensitive();
			await notebooksPositron.expectSearchCountToBe({ total: 1 });
		});

		await notebooksPositron.searchClose();
	});

	test('Verify whole word toggle', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.addCodeToCell(0, 'test testing tested tester');

		await test.step('Without whole word, matches partial words', async () => {
			await notebooksPositron.search('test');
			await notebooksPositron.expectSearchCountToBe({ total: 4 });
			await notebooksPositron.searchClose();
		});

		await test.step('With whole word, matches only complete word', async () => {
			await notebooksPositron.search('test');
			await notebooksPositron.searchToggleWholeWord();
			await notebooksPositron.expectSearchCountToBe({ total: 1 });
		});

		await notebooksPositron.searchClose();
	});

	test('Verify no matches state and disabled buttons', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.addCodeToCell(0, 'hello world');

		await test.step('No matches shows "No results" and disables replace buttons', async () => {
			await notebooksPositron.search('nonexistent');
			await notebooksPositron.expectSearchCountToBe({ total: 0 });
			await notebooksPositron.searchSetReplaceText('something');
			await notebooksPositron.expectReplaceButtonToBeDisabled();
			await notebooksPositron.expectReplaceAllButtonToBeDisabled();
		});

		await notebooksPositron.searchClose();
	});

	test('Verify empty replace string (deletion)', async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.addCodeToCell(0, 'remove remove keep');

		await test.step('Replace with empty string deletes matches', async () => {
			await notebooksPositron.search('remove ');
			await notebooksPositron.expectSearchCountToBe({ total: 2 });

			await notebooksPositron.searchSetReplaceText('');
			await notebooksPositron.searchReplaceAll();
			await notebooksPositron.expectSearchCountToBe({ total: 0 });
			await notebooksPositron.expectCellContentAtIndexToBe(0, 'keep');
		});

		await notebooksPositron.searchClose();
	});
});

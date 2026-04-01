/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Statement Range (Python)', {
	tag: [tags.QUARTO, tags.CONSOLE]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true,
			'console.showNotebookConsoles': true,
			'workbench.editor.enablePreview': false,
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Multi-line statement execution in script works after opening Quarto document', async function ({ app, openFile, sessions, hotKeys, python }) {
		const { editors, console, inlineQuarto } = app.workbench;

		await test.step('Open Quarto document and run a cell to start notebook session', async () => {
			await openFile(join('workspaces', 'quarto_inline_output', 'multiple_statements_py.qmd'));
			await editors.waitForActiveTab('multiple_statements_py.qmd');
			await inlineQuarto.expectKernelStatusVisible();

			// Run the first cell to start the notebook session
			await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 15 });
		});

		await test.step('Open Python script and run a multi-line statement', async () => {
			await openFile(join('workspaces', 'quarto_inline_output', 'multiline_statement.py'));
			await editors.waitForActiveTab('multiline_statement.py');

			// Cursor starts at line 1 (comment). Press Cmd+Enter to
			// send the comment and advance cursor to line 2.
			await hotKeys.runLineOfCode();

			// Now cursor should be on line 2 (first line of multi-line
			// statement). Run with Cmd+Enter. The StatementRangeProvider
			// should detect lines 2-5 as a single statement:
			//   sum(\n    v ** 0.5\n    for v in [1, 2, 3]\n)
			// If the bug is present (notebook LSP's StatementRangeProvider
			// is used instead of the console LSP's), only line 2 is sent,
			// which is an incomplete expression.
			await hotKeys.runLineOfCode();

			// Verify the full statement executed and produced a result.
			// sum(v ** 0.5 for v in [1, 2, 3]) = 1 + 1.414... + 1.732... = ~4.146
			// If only the first line was sent, we would NOT see this.
			await console.waitForConsoleContents('4.146', { timeout: 30000 });
		});
	});
});

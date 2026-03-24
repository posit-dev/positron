/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Notebook Statement Range', {
	tag: [tags.QUARTO, tags.ARK, tags.CONSOLE]
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

	// This test verifies that the notebook session's StatementRangeProvider
	// works for Quarto documents when no console session exists. It needs
	// its own test file (separate worker) so that sessions.deleteAll()
	// doesn't interfere with other tests that rely on the r fixture.
	test('R - Multi-line statement execution works within Quarto document', async function ({ app, openFile, sessions, hotKeys }) {
		const { editors, inlineQuarto } = app.workbench;

		await test.step('Shut down all running sessions', async () => {
			await sessions.deleteAll();
		});

		await test.step('Open Quarto document and run first cell to start notebook session', async () => {
			await openFile(join('workspaces', 'quarto_inline_output', 'multiple_statements.qmd'));
			await editors.waitForActiveTab('multiple_statements.qmd');
			await inlineQuarto.expectKernelStatusVisible();

			// Run the first cell to start the notebook R session
			await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 15 });
		});

		await test.step('Execute multi-line statement with Ctrl+Enter', async () => {
			// Position cursor on line 19: first line of the multi-line
			// statement: print(1 + \n    2 + \n    3)
			await inlineQuarto.gotoLine(19);

			// Ctrl+Enter should detect lines 19-21 as a single statement
			// via the notebook session's StatementRangeProvider (registered
			// for vdoc files). The Quarto extension's provider for 'quarto'
			// language delegates to 'r' providers by creating a vdoc. If
			// no provider matches the vdoc, only line 19 is sent and R
			// returns "Can't parse incomplete input".
			await hotKeys.runLineOfCode();

			// Navigate past the multi-line statement so the inline output
			// is visible, then verify the output.
			await inlineQuarto.gotoLine(22);

			// The second output (index 1) should contain the result of
			// print(1 + 2 + 3) = "[1] 6". If only line 19 was sent,
			// we'd see an error about incomplete input instead.
			await inlineQuarto.expectOutputContainsText('[1] 6', { index: 1, timeout: 30000 });
		});
	});
});

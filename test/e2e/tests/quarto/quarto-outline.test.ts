/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from './_test.setup';

test.use({
	suiteId: __filename
});

// With no Quarto session running, the console session's language server
// answers for the code cells. The Quarto extension nests those symbols under
// the chunk they came from. Checking the whole tree at once catches a second,
// flat "Quarto Code Cells" group, a symbol listed twice (posit-dev/positron#13907),
// and cell symbols missing because the first request was answered before the
// cell's language server was ready.
test.describe('Quarto - Outline', { tag: [tags.QUARTO, tags.OUTLINE] }, () => {

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.closeSecondarySidebar();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('R - Outline nests code cell symbols under their chunk', {
		tag: [tags.ARK]
	}, async function ({ app, openFile, sessions }) {
		const { editors, outline } = app.workbench;

		await sessions.start('r');
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_r.rmd'));
		await editors.waitForActiveTab('simple_r.rmd');
		await outline.focus();

		await expect.poll(() => outline.getOutlineRows()).toEqual([
			{ label: 'Basic Console Output', level: 1 },
			{ label: '(code cell)', level: 2 },
			{ label: 'x', level: 3 },
			{ label: 'y', level: 3 },
			{ label: 'df', level: 3 },
		]);
	});

	test('Python - Outline nests code cell symbols under their chunk', {
		tag: [tags.PYREFLY]
	}, async function ({ app, openFile, sessions }) {
		// Positron's own Python language server offers no document symbols, so
		// the cell symbols come from Pyrefly, which only the Pyrefly job enables.
		test.skip(process.env.ALLOW_PYREFLY !== 'true', 'Python cell symbols need Pyrefly (ALLOW_PYREFLY=true)');
		const { editors, outline } = app.workbench;

		await sessions.start('python');
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_py.qmd'));
		await editors.waitForActiveTab('simple_py.qmd');
		await outline.focus();

		await expect.poll(() => outline.getOutlineRows()).toEqual([
			{ label: 'Basic Console Output', level: 1 },
			{ label: '(code cell)', level: 2 },
			{ label: 'x', level: 3 },
			{ label: 'df', level: 3 },
		]);
	});
});

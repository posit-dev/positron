/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Kernel Auto-Start on Open', {
	tag: [tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Kernel starts automatically when opening a Quarto document', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file - the kernel should start automatically
		// without needing to run any code
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');

		// Verify the kernel becomes idle without running any code
		await inlineQuarto.expectKernelIdle(60000);
	});
});

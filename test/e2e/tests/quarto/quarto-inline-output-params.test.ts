/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

// The parameters.qmd fixture lives on the `feature/quarto-params` branch of
// qa-example-content; set `QA_REPO=feature/quarto-params` when running this
// test until that branch is merged to main.

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: R Params', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('R - Verify YAML params are bound and rendered as inline output', async function ({ app, openFile, r }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open the parameters Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'parameters.qmd'));
		await editors.waitForActiveTab('parameters.qmd');
		await inlineQuarto.expectKernelStatusVisible();
		await editors.clickTab('parameters.qmd');

		// Cell 1: `!r 6 * 7` -- exercises R expression evaluation in params
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 22, outputLine: 24 });
		await inlineQuarto.expectOutputContainsText('42', { index: 0 });

		// Cell 2: `params$alpha * params$ratio` -- exercises plain scalar params
		await inlineQuarto.gotoLine(30);
		await inlineQuarto.runCurrentCell();
		await inlineQuarto.expectOutputContainsText('0.01', { index: 1 });

		// Cell 3: `params$year` -- exercises the structured params form (with
		// `label`, `input`, etc.) where the binder must unwrap to `value`
		await inlineQuarto.gotoLine(38);
		await inlineQuarto.runCurrentCell();
		await inlineQuarto.expectOutputContainsText('2026', { index: 2 });
	});
});

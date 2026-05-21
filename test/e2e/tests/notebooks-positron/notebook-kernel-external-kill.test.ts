/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Kernel External Kill', {
	tag: [tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Python - detects kernel death and allows restart after external kill', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12869' }]
	}, async function ({ app }) {
		const { notebooksPositron } = app.workbench;

		await test.step('Create notebook and start Python kernel', async () => {
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
		});

		await test.step('Execute cell to confirm kernel is working and get PID', async () => {
			await notebooksPositron.addCodeToCell(0, 'import os; print(os.getpid())', { run: true });
			await expect(notebooksPositron.cellOutput(0)).toBeVisible({ timeout: 30000 });
		});

		const pid = await test.step('Read kernel PID from cell output', async () => {
			const outputText = await notebooksPositron.cellOutput(0).textContent();
			const parsed = parseInt(outputText!.trim(), 10);
			expect(parsed).toBeGreaterThan(0);
			return parsed;
		});

		await test.step('Kill kernel process externally (simulating OOM kill)', async () => {
			execSync(`kill -9 ${pid}`);
		});

		await test.step('Verify Positron detects kernel death', async () => {
			await notebooksPositron.kernel.expectStatusToBe('disconnected', 30000);
		});

		await test.step('Restart kernel and verify it recovers', async () => {
			await notebooksPositron.kernel.restart();
			await notebooksPositron.kernel.expectStatusToBe('idle', 30000);
		});

		await test.step('Execute code after restart to confirm kernel is functional', async () => {
			await notebooksPositron.addCodeToCell(1, 'print("recovered")', { run: true });
			await expect(notebooksPositron.cellOutput(1)).toContainText('recovered', { timeout: 30000 });
		});
	});

});

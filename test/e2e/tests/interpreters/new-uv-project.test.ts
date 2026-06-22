/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test as base, expect, tags } from '../_test.setup';
import * as fs from 'fs';

const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({ 'interpreters.startupBehavior': 'auto' });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

test.describe('New uv Environment', {
	tag: [tags.INTERPRETER]
}, () => {

	test.afterAll(async () => {
		const projPath = '/tmp/vscsmoke/qa-example-content/proj';
		try {
			await fs.promises.rm(projPath, { recursive: true, force: true });
			console.log(`Cleaned up test project: ${projPath}`);
		} catch (err) {
			console.warn(`Failed to delete ${projPath}:`, err);
		}
	});
	// This is skipped for windows because we can't get the text from the Terminal
	test('Python - Add new uv environment', async function ({ app, openFolder }) {

		test.skip(process.env.IS_OPENSUSE === 'true', 'Skip on openSuse');

		await app.workbench.terminal.clickTerminalTab();
		await app.workbench.terminal.createTerminal();

		await app.workbench.terminal.runCommandInTerminal('uv init proj');

		await app.workbench.terminal.waitForTerminalText('Initialized project');

		await app.workbench.terminal.runCommandInTerminal('cd proj');

		await app.workbench.terminal.runCommandInTerminal('uv sync');

		await app.workbench.terminal.waitForTerminalText('Creating virtual environment');

		await openFolder(path.join('qa-example-content/proj'));

		await app.workbench.console.waitForReady('>>>', 30000);

		await app.workbench.sessions.expectAllSessionsToBeReady();

		const metadata = await app.workbench.sessions.getMetadata();

		expect(metadata.source).toBe('uv');
		expect(metadata.path).toContain('qa-example-content/proj/.venv/bin/python');

	});
});

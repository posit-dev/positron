/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';
import * as fs from 'fs/promises';

test.use({
	suiteId: __filename
});

test.describe('New UV Environment', {
	tag: [tags.INTERPRETER]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({ 'interpreters.startupBehavior': 'auto' }, { reload: 'web' });
	});

	test.afterAll(async () => {
		const projPath = '/tmp/vscsmoke/qa-example-content/proj';
		try {
			await fs.rm(projPath, { recursive: true, force: true });
			console.log(`Cleaned up test project: ${projPath}`);
		} catch (err) {
			console.warn(`Failed to delete ${projPath}:`, err);
		}
	});
	// This is skipped for windows because we can't get the text from the Terminal
	test('Python - Add new UV environment', async function ({ app, openFolder }) {

		await app.positron.terminal.clickTerminalTab();

		await app.positron.terminal.runCommandInTerminal('uv init proj');

		await app.positron.terminal.waitForTerminalText('Initialized project');

		await app.positron.terminal.runCommandInTerminal('cd proj');

		await app.positron.terminal.runCommandInTerminal('uv sync');

		await app.positron.terminal.waitForTerminalText('Creating virtual environment');

		await openFolder(path.join('qa-example-content/proj'));

		await app.positron.console.waitForReady('>>>', 30000);

		await app.positron.sessions.expectAllSessionsToBeReady();

		const metadata = await app.positron.sessions.getMetadata();

		expect(metadata.source).toBe('Uv');
		expect(metadata.path).toContain('qa-example-content/proj/.venv/bin/python');

	});
});

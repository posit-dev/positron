/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

test.describe('Positron Assistant', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {
	test.beforeAll('How to set User Settings', async function ({ userSettings }) {
		// Need to turn on the assistant for these tests to work. Can remove once it's on by default.
		await userSettings.set([['positron.assistant.enable', 'true'],
		['positron.assistant.newModelConfiguration', 'true'],
		['positron.assistant.testModels', 'true']], true);
	});

	test('Verify Positron Assistant enabled', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.verifyAddModelButtonVisible();
	});

	test.skip('Antropic: Verfy Bad API key results in error', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/7291' }]
	}, async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickAddModelButton();
		await app.workbench.assistant.selectModelProvider('Anthropic');
		await app.workbench.assistant.enterApiKey('1234');
		await app.workbench.assistant.clickSignInButton();
		await expect(app.workbench.assistant.verifySignOutButtonVisible(5000)).rejects.toThrow();
		await app.workbench.assistant.clickDoneButton();
	});

	test('Echo: Verify Successful API Key Sign in and Sign Out', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickAddModelButton();
		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignInButton();
		await app.workbench.assistant.verifySignOutButtonVisible();
		await app.workbench.assistant.clickSignOutButton();
		await app.workbench.assistant.verifySignInButtonVisible();
		await app.workbench.assistant.clickDoneButton();
	});

	test('Verify Inline Chat opens', async function ({ app, openFile }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickAddModelButton();
		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignInButton();
		await app.workbench.assistant.clickDoneButton();
		await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
		await app.workbench.editor.clickOnTerm('chinook-sqlite.py', 'data_file_path', 4);
		await app.code.driver.page.keyboard.press('Control+I');
		await app.code.driver.page.locator('.chat-widget > .interactive-session').isVisible();
	});

});


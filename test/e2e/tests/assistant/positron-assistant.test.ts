/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { join } from 'path';

test.use({
	suiteId: __filename
});

/**
 * Test suite for the setup of Positron Assistant.
 */
test.fixme('Positron Assistant Setup', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {
	/**
	 * Verifies that Posit AI is the first provider in the Configure Providers modal.
	 * This ensures Posit AI has prominence as the default/recommended provider.
	 *
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Verify Posit AI is first provider in modal', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickConfigureProvidersButton();
		const providerNames = await app.workbench.assistant.getProviderButtonNames();
		expect(providerNames[0]).toBe('Posit AI');
		await app.workbench.assistant.clickCloseButton();
	});

	/**
	 * Verifies an error is returned when a bad api key is input.
	 *
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Anthropic: Verify Bad API key results in error', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickConfigureProvidersButton();
		await app.workbench.assistant.selectModelProvider('anthropic-api');
		await app.workbench.assistant.enterApiKey('1234');
		await app.workbench.assistant.clickSignInButton();
		await expect(app.workbench.assistant.verifySignOutButtonVisible(5000)).rejects.toThrow();
		await app.workbench.assistant.clickCloseButton();
	});

	/**
	 * Tests the sign in and sign out functionality for the Anthropic model provider.
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Anthropic: Verify Successful API Key Sign in and Sign Out', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('anthropic-api');
		await app.workbench.assistant.logoutModelProvider('anthropic-api');
	});

	/**
	 * Tests the sign in and sign out functionality for the OpenAI model provider.
	 * @param app - Application fixture providing access to UI elements
	 */
	test('OpenAI: Verify Successful API Key Sign in and Sign Out', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('openai-api');
		await app.workbench.assistant.logoutModelProvider('openai-api');
	});

	/**
	 * Tests the sign in and sign out functionality for the Amazon Bedrock model provider.
	 * @param app - Application fixture providing access to UI elements
	 * currently skipped as a TODO to finsih implementation of bedrock auth
	 */
	test('Amazon Bedrock: Verify Successful Sign in and Sign Out', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('amazon-bedrock');
		await app.workbench.assistant.logoutModelProvider('amazon-bedrock');
	});

	/**
	 * Tests the sign in and sign out functionality for the Posit AI model provider.
	 * This test uses OAuth device code flow with Posit's auth server and requires:
	 * - POSIT_EMAIL: Posit account email
	 * - POSIT_PASSWORD: Posit account password
	 * - POSIT_AUTH_HOST: Posit auth server URL (e.g., https://login.posit.cloud)
	 *
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Posit AI: Verify Successful OAuth Sign in and Sign Out', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('posit-ai');
		await app.workbench.assistant.logoutModelProvider('posit-ai');
	});

	/**
	 * Tests that the inline chat functionality can be opened within a code file.
	 * It uses the chinoook-sqlite.py file and simply checks that the chat widget is visible.
	 *
	 * @param app - Application fixture providing access to UI elements
	 * @param openFile - Helper function to open a file in the editor
	 */
	test('Verify Inline Chat opens', async function ({ app, openFile }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('echo');
		await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
		await app.workbench.editor.clickOnTerm('chinook-sqlite.py', 'data_file_path', 4);
		const inlineChatShortcut = process.platform === 'darwin' ? 'Meta+I' : 'Control+I';
		await app.code.driver.currentPage.keyboard.press(inlineChatShortcut);
		await app.code.driver.currentPage.locator('.chat-widget > .interactive-session').isVisible();
		await app.workbench.assistant.verifyInlineChatInputsVisible();
		await app.workbench.assistant.logoutModelProvider('echo');
		await app.workbench.assistant.closeInlineChat();
	});

	test('Verify Authentication Type When Switching Providers', async function ({ app }) {
		await app.workbench.assistant.runConfigureProviders();
		await app.workbench.assistant.selectModelProvider('Copilot');
		await app.workbench.assistant.verifyAuthMethod('oauth');
		await app.workbench.assistant.selectModelProvider('anthropic-api');
		await app.workbench.assistant.verifyAuthMethod('apiKey');
		await app.workbench.assistant.clickCloseButton();
	});

});
/**
 * Test suite Positron Assistant actions from the chat interface.
 */
test.describe.skip('Positron Assistant Chat Editing', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {
	test.beforeAll('Enable Assistant', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('echo');
	});

	test.beforeEach('How to clear chat', async function ({ app }) {
		await app.workbench.assistant.clickNewChatButton();
	});

	test.afterAll('Sign out of Assistant', async function ({ app }) {
		await expect(async () => {
			await app.workbench.assistant.logoutModelProvider('echo');
		}).toPass({ timeout: 30000 });
	});
	/**
	 * Tests that Python code from chat responses can be executed in the console.
	 * Verifies that code execution creates the expected variable with the correct value.
	 *
	 * @param app - Application fixture providing access to UI elements
	 * @param python - Fixture that starts the python session.
	 */
	// Skipping Console tests due to PR #10784
	test.skip('Python: Verify running code in console from chat markdown response', { tag: [] }, async function ({ app, python }) {
		await app.workbench.assistant.sendChatMessageAndWait('Send Python Code');
		await app.workbench.assistant.verifyCodeBlockActions();
		await app.workbench.assistant.clickChatCodeRunButton('foo = 100');
		await app.workbench.console.waitForConsoleContents('foo = 100');
		await app.workbench.variables.expectVariableToBe('foo', '100');
	});

	/**
	 * Test that R code from chat responses can be executed in the console.
	 * Verifies that code execution creates the expected variable with the correct value.
	 *
	 * @param app - Application fixture providing access to UI elements
	 * @param r - Fixture that starts the R session.
	 */
	// Skipping Console tests due to PR #10784
	test.skip('R: Verify running code in console from chat markdown response', { tag: [tags.CRITICAL] }, async function ({ app, r }) {
		await app.workbench.assistant.sendChatMessageAndWait('Send R Code');
		await app.workbench.assistant.verifyCodeBlockActions();
		await app.workbench.assistant.clickChatCodeRunButton('foo <- 200');
		await app.workbench.console.waitForConsoleContents('foo <- 200');
		await app.workbench.variables.expectVariableToBe('foo', '200');
	});

	test('Verify Manage Models is available', { tag: [tags.SOFT_FAIL] }, async function ({ app, page }) {
		// sometimes the menu closes due to language model loading (?), so retry
		await expect(async () => {
			await app.workbench.assistant.pickModel();
			await app.workbench.assistant.expectManageModelsVisible();
			await page.keyboard.press('Escape');
		}).toPass({ timeout: 30000 });
	});
});

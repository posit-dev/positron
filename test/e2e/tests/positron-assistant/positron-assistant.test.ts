/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
test.describe('Positron Assistant Setup', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB, tags.CRITICAL] }, () => {
	/**
	 * Verifies that the Positron Assistant can be opened and that the
	 * add model button is visible in the interface. Once Assistant is on by default,
	 * this test can be removed.
	 *
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Verify Positron Assistant enabled', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.verifyAddModelButtonVisible();
	});


	/**
	 * Verifies an error is returned when a bad api key is input.
	 *
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Anthropic: Verify Bad API key results in error', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickAddModelButton();
		await app.workbench.assistant.selectModelProvider('Anthropic');
		await app.workbench.assistant.enterApiKey('1234');
		await app.workbench.assistant.clickSignInButton();
		await expect(app.workbench.assistant.verifySignOutButtonVisible(5000)).rejects.toThrow();
		await app.workbench.assistant.clickCloseButton();
		await app.code.driver.page.locator('.positron-button:has-text("Yes")').click();
	});

	/**
	 * Tests the sign in and sign out functionality for a model provider.
	 * This uses the test Echo provider as there is not a valid API key for the other providers.
	 *
	 * @param app - Application fixture providing access to UI elements
	 */
	test('Echo: Verify Successful API Key Sign in and Sign Out', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickAddModelButton();
		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignInButton();
		await app.workbench.assistant.verifySignOutButtonVisible();
		await app.workbench.assistant.clickSignOutButton();
		await app.workbench.assistant.verifySignInButtonVisible();
		await app.workbench.assistant.clickCloseButton();
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
		await app.workbench.assistant.clickAddModelButton();
		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignInButton();
		await app.workbench.assistant.clickCloseButton();
		await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));
		await app.workbench.editor.clickOnTerm('chinook-sqlite.py', 'data_file_path', 4);
		const inlineChatShortcut = process.platform === 'darwin' ? 'Meta+I' : 'Control+I';
		await app.code.driver.page.keyboard.press(inlineChatShortcut);
		await app.code.driver.page.locator('.chat-widget > .interactive-session').isVisible();
		await app.workbench.assistant.verifyInlineChatInputsVisible();
		await app.workbench.quickaccess.runCommand('positron-assistant.configureModels');
		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignOutButton();
		await app.workbench.assistant.clickCloseButton();
		await app.workbench.assistant.closeInlineChat();
	});

	test('Verify Authentication Type When Switching Providers', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.clickAddModelButton();
		await app.workbench.assistant.selectModelProvider('Copilot');
		await app.workbench.assistant.verifyAuthMethod('oauth');
		await app.workbench.assistant.selectModelProvider('Anthropic');
		await app.workbench.assistant.verifyAuthMethod('apiKey');
		await app.workbench.assistant.clickCloseButton();
	});

});
/**
 * Test suite Positron Assistant actions from the chat interface.
 */
test.describe('Positron Assistant Chat Editing', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB, tags.CRITICAL] }, () => {
	test.beforeAll('Enable Assistant', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.quickaccess.runCommand('positron-assistant.configureModels');

		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignInButton();
		await app.workbench.assistant.clickCloseButton();
	});

	test.beforeEach('How to clear chat', async function ({ app }) {
		await app.workbench.assistant.clickNewChatButton();
	});

	test.afterAll('Sign out of Assistant', async function ({ app }) {
		await app.workbench.quickaccess.runCommand('positron-assistant.configureModels');
		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignOutButton();
		await app.workbench.assistant.clickCloseButton();
	});
	/**
	 * Tests that Python code from chat responses can be executed in the console.
	 * Verifies that code execution creates the expected variable with the correct value.
	 *
	 * @param app - Application fixture providing access to UI elements
	 * @param python - Fixture that starts the python session.
	 */
	test('Python: Verify running code in console from chat markdown response', async function ({ app, python }) {
		await app.workbench.assistant.enterChatMessage('Send Python Code');
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
	test('R: Verify running code in console from chat markdown response', async function ({ app, r }) {
		await app.workbench.assistant.enterChatMessage('Send R Code');
		await app.workbench.assistant.verifyCodeBlockActions();
		await app.workbench.assistant.clickChatCodeRunButton('foo <- 200');
		await app.workbench.console.waitForConsoleContents('foo <- 200');
		await app.workbench.variables.expectVariableToBe('foo', '200');
	});
});

// Skipping web. See https://github.com/posit-dev/positron/issues/8568
test.describe('Positron Assistant Chat Tokens', { tag: [tags.WIN, tags.ASSISTANT, tags.CRITICAL] }, () => {
	test.beforeAll('Enable Assistant', async function ({ app, settings }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.quickaccess.runCommand('positron-assistant.configureModels');
		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignInButton();
		await app.workbench.assistant.clickCloseButton();
	});

	test.beforeEach('Clear chat', async function ({ app, settings }) {
		await settings.set({ 'positron.assistant.showTokenUsage.enable': true });
		await app.workbench.assistant.clickNewChatButton();
		await settings.set({ 'positron.assistant.approximateTokenCount': ['echo'] });
	});

	test.afterAll('Sign out of Assistant', async function ({ app }) {
		await app.workbench.quickaccess.runCommand('positron-assistant.configureModels');
		await app.workbench.assistant.selectModelProvider('echo');
		await app.workbench.assistant.clickSignOutButton();
		await app.workbench.assistant.clickCloseButton();
	});

	test('Token usage is displayed in chat response', async function ({ app }) {
		const message = 'What is the meaning of life?';
		await app.workbench.assistant.enterChatMessage(message);
		await app.workbench.assistant.verifyTokenUsageVisible();
		const tokenUsage = await app.workbench.assistant.getTokenUsage();
		expect(tokenUsage).toMatchObject({
			inputTokens: message.length,
			outputTokens: message.length
		});
	});

	test('Token usage is not displayed when setting is disabled', async function ({ app, settings }) {
		await settings.set({ 'positron.assistant.showTokenUsage.enable': false });
		await app.workbench.assistant.enterChatMessage('What is the meaning of life?');

		expect(await app.workbench.assistant.verifyTokenUsageNotVisible());
	});

	test('Token usage is not displayed for non-supported providers', async function ({ app, settings }) {
		await settings.set({ 'positron.assistant.approximateTokenCount': [] });
		await app.workbench.assistant.enterChatMessage('What is the meaning of life?');

		expect(await app.workbench.assistant.verifyTokenUsageNotVisible());
	});

	test('Token usage updates when settings change', async function ({ app, settings }) {
		await app.workbench.assistant.enterChatMessage('What is the meaning of life?');
		await app.workbench.assistant.verifyTokenUsageVisible();

		await settings.set({ 'positron.assistant.approximateTokenCount': [] });
		expect(await app.workbench.assistant.verifyTokenUsageNotVisible());

		await settings.set({ 'positron.assistant.approximateTokenCount': ['echo'] });
		await app.workbench.assistant.verifyTokenUsageVisible();

		await settings.set({ 'positron.assistant.showTokenUsage.enable': false });
		expect(await app.workbench.assistant.verifyTokenUsageNotVisible());

		await settings.set({ 'positron.assistant.showTokenUsage.enable': true });
		await app.workbench.assistant.verifyTokenUsageVisible();
	});

	// Skipping for now; race condition waiting for token usage to be updated.
	// Only reports tokens used by first message.
	test('Total token usage is displayed in chat header', async function ({ app }) {
		const message1 = 'What is the meaning of life?';
		const message2 = 'Forty-two';

		await app.workbench.assistant.enterChatMessage(message1);
		await app.workbench.assistant.waitForReadyToSend();
		await app.workbench.assistant.enterChatMessage(message2);

		await app.workbench.assistant.waitForReadyToSend();
		await app.workbench.assistant.verifyNumberOfVisibleResponses(2, true);

		const totalTokens = await app.workbench.assistant.getTotalTokenUsage();
		expect(totalTokens).toBeDefined();
		expect(totalTokens).toMatchObject({
			inputTokens: message1.length + message2.length,
			outputTokens: message1.length + message2.length
		});
	});
});

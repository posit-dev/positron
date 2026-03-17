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
test.describe('Positron Assistant Setup', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {
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
test.describe('Positron Assistant Chat Editing', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {
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

/**
 * Test suite for the model picker default indicator feature.
 * Verifies that models configured as default show "(default)" suffix.
 * @see https://github.com/posit-dev/positron/issues/11166
 * @see https://github.com/posit-dev/positron/pull/11299
 */
test.describe('Positron Assistant Model Picker Default Indicator', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {
	test.beforeAll('Enable Assistant and sign in to Echo provider', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('echo');
	});

	test.afterAll('Sign out of Assistant', async function ({ app }) {
		await expect(async () => {
			await app.workbench.assistant.logoutModelProvider('echo');
		}).toPass({ timeout: 30000 });
	});

	/**
	 * Test Case 1: Single Provider with Default Model
	 * Verifies that when a user configures a default model for a provider:
	 * 1. The model picker shows "(default)" suffix next to the model name
	 * 2. The default model appears first in the vendor group
	 */
	test('Verify default model indicator and ordering for single provider', async function ({ settings, assistant }) {
		// Configure the Echo Language Model v2 as the default for the echo provider
		await settings.set({
			'positron.assistant.models.preference.echo': 'Echo Language Model v2'
		}, { reload: true });

		// Open the model picker dropdown
		await assistant.pickModel();

		// Verify that Echo Language Model v2 shows "(default)" suffix
		await assistant.expectModelInPicker('Echo Language Model v2 (default)');

		// Verify that the other Echo model does NOT have "(default)" suffix
		await assistant.expectModelInPicker(/^Echo$/);

		// Verify default model appears first in vendor group
		const echoModels = await assistant.getModelPickerItemsForVendor('Echo');
		expect(echoModels.length).toBeGreaterThanOrEqual(2);
		expect(echoModels[0].label).toBe('Echo Language Model v2 (default)');

		// Close the dropdown
		await assistant.closeModelPickerDropdown();

		// Clean up: reset the setting
		await settings.set({
			'positron.assistant.models.preference.echo': ''
		});
	});

});

/**
 * Test suite for the model picker default indicator with multiple providers.
 * Uses loginModelProvider which handles auto-sign-in detection:
 * - If ANTHROPIC_API_KEY is set, Anthropic is auto-signed-in (no manual steps needed)
 * - If ANTHROPIC_KEY is set, signs in manually using API key
 * @see https://github.com/posit-dev/positron/issues/11166
 * @see https://github.com/posit-dev/positron/pull/11299
 */
test.describe('Positron Assistant Model Picker Default Indicator - Multiple Providers', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {
	test.beforeAll('Enable Assistant and sign in to providers', async function ({ app }) {
		await app.workbench.assistant.openPositronAssistantChat();
		await app.workbench.assistant.loginModelProvider('echo');
	});

	test.afterAll('Sign out of providers and clean up', async function ({ app, settings }) {
		// Clean up settings
		await settings.set({
			'positron.assistant.models.preference.anthropic': '',
			'positron.assistant.models.preference.echo': ''
		});

		// Sign out of providers (methods handle auto-sign-in detection)
		await expect(async () => {
			await app.workbench.assistant.logoutModelProvider('echo');
		}).toPass({ timeout: 30000 });

		await expect(async () => {
			await app.workbench.assistant.logoutModelProvider('anthropic-api');
		}).toPass({ timeout: 30000 });
	});

	/**
	 * Test Case 2: Multiple Providers with Different Defaults
	 * Verifies that when a user configures default models for multiple providers:
	 * 1. Each provider shows its respective default model with "(default)" suffix
	 * 2. Each default model appears first in its provider group
	 */
	test('Verify default model indicators and ordering for multiple providers', async function ({ settings, assistant }) {
		// Configure defaults for both Anthropic and Echo providers
		await settings.set({
			'positron.assistant.models.preference.anthropic': 'Claude Haiku 4.5',
			'positron.assistant.models.preference.echo': 'Echo Language Model v2'
		}, { reload: true });

		// Sign in to Anthropic (method handles auto-sign-in detection)
		await assistant.loginModelProvider('anthropic-api');
		await assistant.pickModel();

		// Verify Anthropic default - Claude Haiku 4.5 should have "(default)"
		await assistant.expectModelInPicker('Claude Haiku 4.5 (default)');

		// Verify other Anthropic models do NOT have "(default)"
		await assistant.expectModelInPicker(/^Claude Sonnet 4$/);

		// Verify Echo default - Echo Language Model v2 should have "(default)"
		await assistant.expectModelInPicker('Echo Language Model v2 (default)');

		// Verify other Echo model does NOT have "(default)"
		await assistant.expectModelInPicker(/^Echo$/);

		// Verify vendor separators are visible
		await assistant.expectVendorSeparator('Anthropic');
		await assistant.expectVendorSeparator('Echo');

		// Verify ordering by getting all model items and checking vendor group order
		const anthropicModels = await assistant.getModelPickerItemsForVendor('Anthropic');
		expect(anthropicModels.length).toBeGreaterThanOrEqual(2);
		expect(anthropicModels[0].label).toBe('Claude Haiku 4.5 (default)');

		const echoModels = await assistant.getModelPickerItemsForVendor('Echo');
		expect(echoModels.length).toBeGreaterThanOrEqual(2);
		expect(echoModels[0].label).toBe('Echo Language Model v2 (default)');

		// Close dropdown
		await assistant.closeModelPickerDropdown();
	});
});

// Test suite for verifying token usage is displayed.
test.describe('Positron Assistant Chat Tokens', { tag: [tags.WIN, tags.ASSISTANT] }, () => {
	test.beforeAll('Enable Assistant', async function ({ assistant }) {
		await assistant.openPositronAssistantChat();
		await assistant.loginModelProvider('echo');
	});

	test.beforeEach('Clear chat', async function ({ app, settings }) {
		await settings.set({ 'positron.assistant.showTokenUsage.enable': true }, { reload: 'web' });
		await app.workbench.assistant.clickNewChatButton();
		await settings.set({ 'positron.assistant.approximateTokenCount': ['echo'] }, { reload: 'web' });
	});

	test.afterAll('Sign out of Assistant', async function ({ app }) {
		await app.workbench.assistant.logoutModelProvider('echo');
	});

	test('Token usage is displayed in chat response', async function ({ app, assistant }) {
		const message = 'What is the meaning of life?';
		await assistant.sendChatMessageAndWait(message);
		await assistant.verifyTokenUsageVisible();
		const tokenUsage = await assistant.getTokenUsage();
		expect(tokenUsage).toMatchObject({
			inputTokens: message.length,
			outputTokens: message.length
		});
	});

	test('Token usage is not displayed when setting is disabled', async function ({ app, settings, assistant }) {
		await settings.set({ 'positron.assistant.showTokenUsage.enable': false }, { reload: 'web' });
		await assistant.sendChatMessageAndWait('What is the meaning of life?');

		expect(await assistant.verifyTokenUsageNotVisible());
	});

	test('Token usage is not displayed for non-supported providers', async function ({ app, settings, assistant }) {
		await settings.set({ 'positron.assistant.approximateTokenCount': [] }, { reload: 'web' });
		await assistant.sendChatMessageAndWait('What is the meaning of life?');

		expect(await assistant.verifyTokenUsageNotVisible());
	});

	test('Token usage updates when settings change', async function ({ app, settings, assistant }) {
		await assistant.sendChatMessageAndWait('What is the meaning of life?');
		await assistant.verifyTokenUsageVisible();

		await settings.set({ 'positron.assistant.approximateTokenCount': [] }, { reload: 'web' });
		expect(await assistant.verifyTokenUsageNotVisible());

		await settings.set({ 'positron.assistant.approximateTokenCount': ['echo'] }, { reload: 'web' });
		await assistant.verifyTokenUsageVisible();

		await settings.set({ 'positron.assistant.showTokenUsage.enable': false }, { reload: 'web' });
		expect(await assistant.verifyTokenUsageNotVisible());

		await settings.set({ 'positron.assistant.showTokenUsage.enable': true }, { reload: 'web' });
		await assistant.verifyTokenUsageVisible();
	});

	// Only reports tokens used by first message.
	test('Total token usage is displayed in chat header', async function ({ app, assistant }) {
		const message1 = 'What is the meaning of life?';
		const message2 = 'Forty-two';

		await assistant.sendChatMessageAndWait(message1);
		await assistant.sendChatMessageAndWait(message2);

		const totalTokens = await assistant.getTotalTokenUsage();
		expect(totalTokens).toBeDefined();
		expect(totalTokens).toMatchObject({
			inputTokens: message1.length + message2.length,
			outputTokens: message1.length + message2.length
		});
	});
});

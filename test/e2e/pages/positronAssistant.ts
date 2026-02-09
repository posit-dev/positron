/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect, test } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { Toasts } from './dialog-toasts';
import { Modals } from './dialog-modals.js';

const CHAT_BUTTON = '.action-label.codicon-positron-assistant[aria-label^="Chat"]';
const CONFIGURE_PROVIDERS_LINK = 'a[data-href="command:positron-assistant.configureProviders"]';
const CONFIGURE_PROVIDERS_BUTTON = 'div.action-widget a[aria-label="Add and Configure Language Model Providers"]';
const APIKEY_INPUT = '#api-key-input input.text-input[type="password"]';
const CLOSE_BUTTON = 'button.positron-button.action-bar-button.default:has-text("Close")';
const SIGN_IN_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign in")';
const SIGN_OUT_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign out")';
const ANTHROPIC_BUTTON = 'button.positron-button.language-model.button:has(#anthropic-api-provider-button)';
const AWS_BEDROCK_BUTTON = 'button.positron-button.language-model.button:has(#amazon-bedrock-provider-button)';
const ECHO_MODEL_BUTTON = 'button.positron-button.language-model.button:has(div.codicon-info)';
const ERROR_MODEL_BUTTON = 'button.positron-button.language-model.button:has(div.codicon-error)';
const COPILOT_BUTTON = 'button.positron-button.language-model.button:has(#copilot-auth-provider-button)';
const OPENAI_BUTTON = 'button.positron-button.language-model.button:has(#openai-api-provider-button)';
const CHAT_PANEL = '#workbench\\.panel\\.chat';
const RUN_BUTTON = 'a.action-label.codicon.codicon-play[role="button"][aria-label="Run in Console"]';
const APPLY_IN_EDITOR_BUTTON = 'a.action-label.codicon.codicon-git-pull-request-go-to-changes[role="button"][aria-label="Apply in Editor"]';
const INSERT_AT_CURSOR_BUTTON = 'a.action-label.codicon.codicon-insert[role="button"][aria-label^="Insert At Cursor"]';
const COPY_BUTTON = 'a.action-label.codicon.codicon-copy[role="button"][aria-label="Copy"]';
const INSERT_NEW_FILE_BUTTON = 'a.action-label.codicon.codicon-new-file[role="button"][aria-label="Insert into New File"]';
const KEEP_BUTTON = 'a.action-label[role="button"][aria-label^="Keep Chat Edits"]';
const OAUTH_RADIO = '.language-model-authentication-method-container input#oauth[type="radio"]';
const APIKEY_RADIO = '.language-model-authentication-method-container input#apiKey[type="radio"]';
const CHAT_INPUT = '.chat-editor-container .interactive-input-editor .native-edit-context';
const SEND_MESSAGE_BUTTON = '.actions-container .action-label.codicon-send[aria-label^="Send"]';
const NEW_CHAT_BUTTON = '.composite.title .actions-container[aria-label="Chat actions"] .action-item .action-label.codicon-plus[aria-label^="New Chat"]';
const INLINE_CHAT_TOOLBAR = '.interactive-input-part.compact .chat-input-toolbars';
const MODE_DROPDOWN = 'a.action-label[aria-label^="Set Agent"]';
const MODE_DROPDOWN_ITEM = '.monaco-list-row[role="menuitemcheckbox"]';
const MODEL_PICKER_DROPDOWN = '.action-item.chat-modelPicker-item .monaco-dropdown .dropdown-label a.action-label[aria-label*="Pick Model"]';
const MODEL_PICKER_LABEL = `${MODEL_PICKER_DROPDOWN} span.chat-model-label`;
const MODEL_DROPDOWN_ITEM = '.monaco-list-row[role="menuitemcheckbox"]';
const MANAGE_MODELS_ITEM = '.action-widget a.action-label[aria-label="Manage Language Models"]';

/**
 * Supported model providers for the Positron Assistant.
 */
export type ModelProvider =
	| 'anthropic-api'
	| 'amazon-bedrock'
	| 'Copilot'
	| 'echo'
	| 'error'
	| 'openai-api';

/**
 * Authentication types for model providers.
 */
type ProviderAuthType = 'none' | 'apiKey' | 'aws';

/**
 * Options for the loginModelProvider method.
 */
export interface LoginModelProviderOptions {
	/** API key for providers that support API key authentication */
	apiKey?: string;
	/** Timeout for verifying sign-in success (default: 15000ms) */
	timeout?: number;
}

/**
 * Returns the authentication type for a given model provider.
 */
function getProviderAuthType(provider: ModelProvider): ProviderAuthType {
	switch (provider.toLowerCase()) {
		case 'echo':
		case 'error':
			return 'none';
		case 'anthropic-api':
		case 'openai-api':
			return 'apiKey';
		case 'amazon-bedrock':
			return 'aws';
		default:
			throw new Error(`Unknown provider: ${provider}`);
	}
}

/**
 * Returns the environment variable name for a provider's API key.
 */
function getProviderEnvVarName(provider: ModelProvider): string {
	switch (provider.toLowerCase()) {
		case 'anthropic-api':
			return 'ANTHROPIC_KEY';
		case 'openai-api':
			return 'OPENAI_KEY';
		default:
			return `${provider.toUpperCase().replace(/-/g, '_')}_KEY`;
	}
}

/**
 * Returns the API key from environment variables for a given provider.
 */
function getProviderEnvKey(provider: ModelProvider): string | undefined {
	const envVarName = getProviderEnvVarName(provider);
	return process.env[envVarName];
}

/**
 * Returns the environment variable name that triggers auto-sign-in for a provider.
 * When these env vars are set, Positron automatically signs into the provider on startup.
 */
function getProviderAutoSignInEnvVarName(provider: ModelProvider): string | undefined {
	switch (provider.toLowerCase()) {
		case 'anthropic-api':
			return 'ANTHROPIC_API_KEY';
		case 'openai-api':
			return 'OPENAI_API_KEY';
		default:
			return undefined;
	}
}

/**
 * Returns true if the provider is auto-signed-in via environment variable.
 * When certain env vars are set (e.g., ANTHROPIC_API_KEY), Positron automatically
 * signs into the provider on startup, so no manual sign-in is required.
 */
function isProviderAutoSignedIn(provider: ModelProvider): boolean {
	const envVarName = getProviderAutoSignInEnvVarName(provider);
	return envVarName ? !!process.env[envVarName] : false;
}

/*
 *  Reuseable Positron Assistant functionality for tests to leverage.
 */
export class Assistant {

	constructor(private code: Code, private quickaccess: QuickAccess, private toasts: Toasts, private modals: Modals) { }

	async verifyChatButtonVisible() {
		await expect(this.code.driver.page.locator(CHAT_BUTTON)).toBeVisible();
	}

	async openPositronAssistantChat() {
		await test.step('Verify Assistant is enabled and Open it.', async () => {
			await this.verifyChatButtonVisible();
			const addModelLinkIsVisible = await this.code.driver.page.locator(CHAT_PANEL).isVisible();
			if (!addModelLinkIsVisible) {
				await this.code.driver.page.locator(CHAT_BUTTON).click();
			}
		});
	}

	async closeInlineChat() {
		await test.step('Close Inline Chat', async () => {
			this.code.driver.page.getByRole('button', { name: 'Close (Escape)' }).click();
		});
	}

	async runConfigureProviders() {
		await this.quickaccess.runCommand('positron-assistant.configureProviders');
	}

	async clickConfigureProvidersLink() {
		await this.code.driver.page.locator(CONFIGURE_PROVIDERS_LINK).click();
	}

	async clickAddModelButton() {
		// Ensure chat panel is open first
		const chatPanelIsVisible = await this.code.driver.page.locator(CHAT_PANEL).isVisible();
		if (!chatPanelIsVisible) {
			await this.openPositronAssistantChat();
		}

		const configureProvidersLinkIsVisible = await this.code.driver.page.locator(CONFIGURE_PROVIDERS_LINK).isVisible();
		if (!configureProvidersLinkIsVisible) {
			await this.code.driver.page.locator(MODEL_PICKER_DROPDOWN).click();
		}
		await this.code.driver.page.locator(CONFIGURE_PROVIDERS_BUTTON).click({ force: true });
	}

	async verifyConfigureProvidersButtonVisible() {
		await this.code.driver.page.locator(MODEL_PICKER_DROPDOWN).click();
		await expect(this.code.driver.page.locator(CONFIGURE_PROVIDERS_BUTTON)).toBeVisible();
		await expect(this.code.driver.page.locator(CONFIGURE_PROVIDERS_BUTTON)).toHaveText('Configure Model Providers...');
	}

	async verifyInlineChatInputsVisible() {
		await expect(this.code.driver.page.locator(INLINE_CHAT_TOOLBAR)).toBeVisible();
		await expect(this.code.driver.page.locator(INLINE_CHAT_TOOLBAR)).toBeInViewport({ ratio: 1 });
	}

	async verifyCodeBlockActions() {
		await expect(this.code.driver.page.locator(RUN_BUTTON)).toHaveCount(1);
		// PR #10784: "Apply in Editor" button may be disabled depending on model chosen and user settings
		await expect(await this.code.driver.page.locator(APPLY_IN_EDITOR_BUTTON).count()).toBeLessThanOrEqual(1);
		await expect(this.code.driver.page.locator(INSERT_AT_CURSOR_BUTTON)).toHaveCount(1);
		await expect(this.code.driver.page.locator(COPY_BUTTON)).toHaveCount(1);
		await expect(this.code.driver.page.locator(INSERT_NEW_FILE_BUTTON)).toHaveCount(1);
	}

	async pickModel() {
		// Wait until some models are loaded before clicking (label changes from "Pick Model" to an actual model name)
		await expect(this.code.driver.page.locator(MODEL_PICKER_LABEL)).not.toHaveText('Pick Model');
		await this.code.driver.page.locator(MODEL_PICKER_DROPDOWN).click();
	}

	async expectManageModelsVisible() {
		await expect(this.code.driver.page.locator(MANAGE_MODELS_ITEM)).toBeVisible({ timeout: 3000 });
	}

	async selectModelProvider(provider: ModelProvider) {
		switch (provider.toLowerCase()) {
			case 'anthropic-api':
				await this.code.driver.page.locator(ANTHROPIC_BUTTON).click();
				break;
			case 'amazon-bedrock':
				await this.code.driver.page.locator(AWS_BEDROCK_BUTTON).click();
				break;
			case 'copilot':
				await this.code.driver.page.locator(COPILOT_BUTTON).click();
				break;
			case 'echo':
				await this.code.driver.page.locator(ECHO_MODEL_BUTTON).click();
				break;
			case 'error':
				await this.code.driver.page.locator(ERROR_MODEL_BUTTON).click();
				break;
			case 'openai-api':
				await this.code.driver.page.locator(OPENAI_BUTTON).click();
				break;
			default:
				throw new Error(`Unsupported model provider: ${provider}`);
		}
	}

	/**
	 * Signs in to a model provider with the appropriate authentication method.
	 * This method handles opening the configuration dialog, selecting the provider,
	 * performing authentication, and closing the dialog.
	 *
	 * If the provider is auto-signed-in via environment variable (e.g., ANTHROPIC_API_KEY),
	 * the sign-in steps are skipped.
	 *
	 * @param provider - The model provider to sign in to
	 * @param options - Optional configuration for the login process
	 * @param options.apiKey - API key for providers that support API key authentication.
	 *                         If not provided, uses environment variables (ANTHROPIC_KEY, OPENAI_KEY, etc.)
	 * @param options.timeout - Timeout for verifying sign-in success (default: 15000ms)
	 *
	 * @example
	 * // Sign in to Echo provider (no credentials needed)
	 * await assistant.loginModelProvider('echo');
	 *
	 * @example
	 * // Sign in to Anthropic with environment variable
	 * await assistant.loginModelProvider('anthropic-api');
	 *
	 * @example
	 * // Sign in to OpenAI with explicit API key
	 * await assistant.loginModelProvider('openai-api', { apiKey: 'sk-...' });
	 */
	async loginModelProvider(provider: ModelProvider, options: LoginModelProviderOptions = {}) {
		const { timeout = 15000 } = options;

		// Check if provider is auto-signed-in via environment variable
		if (isProviderAutoSignedIn(provider)) {
			// Provider is already signed in via env var, no action needed
			return;
		}

		await test.step(`Sign in to ${provider} model provider`, async () => {
			// Open the model configuration dialog
			await this.clickAddModelButton();

			// Select the provider
			await this.selectModelProvider(provider);

			// Check if already signed in (Sign Out button visible)
			const alreadySignedIn = await this.code.driver.page.locator(SIGN_OUT_BUTTON).isVisible();
			if (alreadySignedIn) {
				// Already signed in, just close the dialog
				await this.clickCloseButton();
				return;
			}

			// Handle authentication based on provider type
			const authType = getProviderAuthType(provider);

			switch (authType) {
				case 'none':
					// Providers like echo/error just need sign-in click
					await this.clickSignInButton();
					break;

				case 'apiKey': {
					// Get API key from options or environment variable
					const apiKey = options.apiKey ?? getProviderEnvKey(provider);
					if (!apiKey) {
						throw new Error(
							`No API key provided for ${provider}. ` +
							`Set the ${getProviderEnvVarName(provider)} environment variable or pass apiKey in options.`
						);
					}
					await this.enterApiKey(apiKey);
					await this.clickSignInButton();
					break;
				}

				case 'aws':
					// AWS Bedrock - additional steps TBD
					// Will be gated by conditional statements later
					await this.clickSignInButton();
					break;

				default:
					throw new Error(`Unknown authentication type for provider: ${provider}`);
			}

			// Verify sign-in was successful
			await this.verifySignOutButtonVisible(timeout);

			// Close the configuration dialog
			await this.clickCloseButton();
		});
	}

	/**
	 * Signs out from a model provider.
	 * This method handles opening the configuration dialog, selecting the provider,
	 * signing out, and closing the dialog.
	 *
	 * If the provider is auto-signed-in via environment variable (e.g., ANTHROPIC_API_KEY),
	 * the sign-out steps are skipped since we didn't manually sign in.
	 *
	 * @param provider - The model provider to sign out from
	 * @param options - Optional configuration for the logout process
	 * @param options.timeout - Timeout for verifying sign-out success (default: 15000ms)
	 */
	async logoutModelProvider(provider: ModelProvider, options: { timeout?: number } = {}) {
		const { timeout = 15000 } = options;

		// Check if provider is auto-signed-in via environment variable
		// If so, we didn't manually sign in, so no need to sign out
		if (isProviderAutoSignedIn(provider)) {
			return;
		}

		await test.step(`Sign out from ${provider} model provider`, async () => {
			await this.runConfigureProviders();
			await this.selectModelProvider(provider);
			await this.clickSignOutButton();
			await this.verifySignInButtonVisible(timeout);
			await this.clickCloseButton();
		});
	}

	async enterApiKey(apiKey: string) {
		await this.code.driver.page.locator(APIKEY_RADIO).check();
		const apiKeyInput = this.code.driver.page.locator(APIKEY_INPUT);
		await apiKeyInput.fill(apiKey);
	}

	async clickSignInButton() {
		await this.code.driver.page.locator(SIGN_IN_BUTTON).click();
	}

	async clickCloseButton({ abandonChanges = true } = {}) {
		await this.code.driver.page.locator(CLOSE_BUTTON).click();

		const abandonModalisVisible = await this.modals.modalTitle.filter({ hasText: 'Authentication Incomplete' }).isVisible();
		if (abandonModalisVisible) {
			abandonChanges
				? await this.modals.getButton('Yes').click()
				: await this.modals.getButton('No').click();
		}

		await this.modals.expectToBeVisible(undefined, { visible: false });
	}

	async clickSignOutButton() {
		await this.code.driver.page.locator(SIGN_OUT_BUTTON).click();
	}

	async verifySignOutButtonVisible(timeout: number = 15000) {
		await expect(this.code.driver.page.locator(SIGN_OUT_BUTTON)).toBeVisible({ timeout });
		await expect(this.code.driver.page.locator(SIGN_OUT_BUTTON)).toHaveText('Sign out', { timeout });
	}

	async verifySignInButtonVisible(timeout: number = 15000) {
		await expect(this.code.driver.page.locator(SIGN_IN_BUTTON)).toBeVisible({ timeout });
		await expect(this.code.driver.page.locator(SIGN_IN_BUTTON)).toHaveText('Sign in', { timeout });
	}

	async verifyAuthMethod(type: 'oauth' | 'apiKey') {
		switch (type) {
			case 'oauth':
				await expect(this.code.driver.page.locator(OAUTH_RADIO)).toBeChecked();
				await expect(this.code.driver.page.locator(APIKEY_RADIO)).toBeDisabled();
				break;
			case 'apiKey':
				await expect(this.code.driver.page.locator(APIKEY_RADIO)).toBeChecked();
				await expect(this.code.driver.page.locator(OAUTH_RADIO)).toBeDisabled();
				break;
			default:
				throw new Error(`Unsupported auth method: ${type}`);
		}
	}

	/**
	 * Gets the provider display names in their display order from the Configure Providers modal.
	 * The modal must already be open before calling this method.
	 * @returns Array of provider display names in display order (e.g., "Posit AI", "Anthropic")
	 */
	async getProviderButtonNames(): Promise<string[]> {
		const providerButtons = this.code.driver.page.locator('div[id$="-provider-button"]');
		await providerButtons.first().waitFor({ state: 'visible' });

		const texts = await providerButtons.allTextContents();
		return texts.map(t => t.trim()).filter(Boolean);
	}

	async enterChatMessage(message: string, waitForResponse: boolean = true) {
		const chatInput = this.code.driver.page.locator(CHAT_INPUT);
		await chatInput.waitFor({ state: 'visible' });
		await chatInput.pressSequentially(message);
		await this.code.driver.page.locator(SEND_MESSAGE_BUTTON).click();
		// It can take a moment for the loading locator to become visible.
		await this.code.driver.page.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'visible' });
		// Optionally wait for any loading state on the most recent response to finish
		if (waitForResponse) {
			await this.waitForResponseComplete();
		}
	}

	/**
	 * Waits for the chat response to complete by waiting for the loading state to disappear.
	 * This can be called independently when a message has already been sent and we need to
	 * wait for the response to finish.
	 * @param timeout The maximum time to wait for the response to complete (default: 60000ms)
	 */
	async waitForResponseComplete(timeout: number = 60000) {
		await this.code.driver.page.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'visible' });
		await this.code.driver.page.locator('.chat-most-recent-response.chat-response-loading').waitFor({ state: 'hidden', timeout });
	}

	/**
	 * Verifies the chat panel is visible.
	 * @param timeout The maximum time to wait for visibility (default: 10000ms)
	 */
	async expectChatPanelVisible(timeout: number = 10000) {
		await test.step('Verify chat panel is visible', async () => {
			await expect(this.code.driver.page.locator(CHAT_PANEL)).toBeVisible({ timeout });
		});
	}

	/**
	 * Verifies a chat response is visible.
	 * @param timeout The maximum time to wait for visibility (default: 10000ms)
	 */
	async expectChatResponseVisible(timeout: number = 10000) {
		await test.step('Verify chat response is visible', async () => {
			await expect(this.code.driver.page.locator('.interactive-response')).toBeVisible({ timeout });
		});
	}

	async clickChatCodeRunButton(codeblock: string) {
		await this.code.driver.page.locator(`span`).filter({ hasText: codeblock }).locator('span').first().dblclick();
		await this.code.driver.page.locator(RUN_BUTTON).click();
	}

	async clickKeepButton(timeout: number = 20000) {
		await this.code.driver.page.locator(KEEP_BUTTON).click({ timeout });
	}

	async clickNewChatButton() {
		await this.code.driver.page.locator(NEW_CHAT_BUTTON).click();
		await expect(this.code.driver.page.locator(CHAT_INPUT)).toBeVisible();
	}

	async verifyTokenUsageVisible() {
		await expect(this.code.driver.page.locator('.token-usage')).toBeVisible();
		await expect(this.code.driver.page.locator('.token-usage')).toHaveText(/Tokens: ↑\d+ ↓\d+/);
	}

	async verifyTokenUsageNotVisible() {
		await expect(this.code.driver.page.locator('.token-usage')).not.toBeVisible();
	}

	async verifyTotalTokenUsageVisible() {
		await expect(this.code.driver.page.locator('.token-usage-total')).toBeVisible();
		await expect(this.code.driver.page.locator('.token-usage-total')).toHaveText(/Total tokens: ↑\d+ ↓\d+/);
	}

	async verifyNumberOfVisibleResponses(expectedCount: number, checkTokenUsage: boolean = false) {
		const responses = this.code.driver.page.locator('.interactive-response');
		await expect(responses).toHaveCount(expectedCount);
		if (checkTokenUsage) {
			this.code.driver.page.locator('.token-usage').nth(expectedCount - 1).waitFor({ state: 'visible' });
		}
	}

	async getTokenUsage() {
		const tokenUsageElement = this.code.driver.page.locator('.token-usage');
		await expect(tokenUsageElement).toBeVisible();
		const text = await tokenUsageElement.textContent();
		expect(text).not.toBeNull();
		const inputMatch = text ? text.match(/↑(\d+)/) : null;
		const outputMatch = text ? text.match(/↓(\d+)/) : null;
		return {
			inputTokens: inputMatch ? parseInt(inputMatch[1], 10) : 0,
			outputTokens: outputMatch ? parseInt(outputMatch[1], 10) : 0
		};
	}

	async getTotalTokenUsage() {
		const totalTokenUsageElement = this.code.driver.page.locator('.token-usage-total');
		await expect(totalTokenUsageElement).toBeVisible();
		const text = await totalTokenUsageElement.textContent();
		console.log('Total Token Usage Text:', text);
		expect(text).not.toBeNull();
		const totalMatch = text ? text.match(/Total tokens: ↑(\d+) ↓(\d+)/) : null;
		return {
			inputTokens: totalMatch ? parseInt(totalMatch[1], 10) : 0,
			outputTokens: totalMatch ? parseInt(totalMatch[2], 10) : 0
		};
	}

	async waitForReadyToSend(timeout: number = 25000) {
		await this.code.driver.page.waitForSelector('.chat-input-toolbars .codicon-send', { timeout });
		await this.code.driver.page.waitForSelector('.detail-container .detail:has-text("Working")', { state: 'hidden', timeout });
	}

	async waitForSendButtonVisible() {
		await this.code.driver.page.locator(SEND_MESSAGE_BUTTON).waitFor({ state: 'visible' });
	}

	async selectChatMode(mode: string) {
		// Click the mode dropdown to open it
		await this.code.driver.page.locator(MODE_DROPDOWN).click();

		// Wait for the dropdown menu to appear
		await this.code.driver.page.locator(MODE_DROPDOWN_ITEM).first().waitFor({ state: 'visible' });

		// Find and click the item with the matching text
		const items = this.code.driver.page.locator(MODE_DROPDOWN_ITEM);
		const count = await items.count();

		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const titleSpan = item.locator('span.title');
			const text = await titleSpan.textContent();

			if (text?.trim() === mode) {
				// Use force: true to bypass the pointer block
				await item.click({ force: true });
				return;
			}
		}

		throw new Error(`Mode "${mode}" not found in dropdown`);
	}

	async selectChatModel(model: string) {
		// Click the model picker dropdown to open it
		await this.code.driver.page.locator(MODEL_PICKER_DROPDOWN).click();

		// Wait for the dropdown menu to appear
		await this.code.driver.page.locator(MODEL_DROPDOWN_ITEM).first().waitFor({ state: 'visible' });

		// Find and click the item with the matching text
		const items = this.code.driver.page.locator(MODEL_DROPDOWN_ITEM);
		const count = await items.count();

		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const titleSpan = item.locator('span.title');
			const text = await titleSpan.textContent();

			if (text?.trim() === model) {
				// Use force: true to bypass the pointer block
				await item.click({ force: true });
				return;
			}
		}

		throw new Error(`Model "${model}" not found in dropdown`);
	}

	/**
	 * Gets all model items from the model picker dropdown.
	 * Returns an array of objects containing the model label and whether it's marked as default.
	 * The dropdown must already be open before calling this method.
	 */
	async getModelPickerItems(): Promise<Array<{ label: string; isDefault: boolean }>> {
		const items = this.code.driver.page.locator(MODEL_DROPDOWN_ITEM);
		const count = await items.count();
		const modelItems: Array<{ label: string; isDefault: boolean }> = [];

		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			const titleSpan = item.locator('span.title');
			const text = await titleSpan.textContent();

			if (text) {
				const trimmedText = text.trim();
				// Check if this is a separator (vendor header) - they don't have the same structure
				const isSeparator = await item.locator('.separator').isVisible().catch(() => false);
				if (!isSeparator && trimmedText) {
					modelItems.push({
						label: trimmedText,
						isDefault: trimmedText.includes('(default)')
					});
				}
			}
		}

		return modelItems;
	}

	/**
	 * Gets model items for a specific vendor from the model picker dropdown.
	 * Returns models in their displayed order.
	 * The dropdown must already be open before calling this method.
	 * @param vendor The vendor name to filter by (e.g., 'Echo', 'Anthropic')
	 */
	async getModelPickerItemsForVendor(vendor: string): Promise<Array<{ label: string; isDefault: boolean }>> {
		const allItems = this.code.driver.page.locator('.monaco-list-row');
		const count = await allItems.count();
		const vendorModels: Array<{ label: string; isDefault: boolean }> = [];
		let inVendorSection = false;

		for (let i = 0; i < count; i++) {
			const item = allItems.nth(i);

			// Check if this is a separator (vendor header) by looking for the 'separator' class
			const isSeparator = await item.evaluate(el => el.classList.contains('separator'));

			if (isSeparator) {
				// Get the vendor name from the separator-label span
				const separatorLabel = item.locator('span.separator-label');
				const labelText = await separatorLabel.textContent().catch(() => null);

				// Check if this is the vendor we're looking for
				if (labelText) {
					inVendorSection = labelText.trim().toLowerCase() === vendor.toLowerCase();
				}
				continue;
			}

			// If we're in the vendor section and this is an action item, collect the model
			if (inVendorSection) {
				const isAction = await item.evaluate(el => el.classList.contains('action'));
				if (isAction) {
					const titleSpan = item.locator('span.title');
					const titleText = await titleSpan.textContent().catch(() => null);

					if (titleText) {
						const trimmedText = titleText.trim();
						vendorModels.push({
							label: trimmedText,
							isDefault: trimmedText.includes('(default)')
						});
					}
				}
			}
		}

		return vendorModels;
	}

	/**
	 * Verifies that a specific model shows the "(default)" indicator in the model picker.
	 * @param modelName The base model name (without the "(default)" suffix)
	 */
	async verifyModelHasDefaultIndicator(modelName: string) {
		await test.step(`Verify model "${modelName}" has default indicator`, async () => {
			const models = await this.getModelPickerItems();
			const modelWithDefault = models.find(m => m.label === `${modelName} (default)`);
			expect(modelWithDefault, `Expected to find model "${modelName}" with "(default)" indicator`).toBeDefined();
			expect(modelWithDefault?.isDefault).toBe(true);
		});
	}

	/**
	 * Verifies that a model does NOT have the "(default)" indicator.
	 * @param modelName The base model name
	 */
	async verifyModelDoesNotHaveDefaultIndicator(modelName: string) {
		await test.step(`Verify model "${modelName}" does not have default indicator`, async () => {
			const models = await this.getModelPickerItems();
			const modelWithDefault = models.find(m => m.label === `${modelName} (default)`);
			expect(modelWithDefault, `Expected model "${modelName}" to NOT have "(default)" indicator`).toBeUndefined();
		});
	}

	/**
	 * Closes the model picker dropdown by pressing Escape if it is open.
	 */
	async closeModelPickerDropdown() {
		const dropdownItem = this.code.driver.page.locator(MODEL_DROPDOWN_ITEM).first();
		if (await dropdownItem.isVisible()) {
			await this.code.driver.page.keyboard.press('Escape');
			await expect(dropdownItem).not.toBeVisible();
		}
	}

	async getChatResponseText(exportFolder?: string) {
		// Export the chat to a file first
		await this.quickaccess.runCommand(`positron-assistant.exportChatToFileInWorkspace`);
		await this.toasts.waitForAppear('Chat log exported to:');
		await this.toasts.closeAll();

		// Find and parse the chat export file
		const chatExportFile = await this.findChatExportFile(exportFolder);
		if (!chatExportFile) {
			throw new Error('No chat export file found');
		}

		const responseText = await this.parseChatResponseFromFile(chatExportFile);

		// Rename the file to prevent it from being found again
		await this.renameChatExportFile(chatExportFile);

		return responseText;
	}

	/**
	 * Finds the most recent chat export JSON file matching the pattern 'positron-chat-export-*'
	 * @param exportFolder Optional folder path to search in. If not provided, searches in current working directory
	 * @returns The file path of the found chat export file, or null if not found
	 */
	async findChatExportFile(exportFolder?: string): Promise<string | null> {
		const fs = require('fs').promises;
		const path = require('path');

		// Use provided folder or current working directory
		const searchPath = exportFolder || process.cwd();

		try {
			const files = await fs.readdir(searchPath);
			const chatExportFiles = files
				.filter((file: string) => file.match(/^positron-chat-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/))
				.map((file: string) => ({
					name: file,
					path: path.join(searchPath, file),
					// Extract timestamp from filename for sorting
					timestamp: file.match(/positron-chat-export-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/)?.[1]
				}))
				.filter((file: any) => file.timestamp)
				.sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp)); // Sort by timestamp descending (newest first)

			if (chatExportFiles.length > 0) {
				return chatExportFiles[0].path;
			}
		} catch (error) {
			// Directory might not exist or not accessible
			console.log(`Could not search in ${searchPath}:`, error);
		}

		return null;
	}

	/**
	 * Parses the chat response text from a chat export JSON file
	 * @param filePath Path to the chat export JSON file
	 * @returns The concatenated response text from all chat responses
	 */
	async parseChatResponseFromFile(filePath: string): Promise<string> {
		const fs = require('fs').promises;

		try {
			const fileContent = await fs.readFile(filePath, 'utf-8');
			const chatData = JSON.parse(fileContent);

			const responses: string[] = [];
			const toolCalls: string[] = [];

			// Extract response text from all requests
			if (chatData.requests && Array.isArray(chatData.requests)) {
				for (const request of chatData.requests) {
					if (request.response && Array.isArray(request.response)) {
						for (const responseItem of request.response) {
							if (responseItem.value && typeof responseItem.value === 'string') {
								responses.push(responseItem.value);
							}
							// Check for tool calls
							if (responseItem.toolId && typeof responseItem.toolId === 'string') {
								toolCalls.push(responseItem.toolId);
							}
						}
					}
				}
			}

			let result = responses.join('\n');

			// Add tool calls information if any were found
			if (toolCalls.length > 0) {
				result += '\n\nTools called: ' + toolCalls.join(', ');
			}

			return result;
		} catch (error) {
			throw new Error(`Failed to parse chat export file ${filePath}: ${error}`);
		}
	}

	/**
	 * Renames a chat export file to mark it as processed
	 * @param filePath Path to the chat export JSON file to rename
	 */
	async renameChatExportFile(filePath: string): Promise<void> {
		const fs = require('fs').promises;
		const path = require('path');

		try {
			const dir = path.dirname(filePath);
			const filename = path.basename(filePath);

			// Add ".processed" before the file extension
			const newFilename = filename.replace('.json', '.processed.json');
			const newFilePath = path.join(dir, newFilename);

			await fs.rename(filePath, newFilePath);
		} catch (error) {
			console.log(`Could not rename chat export file ${filePath}:`, error);
			// Don't throw error here to avoid breaking the main flow
		}
	}

}

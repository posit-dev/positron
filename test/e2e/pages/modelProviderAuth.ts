/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '@playwright/test';
import { Code } from '../infra/code';
import { Modals } from './dialog-modals.js';
import { HotKeys } from './hotKeys.js';
import { Toasts } from './dialog-toasts.js';
import {
	ModelProvider,
	OAuthDeviceCodeConfig,
	LoginModelProviderOptions,
	fillSecretValue,
	getProviderAuthType,
	providerRequiresBaseUrl,
	getProviderBaseUrlEnvVarName,
	getOAuthConfig,
	getProviderEnvKey,
	getProviderEnvVarName,
	isProviderAutoSignedIn,
	completeOAuthDeviceCodeLogin,
} from './modelProviderShared.js';

export type { ModelProvider } from './modelProviderShared.js';

// Page object for the shared "Configure Language Model Providers" component.
// Both Positron Assistant and Posit Assistant use this component to
// authenticate against model providers, so the auth flow is replicated here
// independent of either assistant's page object.

// Configure Providers modal controls
const APIKEY_INPUT = '#api-key-input input.text-input[type="password"]';
const BASEURL_INPUT = '#base-url-input input.text-input[type="text"]';
const CLOSE_BUTTON = 'button.positron-button.action-bar-button.default:has-text("Close")';
const SIGN_IN_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign in")';
const SIGN_OUT_BUTTON = 'button.positron-button.language-model.button.sign-in:has-text("Sign out")';
const OAUTH_RADIO = '.language-model-authentication-method-container input#oauth[type="radio"]';
const APIKEY_RADIO = '.language-model-authentication-method-container input#apiKey[type="radio"]';

// Provider selection buttons
const ANTHROPIC_BUTTON = 'button.positron-button.language-model.button:has(#anthropic-api-provider-button)';
const AWS_BEDROCK_BUTTON = 'button.positron-button.language-model.button:has(#amazon-bedrock-provider-button)';
const ECHO_MODEL_BUTTON = 'button.positron-button.language-model.button:has(div.codicon-info)';
const ERROR_MODEL_BUTTON = 'button.positron-button.language-model.button:has(div.codicon-error)';
const MS_FOUNDRY_BUTTON = 'button.positron-button.language-model.button:has(#ms-foundry-provider-button)';
const OPENAI_BUTTON = 'button.positron-button.language-model.button:has(#openai-api-provider-button)';
const POSIT_AI_BUTTON = 'button.positron-button.language-model.button:has(#posit-ai-provider-button)';

/**
 * Page object for the shared "Configure Language Model Providers" dialog.
 * Used by both Positron Assistant and Posit Assistant to sign in and sign out
 * of model providers.
 */
export class ModelProviderAuth {

	private hotKeys: HotKeys;

	constructor(private code: Code, private modals: Modals, private toasts: Toasts) {
		this.hotKeys = new HotKeys(code);
	}

	/**
	 * Opens the Configure Language Model Providers modal via the hotkey.
	 */
	async runConfigureProviders() {
		await this.hotKeys.configureProviders();
	}

	/**
	 * Clicks the provider tile in the Configure Providers modal.
	 */
	async selectModelProvider(provider: ModelProvider) {
		switch (provider.toLowerCase()) {
			case 'anthropic-api':
				await this.code.driver.currentPage.locator(ANTHROPIC_BUTTON).click();
				break;
			case 'amazon-bedrock':
				await this.code.driver.currentPage.locator(AWS_BEDROCK_BUTTON).click();
				break;
			case 'echo':
				await this.code.driver.currentPage.locator(ECHO_MODEL_BUTTON).click();
				break;
			case 'error':
				await this.code.driver.currentPage.locator(ERROR_MODEL_BUTTON).click();
				break;
			case 'ms-foundry':
				await this.code.driver.currentPage.locator(MS_FOUNDRY_BUTTON).click();
				break;
			case 'openai-api':
				await this.code.driver.currentPage.locator(OPENAI_BUTTON).click();
				break;
			case 'posit-ai':
				await this.code.driver.currentPage.locator(POSIT_AI_BUTTON).click();
				break;
			default:
				throw new Error(`Unsupported model provider: ${provider}`);
		}
	}

	/**
	 * Signs in to a model provider with the appropriate authentication method.
	 * If the provider is auto-signed-in via environment variable (e.g., ANTHROPIC_API_KEY),
	 * the sign-in steps are skipped.
	 *
	 * @param provider - The model provider to sign in to
	 * @param options.apiKey - API key for API-key providers; falls back to *_KEY env var
	 * @param options.timeout - Timeout for verifying sign-in success (default: 15000ms)
	 * @param options.headless - Whether the OAuth browser runs headless (default: false)
	 */
	async loginModelProvider(provider: ModelProvider, options: LoginModelProviderOptions = {}) {
		const { timeout = 15000 } = options;

		if (isProviderAutoSignedIn(provider)) {
			return;
		}

		await test.step(`Sign in to ${provider} model provider`, async () => {
			await this.hotKeys.configureProviders();

			await this.selectModelProvider(provider);

			const alreadySignedIn = await this.code.driver.currentPage.locator(SIGN_OUT_BUTTON).isVisible();
			if (alreadySignedIn) {
				await this.clickCloseButton();
				return;
			}

			const authType = getProviderAuthType(provider);

			switch (authType) {
				case 'none':
					await this.clickSignInButton();
					break;

				case 'apiKey': {
					const apiKey = options.apiKey ?? getProviderEnvKey(provider);
					if (!apiKey) {
						throw new Error(
							`No API key provided for ${provider}. ` +
							`Set the ${getProviderEnvVarName(provider)} environment variable or pass apiKey in options.`
						);
					}
					await this.enterApiKey(apiKey);

					// Some providers (e.g. ms-foundry) also require a Base URL.
					if (providerRequiresBaseUrl(provider)) {
						const baseUrlEnvVar = getProviderBaseUrlEnvVarName(provider);
						const baseUrl = options.baseUrl ?? process.env[baseUrlEnvVar];
						if (!baseUrl) {
							throw new Error(
								`No base URL provided for ${provider}. ` +
								`Set the ${baseUrlEnvVar} environment variable or pass baseUrl in options.`
							);
						}
						await this.enterBaseUrl(baseUrl);
					}

					await this.clickSignInButton();
					break;
				}

				case 'aws':
					await this.clickSignInButton();
					break;

				case 'oauth': {
					const oauthConfig = getOAuthConfig(provider);
					await this.completeOAuthDeviceCodeFlow(oauthConfig, options);
					break;
				}

				default:
					throw new Error(`Unknown authentication type for provider: ${provider}`);
			}

			await this.verifySignOutButtonVisible(timeout);
			await this.clickCloseButton();
		});
	}

	/**
	 * Signs out from a model provider. If the provider is auto-signed-in via
	 * environment variable, the sign-out steps are skipped.
	 */
	async logoutModelProvider(provider: ModelProvider, options: { timeout?: number } = {}) {
		const { timeout = 15000 } = options;

		if (isProviderAutoSignedIn(provider)) {
			return;
		}

		await test.step(`Sign out from ${provider} model provider`, async () => {
			await this.runConfigureProviders();
			await this.selectModelProvider(provider);

			// If the test failed before sign-in landed (or a prior teardown
			// already signed out), there's no Sign Out button to click.
			if (await this.isSignedOut()) {
				await this.clickCloseButton();
				return;
			}

			await this.clickSignOutButton();
			await this.verifySignInButtonVisible(timeout);
			await this.clickCloseButton();
		});
	}

	async isSignedOut(): Promise<boolean> {
		return await this.code.driver.currentPage.locator(SIGN_IN_BUTTON).isVisible();
	}

	async enterApiKey(apiKey: string) {
		await this.code.driver.currentPage.locator(APIKEY_RADIO).check();
		const apiKeyInput = this.code.driver.currentPage.locator(APIKEY_INPUT);
		await fillSecretValue(apiKeyInput, apiKey);
	}

	async enterBaseUrl(baseUrl: string) {
		// Filled via the secret-value helper so the endpoint URL isn't recorded
		// in Playwright traces.
		const baseUrlInput = this.code.driver.currentPage.locator(BASEURL_INPUT);
		await fillSecretValue(baseUrlInput, baseUrl);
	}

	async clickSignInButton() {
		await this.code.driver.currentPage.locator(SIGN_IN_BUTTON).click();
	}

	async clickSignOutButton() {
		await this.code.driver.currentPage.locator(SIGN_OUT_BUTTON).click();
	}

	async clickCloseButton({ abandonChanges = true } = {}) {
		// Sign-in/sign-out can surface toast notifications that overlap the
		// modal's Close button, making it fail Playwright's actionability check.
		// Dismiss any toasts first so the click lands reliably.
		await this.toasts.closeAll();

		await this.code.driver.currentPage.locator(CLOSE_BUTTON).click();

		const abandonModalisVisible = await this.modals.modalTitle.filter({ hasText: 'Authentication Incomplete' }).isVisible();
		if (abandonModalisVisible) {
			abandonChanges
				? await this.modals.getButton('Yes').click()
				: await this.modals.getButton('No').click();
		}

		await this.modals.expectToBeVisible(undefined, { visible: false });
	}

	async verifySignOutButtonVisible(timeout: number = 15000) {
		await expect(this.code.driver.currentPage.locator(SIGN_OUT_BUTTON)).toBeVisible({ timeout });
		await expect(this.code.driver.currentPage.locator(SIGN_OUT_BUTTON)).toHaveText('Sign out', { timeout });
	}

	async verifySignInButtonVisible(timeout: number = 15000) {
		await expect(this.code.driver.currentPage.locator(SIGN_IN_BUTTON)).toBeVisible({ timeout });
		await expect(this.code.driver.currentPage.locator(SIGN_IN_BUTTON)).toHaveText('Sign in', { timeout });
	}

	async verifyAuthMethod(type: 'oauth' | 'apiKey') {
		switch (type) {
			case 'oauth':
				await expect(this.code.driver.currentPage.locator(OAUTH_RADIO)).toBeChecked();
				await expect(this.code.driver.currentPage.locator(APIKEY_RADIO)).toBeDisabled();
				break;
			case 'apiKey':
				await expect(this.code.driver.currentPage.locator(APIKEY_RADIO)).toBeChecked();
				await expect(this.code.driver.currentPage.locator(OAUTH_RADIO)).toBeDisabled();
				break;
			default:
				throw new Error(`Unsupported auth method: ${type}`);
		}
	}

	/**
	 * Completes an OAuth device code flow by launching a separate browser,
	 * signing in to the OAuth provider, and entering the verification code.
	 */
	async completeOAuthDeviceCodeFlow(config: OAuthDeviceCodeConfig, options: LoginModelProviderOptions = {}) {
		await test.step(`Complete OAuth device code flow for ${config.provider}`, async () => {
			await this.clickSignInButton();
			await completeOAuthDeviceCodeLogin(this.code, config, options);
		});
	}
}

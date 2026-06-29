/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, chromium, Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { Code } from '../infra/code';
import { Modals } from './dialog-modals.js';
import { HotKeys } from './hotKeys.js';
import { Toasts } from './dialog-toasts.js';

// Page object for the shared "Configure Language Model Providers" component.
// Both Positron Assistant and Posit Assistant use this component to
// authenticate against model providers, so the auth flow is replicated here
// independent of either assistant's page object.

/**
 * Fills an input element's value using evaluate() instead of Playwright's
 * fill() to prevent the value from being recorded in Playwright trace files.
 * Use this for sensitive values like API keys and passwords.
 */
async function fillSecretValue(locator: Locator, value: string): Promise<void> {
	await locator.evaluate((el: HTMLInputElement, val) => {
		const nativeSetter = Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype, 'value'
		)?.set;
		if (nativeSetter) {
			nativeSetter.call(el, val);
		} else {
			el.value = val;
		}
		el.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
}

// Positron modal dialog selectors (used by Posit AI)
const POSITRON_MODAL_DIALOG = '.positron-modal-dialog-box';

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

// Posit OAuth login page selectors
const POSIT_EMAIL_FIELD = 'input[name="email"]';
const POSIT_PASSWORD_FIELD = 'input[name="password"]';
const POSIT_CONTINUE_BUTTON = 'button[type="submit"]:has-text("Continue")';
const POSIT_LOGIN_BUTTON = 'button[type="submit"]:has-text("Log in")';

/**
 * Supported model providers for authentication.
 */
export type ModelProvider =
	| 'anthropic-api'
	| 'amazon-bedrock'
	| 'echo'
	| 'error'
	| 'ms-foundry'
	| 'openai-api'
	| 'posit-ai';

/**
 * Authentication types for model providers.
 */
type ProviderAuthType = 'none' | 'apiKey' | 'aws' | 'oauth';

/**
 * Supported OAuth providers for device code flow.
 */
export type OAuthProvider = 'posit';

/**
 * Configuration for OAuth device code flow authentication.
 */
export interface OAuthDeviceCodeConfig {
	/** The OAuth provider (e.g., 'posit') */
	provider: OAuthProvider;
	/** URL to navigate to for device code entry (empty if constructed from env var) */
	verificationUrl: string;
	/** Environment variable name for the auth host base URL (used to construct verification URL) */
	authHostEnvVar?: string;
	/** Environment variable names for credentials */
	envVars: {
		username: string;
		password: string;
		otp?: string;
	};
}

/**
 * Options for the loginModelProvider method.
 */
export interface LoginModelProviderOptions {
	/** API key for providers that support API key authentication */
	apiKey?: string;
	/** Base URL for providers that require one (e.g. ms-foundry); falls back to *_BASE_URL env var */
	baseUrl?: string;
	/** Timeout for verifying sign-in success (default: 15000ms) */
	timeout?: number;
	/** Whether to run the OAuth browser in headless mode (default: false) */
	headless?: boolean;
}

function getProviderAuthType(provider: ModelProvider): ProviderAuthType {
	switch (provider.toLowerCase()) {
		case 'echo':
		case 'error':
			return 'none';
		case 'anthropic-api':
		case 'openai-api':
		case 'ms-foundry':
			return 'apiKey';
		case 'amazon-bedrock':
			return 'aws';
		case 'posit-ai':
			return 'oauth';
		default:
			throw new Error(`Unknown provider: ${provider}`);
	}
}

/**
 * Whether the provider requires a Base URL alongside its API key (e.g.
 * Microsoft Foundry's Azure endpoint). These providers expose a "Base URL"
 * field in the Configure Providers modal in addition to the API key field.
 */
function providerRequiresBaseUrl(provider: ModelProvider): boolean {
	return provider.toLowerCase() === 'ms-foundry';
}

function getProviderBaseUrlEnvVarName(provider: ModelProvider): string {
	return `${provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`;
}

function getOAuthConfig(provider: ModelProvider): OAuthDeviceCodeConfig {
	switch (provider.toLowerCase()) {
		case 'posit-ai':
			return {
				provider: 'posit',
				verificationUrl: '',
				authHostEnvVar: 'POSIT_AUTH_HOST',
				envVars: {
					username: 'POSIT_EMAIL',
					password: 'POSIT_PASSWORD'
				}
			};
		default:
			throw new Error(`No OAuth configuration for provider: ${provider}`);
	}
}

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

function getProviderEnvKey(provider: ModelProvider): string | undefined {
	return process.env[getProviderEnvVarName(provider)];
}

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

function isProviderAutoSignedIn(provider: ModelProvider): boolean {
	const envVarName = getProviderAutoSignInEnvVarName(provider);
	return envVarName ? !!process.env[envVarName] : false;
}

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
		// The Posit login page does not render in headless Chromium, so the
		// default is headed. Callers may override per-invocation.
		const { headless = false } = options;

		await test.step(`Complete OAuth device code flow for ${config.provider}`, async () => {
			await this.clickSignInButton();

			const { verificationCode } = await this.extractDeviceCodeFromModal(config);

			let finalVerificationUrl = config.verificationUrl;

			if (!finalVerificationUrl && config.authHostEnvVar) {
				const authHost = process.env[config.authHostEnvVar];
				if (!authHost) {
					throw new Error(
						`OAuth auth host not configured. Please set ${config.authHostEnvVar} environment variable.`
					);
				}
				const redirectPath = encodeURIComponent(`/oauth/device?user_code=${verificationCode}`);
				finalVerificationUrl = `${authHost}/login?redirect=${redirectPath}`;
			}

			if (!finalVerificationUrl) {
				throw new Error('No verification URL available for OAuth flow');
			}

			let browser: Browser | undefined;
			let context: BrowserContext | undefined;
			let page: Page | undefined;

			try {
				browser = await chromium.launch({ headless });
				context = await browser.newContext();
				page = await context.newPage();

				await this.completePositLogin(page, config, verificationCode, finalVerificationUrl);
			} finally {
				if (context) {
					await context.close();
				}
				if (browser) {
					await browser.close();
				}
			}
		});
	}

	private async extractDeviceCodeFromModal(_config: OAuthDeviceCodeConfig): Promise<{ verificationCode: string }> {
		const deviceCodeModalLocator = this.code.driver.currentPage.locator(`${POSITRON_MODAL_DIALOG}:has-text("You will need this code to sign in")`);
		await expect(deviceCodeModalLocator).toBeVisible({ timeout: 30000 });

		const modalHtml = await deviceCodeModalLocator.innerHTML();
		if (!modalHtml) {
			throw new Error('Could not read Positron device code modal content');
		}

		const codeMatch = modalHtml.match(/<code>([A-Z0-9-]+)<\/code>/i);
		if (!codeMatch) {
			// Do not embed modalHtml in the error: it contains the device code
			// and other auth UI content that would otherwise leak into
			// Playwright traces and CI logs.
			throw new Error('Could not extract verification code from Positron device code modal (no <code> element found)');
		}

		const verificationCode = codeMatch[1];

		const okButton = deviceCodeModalLocator.locator('button:has-text("OK"), button:has-text("Ok")');
		await okButton.click();

		return { verificationCode };
	}

	private async completePositLogin(page: Page, config: OAuthDeviceCodeConfig, _verificationCode: string, verificationUrl: string) {
		const email = process.env[config.envVars.username];
		const password = process.env[config.envVars.password];

		if (!email || !password) {
			throw new Error(
				`Posit OAuth credentials not found. Please set ${config.envVars.username} and ${config.envVars.password} environment variables.`
			);
		}

		await page.goto(verificationUrl);

		await expect(page.locator(POSIT_EMAIL_FIELD)).toBeVisible({ timeout: 15000 });
		await page.locator(POSIT_EMAIL_FIELD).fill(email);
		await page.locator(POSIT_CONTINUE_BUTTON).click();

		await expect(page.locator(POSIT_PASSWORD_FIELD)).toBeVisible({ timeout: 15000 });
		await fillSecretValue(page.locator(POSIT_PASSWORD_FIELD), password);
		await page.locator(POSIT_LOGIN_BUTTON).click();

		const continueButton = page.locator('button[type="submit"]:has-text("Continue")');
		await expect(continueButton).toBeVisible({ timeout: 15000 });
		await continueButton.click();

		const authorizeButton = page.locator('button[type="submit"]:has-text("Authorize")');
		await expect(authorizeButton).toBeVisible({ timeout: 15000 });
		await authorizeButton.click();

		await expect(page.locator('body')).toContainText(/success|authorized|complete|congratulations/i, { timeout: 30000 });

		await page.close();
	}
}

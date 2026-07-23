/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, chromium, Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { Code } from '../infra/code';

// Modal-agnostic helpers shared between page objects that authenticate
// against model providers (e.g. the legacy ModelProviderAuth page object and
// the new Configure LLM Providers modal). Keeping these free of any
// particular modal's selectors lets both consumers reuse the same logic.

/**
 * Fills an input element's value using evaluate() instead of Playwright's
 * fill() to prevent the value from being recorded in Playwright trace files.
 * Use this for sensitive values like API keys and passwords.
 */
export async function fillSecretValue(locator: Locator, value: string): Promise<void> {
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

const POSITRON_MODAL_DIALOG = '.positron-modal-dialog-box';
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
export type ProviderAuthType = 'none' | 'apiKey' | 'aws' | 'oauth';

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

export function getProviderAuthType(provider: ModelProvider): ProviderAuthType {
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
export function providerRequiresBaseUrl(provider: ModelProvider): boolean {
	return provider.toLowerCase() === 'ms-foundry';
}

export function getProviderBaseUrlEnvVarName(provider: ModelProvider): string {
	return `${provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`;
}

export function getOAuthConfig(provider: ModelProvider): OAuthDeviceCodeConfig {
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

export function getProviderEnvVarName(provider: ModelProvider): string {
	switch (provider.toLowerCase()) {
		case 'anthropic-api':
			return 'ANTHROPIC_KEY';
		case 'openai-api':
			return 'OPENAI_KEY';
		default:
			return `${provider.toUpperCase().replace(/-/g, '_')}_KEY`;
	}
}

export function getProviderEnvKey(provider: ModelProvider): string | undefined {
	return process.env[getProviderEnvVarName(provider)];
}

export function getProviderAutoSignInEnvVarName(provider: ModelProvider): string | undefined {
	switch (provider.toLowerCase()) {
		case 'anthropic-api':
			return 'ANTHROPIC_API_KEY';
		case 'openai-api':
			return 'OPENAI_API_KEY';
		default:
			return undefined;
	}
}

export function isProviderAutoSignedIn(provider: ModelProvider): boolean {
	const envVarName = getProviderAutoSignInEnvVarName(provider);
	return envVarName ? !!process.env[envVarName] : false;
}

export async function extractDeviceCodeFromModal(code: Code, _config: OAuthDeviceCodeConfig): Promise<{ verificationCode: string }> {
	const deviceCodeModalLocator = code.driver.currentPage.locator(`${POSITRON_MODAL_DIALOG}:has-text("You will need this code to sign in")`);
	await expect(deviceCodeModalLocator).toBeVisible({ timeout: 30000 });

	const modalHtml = await deviceCodeModalLocator.innerHTML();
	if (!modalHtml) {
		throw new Error('Could not read Positron device code modal content');
	}

	const codeMatch = modalHtml.match(/<code>([A-Z0-9-]+)<\/code>/i);
	if (!codeMatch) {
		throw new Error('Could not extract verification code from Positron device code modal (no <code> element found)');
	}

	const verificationCode = codeMatch[1];

	const okButton = deviceCodeModalLocator.locator('button:has-text("OK"), button:has-text("Ok")');
	await okButton.click();

	return { verificationCode };
}

async function completePositLogin(page: Page, config: OAuthDeviceCodeConfig, verificationUrl: string): Promise<void> {
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

/**
 * Completes an OAuth device-code login AFTER the caller has initiated sign-in
 * (clicked the Sign in / Connect button). Extracts the device code from the
 * Positron modal, then drives the external Posit login in a separate browser.
 */
export async function completeOAuthDeviceCodeLogin(code: Code, config: OAuthDeviceCodeConfig, options: LoginModelProviderOptions = {}): Promise<void> {
	const { headless = false } = options;

	const { verificationCode } = await extractDeviceCodeFromModal(code, config);

	let finalVerificationUrl = config.verificationUrl;
	if (!finalVerificationUrl && config.authHostEnvVar) {
		const authHost = process.env[config.authHostEnvVar];
		if (!authHost) {
			throw new Error(`OAuth auth host not configured. Please set ${config.authHostEnvVar} environment variable.`);
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
		await completePositLogin(page, config, finalVerificationUrl);
	} finally {
		if (context) { await context.close(); }
		if (browser) { await browser.close(); }
	}
}

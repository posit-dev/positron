/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, test } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess.js';
import { Toasts } from './dialog-toasts.js';
import {
	ModelProvider,
	LoginModelProviderOptions,
	fillSecretValue,
	getProviderAuthType,
	providerRequiresBaseUrl,
	getProviderBaseUrlEnvVarName,
	getOAuthConfig,
	getProviderEnvKey,
	getProviderEnvVarName,
	completeOAuthDeviceCodeLoginWithCode,
} from './modelProviderShared.js';

const CONFIGURE_PROVIDERS_COMMAND = 'posit-assistant.configureProviders';

const MODAL_EDITOR = '.monaco-modal-editor-block';
const MODAL_CLOSE_BUTTON = `${MODAL_EDITOR} .modal-editor-action-container .codicon-close`;

const PROVIDER_LIST = '[data-testid="provider-list"]';
const PROVIDER_CARD = (provider: ModelProvider) => `[data-testid="provider-card-${provider}"]`;
const PROVIDER_ACTION = (kind: string, provider: ModelProvider) => `[data-testid="provider-action-${kind}-${provider}"]`;
const API_KEY_INPUT = '[data-testid="provider-api-key-input"]';
const BASE_URL_INPUT = '[data-testid="provider-base-url-input"]';
const FOUNDRY_AUTH_METHOD = '[data-testid="foundry-auth-method"]';
const SAVE_BUTTON = '[data-testid="provider-config-save"]';
const DEVICE_USER_CODE = '[data-testid="device-user-code"]';
// Hidden span holding the auth server's verification URL, so the test needn't click "Open Browser to Authorize".
const DEVICE_VERIFICATION_URL = '[data-testid="device-verification-url"]';
// The disconnect confirmation replaces the provider list; its buttons are Cancel then the confirm action.
const CONFIRM_VIEW = 'div.space-y-4:has(> div > h2)';

/**
 * Page object for Posit Assistant's "AI Providers" panel, a webview the extension opens in a modal editor.
 * Keeps the `loginModelProvider` / `logoutModelProvider` signatures of the removed `ModelProviderModal`.
 */
export class ProviderManager {
	constructor(private code: Code, private quickaccess: QuickAccess, private toasts: Toasts) { }

	/**
	 * Opens the panel and returns its frame. Editor webviews are overlays that sit outside the editor DOM,
	 * so the panel can't be told apart from the chat sidebar by position; find the one holding the provider list.
	 */
	async open(timeout = 15000): Promise<FrameLocator> {
		await this.quickaccess.runCommand(CONFIGURE_PROVIDERS_COMMAND);
		return this.frame(timeout);
	}

	async frame(timeout = 15000): Promise<FrameLocator> {
		const page = this.code.driver.currentPage;
		const webviews = page.locator('iframe.webview');
		let found: FrameLocator | undefined;
		await expect.poll(async () => {
			const count = await webviews.count();
			for (let i = 0; i < count; i++) {
				const candidate = webviews.nth(i).contentFrame().locator('#active-frame').contentFrame();
				if (await candidate.locator(PROVIDER_LIST).count() > 0) {
					found = candidate;
					return true;
				}
			}
			return false;
		}, { message: 'Provider manager webview did not load', timeout }).toBe(true);
		return found!;
	}

	async loginModelProvider(provider: ModelProvider, options: LoginModelProviderOptions = {}) {
		const { timeout = 15000 } = options;

		await test.step(`Connect to ${provider} in the provider manager`, async () => {
			const frame = await this.open(timeout);
			try {
				const card = frame.locator(PROVIDER_CARD(provider));
				if (await this.isConnected(frame, provider)) {
					return;
				}

				switch (getProviderAuthType(provider)) {
					case 'apiKey': {
						const apiKey = options.apiKey ?? getProviderEnvKey(provider);
						if (!apiKey) {
							throw new Error(
								`No API key provided for ${provider}. Set the ${getProviderEnvVarName(provider)} environment variable or pass apiKey in options.`
							);
						}
						await card.locator(PROVIDER_ACTION('connect', provider)).click();

						if (provider === 'ms-foundry') {
							await frame.locator(FOUNDRY_AUTH_METHOD).selectOption('apikey');
						}
						if (providerRequiresBaseUrl(provider)) {
							const baseUrlEnvVar = getProviderBaseUrlEnvVarName(provider);
							const baseUrl = options.baseUrl ?? process.env[baseUrlEnvVar];
							if (!baseUrl) {
								throw new Error(
									`No base URL provided for ${provider}. Set the ${baseUrlEnvVar} environment variable or pass baseUrl in options.`
								);
							}
							await fillSecretValue(frame.locator(BASE_URL_INPUT), baseUrl);
						}
						await fillSecretValue(frame.locator(API_KEY_INPUT), apiKey);
						await frame.locator(SAVE_BUTTON).click();
						break;
					}
					case 'oauth': {
						await card.locator(PROVIDER_ACTION('sign-in', provider)).click();
						const userCode = frame.locator(DEVICE_USER_CODE);
						await expect(userCode).toHaveText(/\S/, { timeout: 30000 });
						const verificationCode = (await userCode.textContent())!.trim();
						const verificationUrl = (await frame.locator(DEVICE_VERIFICATION_URL).textContent())?.trim();
						await completeOAuthDeviceCodeLoginWithCode(getOAuthConfig(provider), verificationCode, options, verificationUrl);
						await expect(frame.getByText('Authentication Successful!')).toBeVisible({ timeout: 30000 });
						// An account with setup still pending gets "Close" / "Complete Setup" instead, and fails here.
						await frame.getByRole('button', { name: 'Back', exact: true }).click();
						break;
					}
					case 'aws':
						// Positron's authentication extension owns Bedrock and signs in from the AWS credential chain; the panel only shows its status.
						throw new Error(`${provider} isn't connected. It needs valid AWS credentials in the environment (keys or an active profile).`);
					default:
						throw new Error(`The provider manager page object doesn't support ${provider} yet`);
				}

				await expect(frame.locator(PROVIDER_CARD(provider))).toContainText('Connected', { timeout });
			} finally {
				await this.close();
			}
		});
	}

	async logoutModelProvider(provider: ModelProvider, options: { timeout?: number } = {}) {
		const { timeout = 15000 } = options;

		await test.step(`Disconnect ${provider} in the provider manager`, async () => {
			const frame = await this.open(timeout);
			try {
				if (!(await this.isConnected(frame, provider))) {
					return;
				}

				// OAuth rows use sign-out; API key rows use disconnect or clear, depending on whether a key source remains.
				const card = frame.locator(PROVIDER_CARD(provider));
				const action = card.locator(['sign-out', 'disconnect', 'clear'].map(kind => PROVIDER_ACTION(kind, provider)).join(', '));
				if (await action.count() === 0) {
					// Connected from the environment (e.g. an env var key); nothing to disconnect here.
					return;
				}
				await action.first().click();
				await frame.locator(CONFIRM_VIEW).getByRole('button').last().click();

				await expect(frame.locator(PROVIDER_CARD(provider))).not.toContainText('Connected', { timeout });
			} finally {
				await this.close();
			}
		});
	}

	/** Closes the modal editor through its header, which disposes the panel. Escape goes to the focused webview instead. */
	async close() {
		const page = this.code.driver.currentPage;
		await this.toasts.closeAll();
		await page.locator(MODAL_CLOSE_BUTTON).click();
		await expect(page.locator(MODAL_EDITOR)).toHaveCount(0, { timeout: 15000 });
	}

	private async isConnected(frame: FrameLocator, provider: ModelProvider): Promise<boolean> {
		const card = frame.locator(PROVIDER_CARD(provider));
		await expect(card).toBeVisible();
		return (await card.textContent())?.includes('Connected') ?? false;
	}
}

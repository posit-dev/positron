/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '@playwright/test';
import { Code } from '../infra/code';
import { Modals } from './dialog-modals.js';
import { Toasts } from './dialog-toasts.js';
import { HotKeys } from './hotKeys.js';
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
	isProviderAutoSignedIn,
	completeOAuthDeviceCodeLogin,
} from './modelProviderShared.js';

// New "Configure LLM Providers" modal (behind assistant.newProviderModal).
// Same public surface as ModelProviderAuth so the sign-in test body is drop-in.
// The testid sits on a zero-size layout wrapper (its child dialog container is
// position:absolute, so the wrapper collapses and Playwright reports it hidden).
// Scope to the actual visible dialog box inside it, so visibility gates and
// footer-button lookups target a real bounding box. The testid prefix keeps this
// distinct from the OAuth device-code dialog, which is also a
// .positron-modal-dialog-box.
const MODAL = '[data-testid="configure-llm-providers-modal"] .positron-modal-dialog-box';
const CONNECT_VIEW = '[data-testid="provider-connect-view"]';
const CONNECTED_VIEW = '[data-testid="provider-connected-view"]';
const APIKEY_INPUT = '#connect-provider-apikey-input';
const BASEURL_INPUT = '#connect-provider-baseurl-input';

// Footer buttons are rendered by the shared action bar; scope by text within the modal.
// Substring match: also matches the in-flight "Connecting..." label, which is
// harmless here - the click lands while the button still reads "Connect", and
// there is only one primary button so there is no strict-mode collision.
const CONNECT_BUTTON = `${MODAL} button.positron-button:has-text("Connect")`;
const SIGN_OUT_BUTTON = `${MODAL} button.positron-button:has-text("Sign out")`;
const REMOVE_BUTTON = `${MODAL} button.positron-button:has-text("Remove")`;
const CLOSE_BUTTON = `${MODAL} button.positron-button:has-text("Close")`;

/**
 * Page object for the new "Configure LLM Providers" modal. Exposes the same
 * loginModelProvider / logoutModelProvider surface as ModelProviderAuth, so the
 * legacy sign-in test body can be reused unchanged. The caller is responsible
 * for enabling `assistant.newProviderModal` before use.
 */
export class ModelProviderModal {
	private hotKeys: HotKeys;

	constructor(private code: Code, private modals: Modals, private toasts: Toasts) {
		this.hotKeys = new HotKeys(code);
	}

	async runConfigureProviders() {
		await this.hotKeys.configureProviders();
	}

	private row(provider: ModelProvider) {
		return this.code.driver.currentPage.locator(`[data-testid="provider-row-${provider}"]`);
	}

	private action(provider: ModelProvider) {
		return this.code.driver.currentPage.locator(`[data-testid="provider-action-${provider}"]`);
	}

	/** The section the provider row is currently rendered in, or undefined if not present. */
	private async providerSection(provider: ModelProvider): Promise<string | undefined> {
		const row = this.row(provider);
		if (!(await row.isVisible())) {
			return undefined;
		}
		return (await row.getAttribute('data-provider-section')) ?? undefined;
	}

	async loginModelProvider(provider: ModelProvider, options: LoginModelProviderOptions = {}) {
		const { timeout = 15000 } = options;

		// Providers auto-signed-in via env var (ANTHROPIC_API_KEY / OPENAI_API_KEY)
		// need no UI action, matching the legacy page object.
		if (isProviderAutoSignedIn(provider)) {
			return;
		}

		await test.step(`Connect to ${provider} in new provider modal`, async () => {
			await this.runConfigureProviders();
			await expect(this.code.driver.currentPage.locator(MODAL)).toBeVisible({ timeout });

			// Already connected (e.g. autoconfigured via a credential chain): nothing to do.
			if ((await this.providerSection(provider)) === 'connected') {
				await this.clickCloseButton();
				return;
			}

			// Click the row's action to route to the Connect view.
			await this.action(provider).click();
			await expect(this.code.driver.currentPage.locator(CONNECT_VIEW)).toBeVisible({ timeout });

			const authType = getProviderAuthType(provider);
			switch (authType) {
				case 'apiKey': {
					const apiKey = options.apiKey ?? getProviderEnvKey(provider);
					if (!apiKey) {
						throw new Error(
							`No API key provided for ${provider}. Set the ${getProviderEnvVarName(provider)} environment variable or pass apiKey in options.`
						);
					}
					await fillSecretValue(this.code.driver.currentPage.locator(APIKEY_INPUT), apiKey);

					if (providerRequiresBaseUrl(provider)) {
						const baseUrlEnvVar = getProviderBaseUrlEnvVarName(provider);
						const baseUrl = options.baseUrl ?? process.env[baseUrlEnvVar];
						if (!baseUrl) {
							throw new Error(
								`No base URL provided for ${provider}. Set the ${baseUrlEnvVar} environment variable or pass baseUrl in options.`
							);
						}
						await fillSecretValue(this.code.driver.currentPage.locator(BASEURL_INPUT), baseUrl);
					}
					await this.clickConnectButton();
					break;
				}
				case 'aws':
				case 'none':
					await this.clickConnectButton();
					break;
				case 'oauth': {
					const oauthConfig = getOAuthConfig(provider);
					// The OAuth "Connect" button carries the same label; click, then drive the device flow.
					await this.clickConnectButton();
					await completeOAuthDeviceCodeLogin(this.code, oauthConfig, options);
					break;
				}
				default:
					throw new Error(`Unknown authentication type for provider: ${provider}`);
			}

			// A successful connect auto-transitions to the Connected view.
			await expect(this.code.driver.currentPage.locator(CONNECTED_VIEW)).toBeVisible({ timeout });
			await this.clickCloseButton();
		});
	}

	async logoutModelProvider(provider: ModelProvider, options: { timeout?: number } = {}) {
		const { timeout = 15000 } = options;

		if (isProviderAutoSignedIn(provider)) {
			return;
		}

		await test.step(`Disconnect ${provider} in new provider modal`, async () => {
			await this.runConfigureProviders();
			await expect(this.code.driver.currentPage.locator(MODAL)).toBeVisible({ timeout });

			// Not connected (already signed out, or never connected): nothing to do.
			if ((await this.providerSection(provider)) !== 'connected') {
				await this.clickCloseButton();
				return;
			}

			// Route to the Connected view via the row's Edit action.
			await this.action(provider).click();
			await expect(this.code.driver.currentPage.locator(CONNECTED_VIEW)).toBeVisible({ timeout });

			// Env / credential-chain authenticated providers cannot be signed out from
			// the modal (no Sign out / Remove button); treat that as a no-op close.
			const signOut = this.code.driver.currentPage.locator(SIGN_OUT_BUTTON);
			const remove = this.code.driver.currentPage.locator(REMOVE_BUTTON);
			const disconnect = (await signOut.isVisible()) ? signOut : (await remove.isVisible()) ? remove : undefined;
			if (!disconnect) {
				await this.clickCloseButton();
				return;
			}

			await disconnect.click();
			// Disconnecting returns to the list; the row drops back to Model Providers.
			await expect(this.row(provider)).toHaveAttribute('data-provider-section', 'model-providers', { timeout });
			await this.clickCloseButton();
		});
	}

	async clickConnectButton() {
		await this.code.driver.currentPage.locator(CONNECT_BUTTON).click();
	}

	async clickCloseButton() {
		// Sign-in/out can surface toasts overlapping the footer; dismiss them first.
		await this.toasts.closeAll();
		await this.code.driver.currentPage.locator(CLOSE_BUTTON).click();
		await this.modals.expectToBeVisible(undefined, { visible: false });
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '@playwright/test';
import { Code } from '../infra/code';
import { Toasts } from './dialog-toasts.js';
import { DynamicModals } from './dialog-dynamic-modals.js';
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
	completeOAuthDeviceCodeLogin,
	completeDatabricksLoopbackOAuth,
} from './modelProviderShared.js';

// The "Configure LLM Providers" modal, which the Configure Providers command
// opens by default (`assistant.newProviderModal`). The testid sits on a zero-size
// layout wrapper -- its child dialog container is position:absolute, so the wrapper
// collapses and Playwright reports it hidden -- so DynamicModals is scoped to the
// wrapper and finds the visible dialog box inside it.
const MODAL_SCOPE = '[data-testid="configure-llm-providers-modal"]';
const CONNECT_VIEW = '[data-testid="provider-connect-view"]';
const CONNECTED_VIEW = '[data-testid="provider-connected-view"]';
const APIKEY_INPUT = '#connect-provider-apikey-input';
const BASEURL_INPUT = '#connect-provider-baseurl-input';
// The auth-method radios, rendered only when a provider advertises more than one method
// (Databricks on desktop: OAuth or API Key). They carry no testid or id, so they are
// addressed by name and value, which come from the AuthMethod enum.
const AUTH_METHOD_RADIO = (method: 'oauth' | 'apiKey') =>
	`input[name="connect-provider-auth-method"][value="${method}"]`;
// The Connect view's error banner. Scoped to the Connect view on purpose: the
// Connected view renders the same banner component, so an unscoped selector would
// match both and trip strict mode.
const CONNECT_ERROR_MESSAGE = `${CONNECT_VIEW} .connect-provider-banner.error .connect-provider-banner-message`;
// Connect failures worth another click rather than a report. See expectConnectedView
// for the mechanism, and for when this should be deleted.
const TRANSIENT_CONNECT_ERROR = /(EPERM|EACCES|EBUSY)[\s\S]*providers\.json/i;
// Extra Connect clicks to spend on a transient failure, and the shorter window each
// one gets. A retry settles in well under a second either way -- the write either
// lands or fails again -- so the first attempt keeps the caller's full timeout while
// the retries stay cheap enough to fit inside the 2 minute test budget.
const CONNECT_RETRIES = 2;
const CONNECT_RETRY_TIMEOUT = 8000;

/**
 * Page object for the "Configure LLM Providers" modal. This is what the
 * Configure Providers command opens unless a suite pins
 * `assistant.newProviderModal` to false, and it is the only page object for
 * provider sign-in -- the legacy dialog's page object was removed once every
 * suite had moved over (posit-dev/positron#15537).
 */
export class ModelProviderModal {
	private hotKeys: HotKeys;
	private modal: DynamicModals;

	constructor(private code: Code, private toasts: Toasts) {
		this.hotKeys = new HotKeys(code);
		this.modal = new DynamicModals(code, MODAL_SCOPE);
	}

	/**
	 * A footer button by its label, matched as a substring. That also matches the
	 * in-flight "Connecting..." label, which is harmless here: the click lands while
	 * the button still reads "Connect", and there is only one primary button so there
	 * is no strict-mode collision.
	 */
	private footerButton(label: string) {
		return this.modal.dialogBox.locator(`button.positron-button:has-text("${label}")`);
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

	/**
	 * Opens the modal, runs `body`, and closes the modal again on the way out of a
	 * failure anywhere in either step. Leaving it open would break every later test
	 * in the file, not just this one: the app is shared across a suite, and the
	 * Configure Providers command renders a fresh dialog every time it runs without
	 * checking for one that is already open. A second dialog carries the same
	 * testid, so the modal locator then matches two elements and Playwright fails on
	 * strict mode instead of on whatever the test was actually doing.
	 */
	private async withModal(timeout: number, body: () => Promise<void>) {
		try {
			await this.runConfigureProviders();
			await this.modal.expectToBeVisible(undefined, { timeout });
			await body();
		} catch (e) {
			await this.closeQuietly();
			throw e;
		}
	}

	/**
	 * Closes the modal, swallowing any failure to do so. Used while an error is
	 * already propagating, where the original error is the one worth reporting.
	 */
	private async closeQuietly() {
		try {
			await this.clickCloseButton();
		} catch {
			// Already dismissed, or in a state the Close button can't be reached from.
		}
	}

	/**
	 * Waits for the Connected view, re-clicking Connect when the connect handler
	 * failed on a known-transient Windows filesystem error.
	 *
	 * TEMPORARY STOPGAP -- remove once the ai-lib fix lands. This makes CI green while
	 * the underlying Windows bug is still shipped, so it is not a fix.
	 *
	 * `providers.json` is persisted by ai-config's `atomicWrite`: a temp file plus a
	 * single unretried `fs.rename`. On Windows that rename returns EPERM whenever any
	 * other handle is open on the destination, and the competing reads are largely
	 * self-inflicted -- `refreshProviderCatalog` runs after every write, and the config
	 * watcher schedules a 300ms-debounced re-read. The connect handler then rejects, the
	 * modal stays on the Connect view rendering the raw error, and the Connected view
	 * never mounts.
	 *
	 * A Playwright-level retry does not help: the condition persists across app
	 * relaunches within a run, so each attempt fails the same way. The retry has to
	 * happen here, in place, once startup churn has settled.
	 *
	 * Every retry is recorded as a test annotation, so the real rate of the underlying
	 * product failure stays visible in the report instead of being silently absorbed.
	 */
	private async expectConnectedView(provider: ModelProvider, timeout: number, canRetry: boolean) {
		const connectedView = this.code.driver.currentPage.locator(CONNECTED_VIEW);
		const errorMessage = this.code.driver.currentPage.locator(CONNECT_ERROR_MESSAGE);

		for (let attempt = 0; ; attempt++) {
			try {
				// The first attempt keeps the caller's timeout, so a healthy connect behaves
				// exactly as it did before this retry existed.
				await expect(connectedView).toBeVisible({
					timeout: attempt === 0 ? timeout : CONNECT_RETRY_TIMEOUT,
				});
				return;
			} catch (assertionError) {
				// The banner is cleared synchronously when Connect is clicked and set again
				// only on rejection, so by the time the assertion above has given up this
				// text is settled rather than left over from the previous attempt.
				const message = (await errorMessage.textContent().catch(() => null))?.trim() ?? '';

				if (canRetry && attempt < CONNECT_RETRIES && TRANSIENT_CONNECT_ERROR.test(message)) {
					annotateTransientConnect(provider, attempt + 1, message);
					await this.clickConnectButton();
					continue;
				}

				// Report what the modal actually said. The bare assertion failure only says
				// the Connected view was not found, which hides the reason it was not.
				if (message) {
					throw new Error(
						`Connecting to ${provider} failed: the Connect view reported "${message}" and the Connected view never appeared.`
					);
				}
				throw assertionError;
			}
		}
	}

	async loginModelProvider(provider: ModelProvider, options: LoginModelProviderOptions = {}) {
		const { timeout = 15000 } = options;

		await test.step(`Connect to ${provider} in new provider modal`, async () => {
			await this.withModal(timeout, async () => {
				// Already connected (e.g. a provider autoconfigured from the environment,
				// such as AWS Bedrock via the credential chain): nothing to do. This is
				// read from the modal's live state, not a guess from process.env, so it
				// stays correct whether or not the launched app scrubbed auth env vars.
				if ((await this.providerSection(provider)) === 'connected') {
					await this.clickCloseButton();
					return;
				}

				// Click the row's action to route to the Connect view.
				await this.action(provider).click();
				await expect(this.code.driver.currentPage.locator(CONNECT_VIEW)).toBeVisible({ timeout });

				// Providers that offer a choice preselect their default (OAuth for
				// Databricks); only touch the radios when a test asked for the other one.
				// On web and remote the group is not rendered at all, since those builds
				// advertise a single method.
				let authType = getProviderAuthType(provider);
				if (options.authMethod) {
					// A missing radio group means the provider advertises a single method here
					// (Databricks on web and remote offers only the API key), so there is
					// nothing to select -- honour the requested method and carry on.
					const radio = this.code.driver.currentPage.locator(AUTH_METHOD_RADIO(options.authMethod));
					if (await radio.isVisible()) {
						await radio.check();
					}
					authType = options.authMethod === 'apiKey' ? 'apiKey' : authType;
				}

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
					case 'oauthLoopback': {
						// Databricks needs the workspace URL before Connect: it discovers the
						// workspace's OIDC endpoints from it. Unlike the API key path, the
						// Connect button is enabled whether or not the field is filled, so an
						// empty value here fails later and less legibly.
						const baseUrlEnvVar = getProviderBaseUrlEnvVarName(provider);
						const baseUrl = options.baseUrl ?? process.env[baseUrlEnvVar];
						if (!baseUrl) {
							throw new Error(
								`No workspace URL provided for ${provider}. Set the ${baseUrlEnvVar} environment variable or pass baseUrl in options.`
							);
						}
						await fillSecretValue(this.code.driver.currentPage.locator(BASEURL_INPUT), baseUrl);
						// Interception has to be armed before the click, so the click is passed in
						// rather than made here.
						await completeDatabricksLoopbackOAuth(this.code, () => this.clickConnectButton(), options);
						break;
					}
					default:
						throw new Error(`Unknown authentication type for provider: ${provider}`);
				}

				// A successful connect auto-transitions to the Connected view. Re-clicking
				// Connect is only safe for the non-OAuth methods, where the form still holds
				// the entered values; the OAuth flows would need their device or loopback
				// dance driven again, so they keep the plain assertion.
				const canRetryConnect = authType === 'apiKey' || authType === 'aws' || authType === 'none';
				await this.expectConnectedView(provider, timeout, canRetryConnect);
				await this.clickCloseButton();
			});
		});
	}

	async logoutModelProvider(provider: ModelProvider, options: { timeout?: number } = {}) {
		const { timeout = 15000 } = options;

		await test.step(`Disconnect ${provider} in new provider modal`, async () => {
			await this.withModal(timeout, async () => {
				// Not connected (already signed out, or never connected): nothing to do.
				if ((await this.providerSection(provider)) !== 'connected') {
					await this.clickCloseButton();
					return;
				}

				// Route to the Connected view via the row's Edit action.
				await this.action(provider).click();
				await expect(this.code.driver.currentPage.locator(CONNECTED_VIEW)).toBeVisible({ timeout });

				// Env / credential-chain authenticated providers cannot be signed out from
				// the modal (no Sign out / Disconnect button); treat that as a no-op close.
				const signOut = this.footerButton('Sign out');
				const disconnectButton = this.footerButton('Disconnect');
				const disconnect = (await signOut.isVisible()) ? signOut : (await disconnectButton.isVisible()) ? disconnectButton : undefined;
				if (!disconnect) {
					await this.clickCloseButton();
					return;
				}

				await disconnect.click();
				// Disconnecting returns to the list; the row drops back to Model Providers.
				await expect(this.row(provider)).toHaveAttribute('data-provider-section', 'model-providers', { timeout });
				await this.clickCloseButton();
			});
		});
	}

	async clickConnectButton() {
		await this.footerButton('Connect').click();
	}

	/** Dismisses the modal through the title bar's X; the footer has no Close button. */
	async clickCloseButton() {
		// Sign-in/out can surface toasts overlapping the title bar; dismiss them first.
		await this.toasts.closeAll();
		await this.modal.clickCloseButton();
		await this.modal.expectNotToBeVisible({ timeout: 15000 });
	}
}

/**
 * Records a transient-connect retry on the current test so the report still shows that
 * the underlying product failure happened. Falls back to a log line when there is no
 * active test to annotate, such as a call from a suite-level hook.
 *
 * Part of the same temporary stopgap as `expectConnectedView`.
 */
function annotateTransientConnect(provider: ModelProvider, attempt: number, message: string) {
	const description = `${provider}: retrying Connect (attempt ${attempt}) after a transient config-write failure -- ${message}`;
	try {
		test.info().annotations.push({ type: 'transient-connect-retry', description });
	} catch {
		// No active test to annotate; the log line is the only record available.
		console.log(`[modelProviderModal] ${description}`);
	}
}

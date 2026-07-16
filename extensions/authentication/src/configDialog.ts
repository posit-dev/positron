/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';
import { AuthProvider } from './authProvider';
import { PositOAuthProvider } from './positOAuthProvider';
import { FOUNDRY_AUTH_PROVIDER_ID } from './constants';
import { log } from './log';
import { FOUNDRY_MANAGED_CREDENTIALS, SNOWFLAKE_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';
import { getProviderSources } from './providerSources';

export type ApiKeyValidator = (apiKey: string, config: positron.ai.LanguageModelConfig) => Promise<void>;

export type OnSaveCallback = (config: positron.ai.LanguageModelConfig) => Promise<void>;

export interface RegisterAuthProviderOptions {
	validateApiKey?: ApiKeyValidator;
	onSave?: OnSaveCallback;
}

export const authProviders = new Map<string, AuthProvider>();
const apiKeyValidators = new Map<string, ApiKeyValidator>();
const onSaveCallbacks = new Map<string, OnSaveCallback>();

/**
 * Register an auth provider so the config dialog can store/remove
 * credentials through it.
 */
export function registerAuthProvider(
	providerId: string,
	provider: AuthProvider,
	options?: RegisterAuthProviderOptions
): void {
	authProviders.set(providerId, provider);
	if (options?.validateApiKey) {
		apiKeyValidators.set(providerId, options.validateApiKey);
	} else {
		apiKeyValidators.delete(providerId);
	}
	if (options?.onSave) {
		onSaveCallbacks.set(providerId, options.onSave);
	} else {
		onSaveCallbacks.delete(providerId);
	}
}

/**
 * Get the auth provider for a given provider ID.
 * Used by the migrateApiKey command.
 */
export function getAuthProvider(
	providerId: string
): AuthProvider | undefined {
	return authProviders.get(providerId);
}

/**
 * Update a provider's signedIn and autoconfigure state from its current sessions.
 * The caller is responsible for fetching sessions via the appropriate mechanism.
 */
export async function updateProviderFromSessions(
	providerId: string,
	sessions: vscode.AuthenticationSession[],
): Promise<void> {
	try {
		const signedIn = sessions.length > 0;
		// Chain sessions (env vars, credential chain, managed credentials) use
		// the provider ID as their session ID; stored API-key sessions use a
		// random UUID. Only autoconfigured sessions should show the
		// "authenticated automatically" UI and hide the sign-out button.
		const isAutoSession = signedIn && (sessions[0].id === providerId || providerId === 'copilot-auth');

		// Distinguish "configured but expired" from "never configured" using
		// the persisted flag. Copilot is excluded: it rides GitHub's built-in
		// auth, so an Accounts-menu sign-out is indistinguishable from expiry.
		let status: 'ok' | 'error' | null;
		let statusMessage: string | undefined;
		if (signedIn) {
			status = 'ok';
		} else if (providerId !== 'copilot-auth' && await authProviders.get(providerId)?.isConfigured()) {
			status = 'error';
			statusMessage = vscode.l10n.t('Authentication expired');
		} else {
			status = null;
		}

		if (isAutoSession && providerId === FOUNDRY_AUTH_PROVIDER_ID && hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS)) {
			positron.ai.updateProvider(providerId, {
				signedIn,
				status,
				defaults: {
					autoconfigure: {
						type: positron.ai.LanguageModelAutoconfigureType.Custom,
						message: FOUNDRY_MANAGED_CREDENTIALS.displayName,
						signedIn: true,
					},
				},
			});
		} else if (isAutoSession && providerId === 'snowflake-cortex' && hasManagedCredentials(SNOWFLAKE_MANAGED_CREDENTIALS)) {
			positron.ai.updateProvider(providerId, {
				signedIn,
				status,
				defaults: {
					autoconfigure: {
						type: positron.ai.LanguageModelAutoconfigureType.Custom,
						message: SNOWFLAKE_MANAGED_CREDENTIALS.displayName,
						signedIn: true,
					},
				},
			});
		} else if (providerId === 'copilot-auth') {
			// Copilot's sign-in is always an auto-session, so sync its
			// autoconfigure default to the current signed-in state. Update on
			// sign-out too, otherwise a stale signedIn flag keeps the
			// "authenticated automatically" banner up. Preserve the registered
			// autoconfigure type/message, which updateProvider replaces wholesale.
			const autoconfigure = getProviderSources().find(s => s.provider.id === providerId)?.defaults.autoconfigure;
			positron.ai.updateProvider(providerId, autoconfigure
				? { signedIn, status, statusMessage, defaults: { autoconfigure: { ...autoconfigure, signedIn } } }
				: { signedIn, status, statusMessage });
		} else {
			// Generic autoconfigure (e.g. env-var credentials): mark the
			// provider's autoconfigure default as signed in so the dialog shows
			// the "authenticated automatically" UI. Preserve the registered
			// autoconfigure type/key, which updateProvider replaces wholesale.
			const autoconfigure = isAutoSession
				? getProviderSources().find(s => s.provider.id === providerId)?.defaults.autoconfigure
				: undefined;
			positron.ai.updateProvider(providerId, autoconfigure
				? { signedIn, status, statusMessage, defaults: { autoconfigure: { ...autoconfigure, signedIn: true } } }
				: { signedIn, status, statusMessage });
		}
	} catch (err) {
		log.error(`Failed to check credential state for ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Action handler for all providers. Dispatches save/delete/cancel actions
 * to the appropriate auth flow based on the provider.
 */
export async function providerAction(
	source: positron.ai.LanguageModelSource,
	config: positron.ai.LanguageModelConfig,
	action: string
): Promise<void> {
	const providerId = source.provider.id;
	log.info(`Provider action: "${action}" for provider "${providerId}"`);
	switch (action) {
		case 'save':
		case 'oauth-signin': {
			if (providerId === 'copilot-auth') {
				// Copilot may finish without a session (e.g. the user cancels
				// the GitHub sign-in), so only report success when one exists.
				const signedIn = await handleCopilotSignIn();
				if (!signedIn) {
					break;
				}
			} else {
				await handleSave(source, config);
			}
			vscode.window.showInformationMessage(
				vscode.l10n.t('{0} has been added successfully.', source.provider.displayName)
			);
			break;
		}
		case 'delete':
		case 'oauth-signout': {
			await handleDelete(providerId);
			break;
		}
		case 'cancel': {
			const provider = authProviders.get(providerId);
			if (provider instanceof PositOAuthProvider) {
				provider.cancelSignIn();
			}
			break;
		}
		default:
			throw new Error(
				vscode.l10n.t('Invalid action: {0}', action)
			);
	}
}

const GITHUB_SCOPES = ['read:user', 'user:email', 'repo', 'workflow'];

async function handleCopilotSignIn(): Promise<boolean> {
	let session = await vscode.authentication.getSession('github', GITHUB_SCOPES, { silent: true });
	if (!session) {
		session = await vscode.authentication.getSession('github', GITHUB_SCOPES, { createIfNone: true });
		if (session) {
			const shouldReload = await positron.window.showSimpleModalDialogPrompt(
				vscode.l10n.t('Reload Required'),
				vscode.l10n.t('Positron needs to reload to finish setting up GitHub Copilot.'),
				vscode.l10n.t('Reload'),
				vscode.l10n.t('Cancel')
			);
			if (shouldReload) {
				await vscode.commands.executeCommand('workbench.action.reloadWindow');
			}
		}
	}
	return !!session;
}

/**
 * Store or resolve credentials. For providers with an API key in the
 * config, validates and stores it. Otherwise resolves via createSession.
 */
async function handleSave(
	source: positron.ai.LanguageModelSource,
	config: positron.ai.LanguageModelConfig
): Promise<string> {
	const providerId = source.provider.id;
	const provider = authProviders.get(providerId);
	if (!provider) {
		throw new Error(
			vscode.l10n.t('No auth provider registered for {0}', providerId)
		);
	}

	if (config.apiKey !== undefined) {
		return handleApiKeySave(source, config, provider);
	}

	// Persist settings (e.g. base URL) before resolving the chain
	// so the chain validator uses the value the user just entered.
	const onSave = onSaveCallbacks.get(providerId);
	if (onSave) {
		await onSave(config);
	}

	const session = await provider.createSession([], {});
	return session.account.id;
}

async function handleApiKeySave(
	source: positron.ai.LanguageModelSource,
	config: positron.ai.LanguageModelConfig,
	provider: AuthProvider
): Promise<string> {
	const providerId = source.provider.id;
	const apiKey = config.apiKey?.trim() ?? '';
	const validateApiKey = apiKeyValidators.get(providerId);
	if (validateApiKey) {
		await validateApiKey(apiKey, config);
	}

	const onSave = onSaveCallbacks.get(providerId);
	if (onSave) {
		await onSave(config);
	}

	// Remove existing sessions so we don't accumulate stale credentials.
	const existing = await provider.getSessions();
	for (const session of existing) {
		await provider.removeSession(session.id);
	}

	const accountId = randomUUID();
	log.info(`Saving credential for provider "${providerId}" (${accountId})`);
	await provider.storeKey(accountId, source.provider.displayName, apiKey);
	return accountId;
}

async function handleDelete(
	providerId: string,
): Promise<void> {
	const provider = authProviders.get(providerId);
	if (!provider) {
		throw new Error(
			vscode.l10n.t('No auth provider registered for {0}', providerId)
		);
	}
	const sessions = await provider.getSessions();
	// Credential-chain sessions (e.g. env var credentials) use the
	// provider ID as their session ID. These cannot be removed via the
	// UI -- the user must unset the environment variable and restart.
	const deletable = provider.chainPreventsSignOut
		? sessions.filter(s => s.id !== providerId)
		: sessions;
	if (deletable.length === 0 && sessions.length > 0) {
		throw new Error(
			vscode.l10n.t(
				'This credential was configured via an environment variable ' +
				'and cannot be removed from the UI. Unset the environment ' +
				'variable and restart Positron.'
			)
		);
	}
	log.info(`Deleting ${deletable.length} session(s) for provider "${providerId}"`);
	for (const session of deletable) {
		await provider.removeSession(session.id);
	}
}


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
import { FOUNDRY_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';

export interface ConfigDialogResult {
	action: string;
	config: positron.ai.LanguageModelConfig;
	accountId?: string;
}

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
 * Enrich sources with credential state from registered auth providers.
 */
async function enrichWithCredentialState(
	sources: positron.ai.LanguageModelSource[]
): Promise<positron.ai.LanguageModelSource[]> {
	return Promise.all(sources.map(async (source) => {
		const provider = authProviders.get(source.provider.id);
		if (!provider) {
			return source;
		}
		try {
			const sessions = await provider.getSessions();
			const signedIn = sessions.length > 0;
			if (signedIn && source.provider.id === FOUNDRY_AUTH_PROVIDER_ID && hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS)) {
				return {
					...source,
					signedIn,
					defaults: {
						...source.defaults,
						autoconfigure: {
							type: positron.ai.LanguageModelAutoconfigureType.Custom,
							message: FOUNDRY_MANAGED_CREDENTIALS.displayName,
							signedIn: true,
						},
					},
				};
			}
			return { ...source, signedIn };
		} catch (err) {
			log.error(`Failed to check credential state for ${source.provider.id}: ${err instanceof Error ? err.message : String(err)}`);
			return source;
		}
	}));
}

/**
 * Show the language model configuration dialog. Enriches the caller-provided
 * sources with credential state from this extension's auth providers, then
 * delegates to the core modal.
 *
 * For providers with a registered auth provider, credential storage and
 * removal are handled directly within this callback. For all other
 * providers the action is recorded and returned so the caller can handle
 * model lifecycle.
 *
 * Called via `vscode.commands.executeCommand('authentication.configureProviders', sources, options)`.
 */
export async function showConfigurationDialog(
	sources: positron.ai.LanguageModelSource[],
	options?: positron.ai.ShowLanguageModelConfigOptions
): Promise<ConfigDialogResult[]> {
	const enrichedSources = await enrichWithCredentialState(sources);
	log.info(`Opening config dialog with ${enrichedSources.length} source(s)`);

	const results: ConfigDialogResult[] = [];

	const addResult = (result: ConfigDialogResult) => {
		const idx = results.findIndex(r => r.config.provider === result.config.provider);
		if (idx !== -1) {
			results[idx] = result;
		} else {
			results.push(result);
		}
	};

	await positron.ai.showLanguageModelConfig(
		enrichedSources,
		async (config, action) => {
			log.info(`Config dialog action: "${action}" for provider "${config.provider}"`);
			const hasAuthProvider = authProviders.has(config.provider);
			// applyConfig is a fallback while we transition providers to the Auth extension.
			// It should eventually be removed so that the Auth extension is the single source of truth
			// for all provider config actions.
			const applyConfig = async () => {
				await vscode.commands.executeCommand('positron-assistant.applyConfigAction', config, action, enrichedSources);
			};
			switch (action) {
				case 'save': {
					if (hasAuthProvider) {
						const accountId = await handleSave(config);
						addResult({ action, config, accountId });
					} else {
						await applyConfig();
					}
					break;
				}
				case 'delete':
					if (hasAuthProvider) {
						await handleDelete(config);
						addResult({ action, config });
					} else {
						await applyConfig();
					}
					break;
				case 'oauth-signin': {
					if (hasAuthProvider) {
						const accountId = await handleSave(config);
						addResult({ action: 'save', config, accountId });
					} else {
						await applyConfig();
					}
					break;
				}
				case 'oauth-signout': {
					if (hasAuthProvider) {
						await handleDelete(config);
						addResult({ action: 'delete', config });
					} else {
						await applyConfig();
					}
					break;
				}
				case 'cancel': {
					const provider = authProviders.get(config.provider);
					if (provider instanceof PositOAuthProvider) {
						provider.cancelSignIn();
					}
					await applyConfig();
					break;
				}
				default:
					throw new Error(
						vscode.l10n.t('Invalid action: {0}', action)
					);
			}
		},
		options
	);

	return results;
}

/**
 * Store or resolve credentials. For providers with an API key in the
 * config, validates and stores it. Otherwise resolves via createSession.
 */
async function handleSave(
	config: positron.ai.LanguageModelConfig
): Promise<string> {
	const provider = authProviders.get(config.provider);
	if (!provider) {
		throw new Error(
			vscode.l10n.t('No auth provider registered for {0}', config.provider)
		);
	}

	if (config.apiKey?.trim()) {
		return handleApiKeySave(config, provider);
	}

	const session = await provider.createSession([], {});
	return session.account.id;
}

async function handleApiKeySave(
	config: positron.ai.LanguageModelConfig,
	provider: AuthProvider
): Promise<string> {
	const apiKey = config.apiKey?.trim();
	if (!apiKey) {
		throw new Error(vscode.l10n.t('API key is required'));
	}
	const validateApiKey = apiKeyValidators.get(config.provider);
	if (validateApiKey) {
		await validateApiKey(apiKey, config);
	}

	const onSave = onSaveCallbacks.get(config.provider);
	if (onSave) {
		await onSave(config);
	}

	// Remove existing sessions so we don't accumulate stale credentials.
	const existing = await provider.getSessions();
	for (const session of existing) {
		await provider.removeSession(session.id);
	}

	const accountId = randomUUID();
	log.info(`Saving credential for provider "${config.provider}", name "${config.name}" (${accountId})`);
	await provider.storeKey(accountId, config.name, apiKey);
	return accountId;
}

async function handleDelete(
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const provider = authProviders.get(config.provider);
	if (!provider) {
		log.warn(`handleDelete: no auth provider for "${config.provider}"`);
		return;
	}
	const sessions = await provider.getSessions();
	// Credential-chain sessions (e.g. env var credentials) use the
	// provider ID as their session ID. These cannot be removed via the
	// UI -- the user must unset the environment variable and restart.
	const deletable = provider.chainPreventsSignOut
		? sessions.filter(s => s.id !== config.provider)
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
	log.info(`Deleting ${deletable.length} session(s) for provider "${config.provider}"`);
	for (const session of deletable) {
		await provider.removeSession(session.id);
	}
}

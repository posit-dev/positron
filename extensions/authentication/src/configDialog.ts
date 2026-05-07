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

const PROVIDER_ENABLE_SETTINGS_SEARCH = 'positron.assistant.provider enable';

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
			// Copilot authenticates via GitHub's built-in auth provider ('github'),
			// not a registered AuthProvider, so we check its session directly.
			if (source.provider.id === 'copilot-auth') {
				try {
					const session = await vscode.authentication.getSession('github', [], { silent: true });
					const signedIn = !!session;
					return {
						...source,
						signedIn,
						defaults: {
							...source.defaults,
							autoconfigure: source.defaults.autoconfigure
								? { ...source.defaults.autoconfigure, signedIn }
								: source.defaults.autoconfigure,
						},
					};
				} catch {
					return source;
				}
			}
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
			if (signedIn && source.provider.id === 'snowflake-cortex' && hasManagedCredentials(SNOWFLAKE_MANAGED_CREDENTIALS)) {
				return {
					...source,
					signedIn,
					defaults: {
						...source.defaults,
						autoconfigure: {
							type: positron.ai.LanguageModelAutoconfigureType.Custom,
							message: SNOWFLAKE_MANAGED_CREDENTIALS.displayName,
							signedIn: true,
						},
					},
				};
			}
			if (signedIn && source.defaults.autoconfigure) {
				return {
					...source,
					signedIn,
					defaults: {
						...source.defaults,
						autoconfigure: {
							...source.defaults.autoconfigure,
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
 * Show the language model configuration dialog. Builds the sources array
 * from registered provider definitions, enriches with credential state,
 * and handles all save/delete actions directly.
 *
 * Called via `vscode.commands.executeCommand('authentication.configureProviders', options)`.
 */
export async function showConfigurationDialog(
	options?: positron.ai.ShowLanguageModelConfigOptions
): Promise<void> {
	const enabledProviders = await positron.ai.getEnabledProviders();

	if (enabledProviders.length === 0) {
		const settingsAction = vscode.l10n.t('Open Settings');
		const docsAction = vscode.l10n.t('View Documentation');
		const result = await vscode.window.showInformationMessage(
			vscode.l10n.t('No language model providers are enabled. Enable at least one provider in Settings.'),
			settingsAction,
			docsAction
		);

		if (result === settingsAction) {
			await vscode.commands.executeCommand('workbench.action.openSettings', PROVIDER_ENABLE_SETTINGS_SEARCH);
		} else if (result === docsAction) {
			await vscode.env.openExternal(vscode.Uri.parse('https://positron.posit.co/assistant-getting-started'));
		}
		return;
	}

	const allSources = getProviderSources();
	const sources = allSources.filter(s => enabledProviders.includes(s.provider.id));
	const enrichedSources = await enrichWithCredentialState(sources);
	log.info(`Opening config dialog with ${enrichedSources.length} source(s)`);

	await positron.ai.showLanguageModelConfig(
		enrichedSources,
		async (config, action) => {
			log.info(`Config dialog action: "${action}" for provider "${config.provider}"`);
			const hasAuthProvider = authProviders.has(config.provider);
			switch (action) {
				case 'save':
				case 'oauth-signin': {
					if (config.provider === 'copilot-auth') {
						await handleCopilotSignIn();
						break;
					}
					if (hasAuthProvider) {
						await handleSave(config);
						notifyModelAdded(config);
					}
					break;
				}
				case 'delete':
				case 'oauth-signout': {
					if (hasAuthProvider) {
						await handleDelete(config);
						notifyModelRemoved(config);
					}
					break;
				}
				case 'cancel': {
					const provider = authProviders.get(config.provider);
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
		},
		options
	);
}

const GITHUB_SCOPES = ['read:user', 'user:email', 'repo', 'workflow'];

async function handleCopilotSignIn(): Promise<void> {
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

	if (config.apiKey !== undefined) {
		return handleApiKeySave(config, provider);
	}

	// Persist settings (e.g. base URL) before resolving the chain
	// so the chain validator uses the value the user just entered.
	const onSave = onSaveCallbacks.get(config.provider);
	if (onSave) {
		await onSave(config);
	}

	const session = await provider.createSession([], {});
	return session.account.id;
}

async function handleApiKeySave(
	config: positron.ai.LanguageModelConfig,
	provider: AuthProvider
): Promise<string> {
	const apiKey = config.apiKey?.trim() ?? '';
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

function notifyModelAdded(
	config: positron.ai.LanguageModelConfig,
): void {
	positron.ai.addLanguageModelConfig({
		type: positron.PositronLanguageModelType.Chat,
		provider: { id: config.provider, displayName: config.name, settingName: '' },
		supportedOptions: [],
		defaults: { name: config.name, model: config.model },
		signedIn: true,
	});
	vscode.window.showInformationMessage(
		vscode.l10n.t('Language Model {0} has been added successfully.', config.name)
	);
}

function notifyModelRemoved(
	config: positron.ai.LanguageModelConfig,
): void {
	positron.ai.removeLanguageModelConfig({
		type: positron.PositronLanguageModelType.Chat,
		provider: { id: config.provider, displayName: config.name, settingName: '' },
		supportedOptions: [],
		defaults: { name: config.name, model: config.model },
		signedIn: false,
	});
}

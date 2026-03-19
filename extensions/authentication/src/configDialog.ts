/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';
import { ApiKeyAuthenticationProvider } from './apiKeyProvider';
import { log } from './log';

export interface ConfigDialogResult {
	action: string;
	config: positron.ai.LanguageModelConfig;
	accountId?: string;
}

export type ApiKeyValidator = (apiKey: string, config: positron.ai.LanguageModelConfig) => Promise<void>;

export interface RegisterApiKeyProviderOptions {
	validateApiKey?: ApiKeyValidator;
}

export const apiKeyProviders = new Map<string, ApiKeyAuthenticationProvider>();
const apiKeyValidators = new Map<string, ApiKeyValidator>();

/**
 * Register an API key provider so the config dialog can store/remove
 * credentials through it.
 */
export function registerApiKeyProvider(
	providerId: string,
	provider: ApiKeyAuthenticationProvider,
	options?: RegisterApiKeyProviderOptions
): void {
	apiKeyProviders.set(providerId, provider);
	if (options?.validateApiKey) {
		apiKeyValidators.set(providerId, options.validateApiKey);
	} else {
		apiKeyValidators.delete(providerId);
	}
}

/**
 * Enrich sources with credential state from registered authentication providers.
 * For each source whose provider.id matches a registered auth provider, check
 * whether a session exists and set signedIn accordingly.
 */
async function enrichWithCredentialState(
	sources: positron.ai.LanguageModelSource[]
): Promise<positron.ai.LanguageModelSource[]> {
	return Promise.all(sources.map(async (source) => {
		const provider = apiKeyProviders.get(source.provider.id);
		if (!provider) {
			return source;
		}
		try {
			const sessions = await provider.getSessions();
			if (sessions.length > 0) {
				return { ...source, signedIn: true };
			}
		} catch (err) {
			log.error(`Failed to check credential state for ${source.provider.id}: ${err instanceof Error ? err.message : String(err)}`);
			return source;
		}
		return { ...source, signedIn: false };
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
			const hasAuthProvider = apiKeyProviders.has(config.provider);
			switch (action) {
				case 'save': {
					if (hasAuthProvider) {
						const accountId = await handleSave(config);
						addResult({ action, config, accountId });
					} else {
						await vscode.commands.executeCommand('positron-assistant.applyConfigAction', config, action, enrichedSources);
					}
					break;
				}
				case 'delete':
					if (hasAuthProvider) {
						await handleDelete(config);
						addResult({ action, config });
					} else {
						await vscode.commands.executeCommand('positron-assistant.applyConfigAction', config, action, enrichedSources);
					}
					break;
				case 'oauth-signin':
					if (hasAuthProvider) {
						addResult({ action, config });
					} else {
						await vscode.commands.executeCommand('positron-assistant.applyConfigAction', config, action, enrichedSources);
					}
					break;
				case 'oauth-signout':
					if (hasAuthProvider) {
						addResult({ action, config });
					} else {
						await vscode.commands.executeCommand('positron-assistant.applyConfigAction', config, action, enrichedSources);
					}
					break;
				case 'cancel':
					await vscode.commands.executeCommand('positron-assistant.applyConfigAction', config, action, enrichedSources);
					break;
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
 * Store the API key credential. Returns the generated account ID so the
 * caller can use it for model registration.
 */
async function handleSave(
	config: positron.ai.LanguageModelConfig
): Promise<string> {
	const provider = apiKeyProviders.get(config.provider);
	if (!provider) {
		throw new Error(
			vscode.l10n.t('No auth provider registered for {0}', config.provider)
		);
	}
	const apiKey = config.apiKey?.trim();
	if (!apiKey) {
		throw new Error(vscode.l10n.t('API key is required'));
	}
	const validateApiKey = apiKeyValidators.get(config.provider);
	if (validateApiKey) {
		await validateApiKey(apiKey, config);
	}
	const accountId = randomUUID();
	log.info(`Saving credential for provider "${config.provider}", name "${config.name}" (${accountId})`);
	await provider.storeKey(accountId, config.name, apiKey);
	return accountId;
}

async function handleDelete(
	config: positron.ai.LanguageModelConfig
): Promise<void> {
	const provider = apiKeyProviders.get(config.provider);
	if (!provider) {
		log.warn(`handleDelete: no auth provider for "${config.provider}"`);
		return;
	}
	const sessions = await provider.getSessions();
	log.info(`Deleting ${sessions.length} session(s) for provider "${config.provider}"`);
	for (const session of sessions) {
		await provider.removeSession(session.id);
	}
}

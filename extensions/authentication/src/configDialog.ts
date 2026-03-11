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

export const apiKeyProviders = new Map<string, ApiKeyAuthenticationProvider>();

/**
 * Register an API key provider so the config dialog can store/remove
 * credentials through it.
 */
export function registerApiKeyProvider(
	providerId: string,
	provider: ApiKeyAuthenticationProvider
): void {
	apiKeyProviders.set(providerId, provider);
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
		if (!apiKeyProviders.has(source.provider.id)) {
			return source;
		}
		try {
			const session = await vscode.authentication.getSession(
				source.provider.id, [], { silent: true }
			);
			if (session) {
				return { ...source, signedIn: true };
			}
		} catch (err) {
			log.warn(`Failed to check credential state for ${source.provider.id}: ${err}`);
		}
		return source;
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

	await positron.ai.showLanguageModelConfig(
		enrichedSources,
		async (config, action) => {
			log.info(`Config dialog action: "${action}" for provider "${config.provider}"`);
			switch (action) {
				case 'save': {
					if (apiKeyProviders.has(config.provider)) {
						const accountId = await handleSave(config);
						results.push({ action, config, accountId });
					} else {
						results.push({ action, config });
					}
					break;
				}
				case 'delete':
					if (apiKeyProviders.has(config.provider)) {
						await handleDelete(config);
					}
					results.push({ action, config });
					break;
				case 'oauth-signin':
					// Phase 5: handle OAuth sign-in
					results.push({ action, config });
					break;
				case 'oauth-signout':
					// Phase 5: handle OAuth sign-out
					results.push({ action, config });
					break;
				case 'cancel':
					// Phase 5: cancel pending OAuth operations
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

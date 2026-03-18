/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';
import { ApiKeyAuthenticationProvider } from './apiKeyProvider';
import { log } from './log';
import {
	hasManagedCredentials, AWS_MANAGED_CREDENTIALS,
	FOUNDRY_MANAGED_CREDENTIALS, ManagedCredentialConfig,
} from './managedCredentials';

/**
 * Maps model provider IDs to auth provider IDs when they differ.
 * Sources arrive from positron-assistant with model provider IDs;
 * the auth extension registers providers under auth provider IDs.
 */
const MODEL_TO_AUTH_ID: Record<string, string> = {
	'amazon-bedrock': 'aws',
};

/** Resolve a source/config provider ID to the auth provider ID. */
function resolveAuthId(providerId: string): string {
	return MODEL_TO_AUTH_ID[providerId] ?? providerId;
}

const MANAGED_CREDENTIAL_MAP: Record<string, ManagedCredentialConfig> = {
	'aws': AWS_MANAGED_CREDENTIALS,
	'ms-foundry': FOUNDRY_MANAGED_CREDENTIALS,
};

export interface ConfigDialogResult {
	action: string;
	config: positron.ai.LanguageModelConfig;
	accountId?: string;
}

/**
 * Registry of auth providers keyed by auth provider ID.
 */
const authProviders = new Map<string, vscode.AuthenticationProvider>();

/**
 * Register an auth provider so the config dialog can check credential
 * state, sign in, and sign out.
 */
export function registerAuthProvider(
	authProviderId: string,
	provider: vscode.AuthenticationProvider
): void {
	authProviders.set(authProviderId, provider);
}

/**
 * Get the API key provider for a given auth provider ID, if it is one.
 * Used by the migrateApiKey command which needs the typed provider.
 */
export function getApiKeyProvider(
	authProviderId: string
): ApiKeyAuthenticationProvider | undefined {
	const provider = authProviders.get(authProviderId);
	if (provider instanceof ApiKeyAuthenticationProvider) {
		return provider;
	}
	return undefined;
}

async function enrichWithCredentialState(
	sources: positron.ai.LanguageModelSource[]
): Promise<positron.ai.LanguageModelSource[]> {
	return Promise.all(sources.map(async (source) => {
		const authId = resolveAuthId(source.provider.id);
		const provider = authProviders.get(authId);
		if (!provider || source.signedIn) {
			return source;
		}
		try {
			const session = await vscode.authentication.getSession(
				authId, [], { silent: true }
			);
			if (session) {
				const managedConfig = MANAGED_CREDENTIAL_MAP[authId];
				if (managedConfig && hasManagedCredentials(managedConfig)) {
					return {
						...source,
						signedIn: true,
						defaults: {
							...source.defaults,
							autoconfigure: {
								type: positron.ai.LanguageModelAutoconfigureType.Custom,
								message: managedConfig.displayName,
								signedIn: true,
							}
						},
					};
				}
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
 * Sources arrive with model provider IDs (e.g. 'amazon-bedrock').
 * The auth extension maps these to auth provider IDs internally via
 * `resolveAuthId` for provider lookups and session checks.
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
			const authId = resolveAuthId(config.provider);
			const provider = authProviders.get(authId);
			switch (action) {
				case 'save': {
					if (provider instanceof ApiKeyAuthenticationProvider && config.apiKey?.trim()) {
						const accountId = await handleApiKeySave(config, provider);
						// Persist baseUrl to auth extension settings
						if (config.provider === 'ms-foundry' && config.baseUrl?.trim()) {
							await vscode.workspace
								.getConfiguration('authentication.foundry')
								.update('baseUrl', config.baseUrl.trim(), vscode.ConfigurationTarget.Global);
						}
						results.push({ action, config, accountId });
					} else if (provider && !(provider instanceof ApiKeyAuthenticationProvider)) {
						// Non-API-key providers (e.g. AWS) resolve
						// credentials via createSession without prompts.
						await handleSignIn(config, provider);
						results.push({ action, config });
					} else {
						results.push({ action, config });
					}
					break;
				}
				case 'delete':
					await handleDelete(config, provider);
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

async function handleApiKeySave(
	config: positron.ai.LanguageModelConfig,
	provider: ApiKeyAuthenticationProvider
): Promise<string> {
	const apiKey = config.apiKey?.trim();
	if (!apiKey) {
		throw new Error(vscode.l10n.t('API key is required'));
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

async function handleSignIn(
	config: positron.ai.LanguageModelConfig,
	provider: vscode.AuthenticationProvider
): Promise<void> {
	log.info(`Re-resolving credentials for provider "${config.provider}"`);
	await provider.createSession([], {});
}

async function handleDelete(
	config: positron.ai.LanguageModelConfig,
	provider: vscode.AuthenticationProvider | undefined
): Promise<void> {
	if (!provider) {
		log.warn(`handleDelete: no auth provider for "${config.provider}"`);
		return;
	}
	const sessions = await provider.getSessions([], {});
	log.info(`Deleting ${sessions.length} session(s) for provider "${config.provider}"`);
	for (const session of sessions) {
		await provider.removeSession(session.id);
	}
}

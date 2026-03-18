/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Temporary routing layer for per-provider credential migration to the
// authentication extension. Authentication for these providers are managed by
// the auth extension's vscode.authentication API.
// Remove this file when all providers are migrated.

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ModelProviderLogger } from './providers/base/modelProviderLogger.js';

/** Result returned by the auth extension's config dialog command. */
export interface ConfigDialogResult {
	action: string;
	config: positron.ai.LanguageModelConfig;
	accountId?: string;
}

/** Providers whose credentials are managed by the authentication extension. */
const AUTH_EXT_PROVIDERS = new Set<string>([
	'anthropic-api',
	'ms-foundry',
	'amazon-bedrock',
]);

/**
 * Maps model provider IDs to auth provider IDs when they differ.
 * Most providers use the same ID for both; AWS is the exception
 * because the auth provider is generic ('aws') while the model
 * provider is service-specific ('amazon-bedrock').
 */
const AUTH_PROVIDER_ID_MAP: Record<string, string> = {
	'amazon-bedrock': 'aws',
};

/** Reverse of AUTH_PROVIDER_ID_MAP: auth provider ID -> model provider ID. */
const MODEL_PROVIDER_ID_MAP: Record<string, string> = Object.fromEntries(
	Object.entries(AUTH_PROVIDER_ID_MAP).map(([k, v]) => [v, k])
);

export function isAuthExtProvider(providerId: string): boolean {
	return AUTH_EXT_PROVIDERS.has(providerId);
}

/**
 * Returns the model provider ID for an auth provider ID, or undefined
 * if the auth provider is not managed by the authentication extension.
 */
export function resolveModelProviderId(
	authProviderId: string
): string | undefined {
	// Check reverse map first (e.g. 'aws' -> 'amazon-bedrock')
	const mapped = MODEL_PROVIDER_ID_MAP[authProviderId];
	if (mapped) {
		return mapped;
	}
	// For providers where auth ID == model ID (e.g. 'anthropic-api')
	if (AUTH_EXT_PROVIDERS.has(authProviderId)) {
		return authProviderId;
	}
	return undefined;
}

function resolveAuthProviderId(modelProviderId: string): string {
	return AUTH_PROVIDER_ID_MAP[modelProviderId] ?? modelProviderId;
}

/**
 * Read an API key from the auth extension via vscode.authentication.
 * Falls back to context.secrets for legacy keys and migrates them to
 * the auth extension on first read.
 */
export async function getApiKey(
	providerId: string,
	accountId: string,
	label: string,
	secrets: vscode.SecretStorage
): Promise<string | undefined> {
	const providerLogger = new ModelProviderLogger(label);
	const authProviderId = resolveAuthProviderId(providerId);
	try {
		const session = await vscode.authentication.getSession(
			authProviderId, [], { silent: true, account: { id: accountId, label: '' } }
		);
		if (session?.accessToken) {
			providerLogger.logAuthentication('success', 'via Authentication extension');
			return session.accessToken;
		}
	} catch (err) {
		providerLogger.warn(`Failed to read auth session for ${accountId}`, err);
	}
	const legacyKey = await secrets.get(`apiKey-${accountId}`);
	if (legacyKey) {
		providerLogger.info(`Migrating legacy API key for ${accountId} to auth extension`);
		try {
			await vscode.commands.executeCommand(
				'authentication.migrateApiKey', providerId, accountId, label, legacyKey
			);
			await secrets.delete(`apiKey-${accountId}`);
		} catch (err) {
			providerLogger.warn(`Migration failed for ${accountId}, using legacy key`, err);
		}
	}
	return legacyKey;
}

/**
 * Resolve an API key for a stored model config. Routes to the auth
 * extension for migrated providers, falls back to legacy secret storage.
 */
export async function resolveApiKey(
	config: { provider: string; id: string; name: string },
	secrets: vscode.SecretStorage
): Promise<string | undefined> {
	return isAuthExtProvider(config.provider)
		? getApiKey(config.provider, config.id, config.name, secrets)
		: secrets.get(`apiKey-${config.id}`);
}

/**
 * Delegate the config dialog to the authentication extension.
 * Sources keep their original model provider IDs so the UI can
 * match icons and events. The auth extension handles the
 * model-to-auth ID mapping internally for provider lookups.
 */
export async function delegateConfigDialog(
	sources: positron.ai.LanguageModelSource[],
	options?: positron.ai.ShowLanguageModelConfigOptions
): Promise<ConfigDialogResult[]> {
	const results = await vscode.commands.executeCommand<ConfigDialogResult[]>(
		'authentication.configureProviders', sources, options
	);
	return results ?? [];
}

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
]);

export function isAuthExtProvider(providerId: string): boolean {
	return AUTH_EXT_PROVIDERS.has(providerId);
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
	try {
		const session = await vscode.authentication.getSession(
			providerId, [], { silent: true, account: { id: accountId, label: '' } }
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
 * Returns the actions taken so the caller can handle model lifecycle.
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

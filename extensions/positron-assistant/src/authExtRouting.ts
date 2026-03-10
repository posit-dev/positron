/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---
// Temporary routing layer for per-provider credential migration to the
// authentication extension. Providers listed here store and read API keys
// through the auth extension's vscode.authentication API instead of
// context.secrets directly. Remove this file when all providers are migrated
// (Phase 7).
// --- End Positron ---

import * as vscode from 'vscode';
import { log } from './log.js';

/** Providers whose credentials are managed by the authentication extension. */
const AUTH_EXT_PROVIDERS = new Set<string>([
	'anthropic-api',
]);

export function isAuthExtProvider(providerId: string): boolean {
	return AUTH_EXT_PROVIDERS.has(providerId);
}

export async function storeApiKey(
	providerId: string,
	accountId: string,
	label: string,
	key: string
): Promise<void> {
	await vscode.commands.executeCommand(
		'authentication.storeApiKey', providerId, accountId, label, key
	);
}

export async function getApiKey(
	providerId: string,
	accountId: string
): Promise<string | undefined> {
	try {
		const session = await vscode.authentication.getSession(
			providerId, [], { silent: true, account: { id: accountId, label: '' } }
		);
		return session?.accessToken;
	} catch (err) {
		log.warn(`Failed to read auth session for ${providerId}/${accountId}: ${err}`);
		return undefined;
	}
}

/**
 * Migrate a legacy API key from context.secrets to the auth extension.
 * Returns the key if migration succeeded or the key was already in the
 * auth extension; undefined if no key exists anywhere.
 */
export async function getApiKeyWithMigration(
	providerId: string,
	accountId: string,
	label: string,
	secrets: vscode.SecretStorage
): Promise<string | undefined> {
	const authKey = await getApiKey(providerId, accountId);
	if (authKey) {
		return authKey;
	}
	const legacyKey = await secrets.get(`apiKey-${accountId}`);
	if (!legacyKey) {
		return undefined;
	}
	log.info(`Migrating legacy API key for ${providerId}/${accountId} to auth extension`);
	await storeApiKey(providerId, accountId, label, legacyKey);
	await secrets.delete(`apiKey-${accountId}`);
	return legacyKey;
}

export async function removeApiKey(
	providerId: string,
	accountId: string
): Promise<void> {
	await vscode.commands.executeCommand(
		'authentication.removeApiKey', providerId, accountId
	);
}

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
	} catch {
		return undefined;
	}
}

export async function removeApiKey(
	providerId: string,
	accountId: string
): Promise<void> {
	await vscode.commands.executeCommand(
		'authentication.removeApiKey', providerId, accountId
	);
}

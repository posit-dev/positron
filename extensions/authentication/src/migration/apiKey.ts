/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getAuthProvider } from '../configDialog';
import { log } from '../log';

/**
 * Register the command that migrates API keys from positron-assistant
 * secret storage to the auth extension.
 */
export function registerMigrateApiKeyCommand(
	context: vscode.ExtensionContext
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'authentication.migrateApiKey',
			async (providerId: string, accountId: string, label: string, key: string) => {
				const provider = getAuthProvider(providerId);
				if (!provider) {
					throw new Error(vscode.l10n.t("No auth provider registered for {0}", providerId));
				}
				const existing = await provider.getSessions([], { account: { id: accountId, label: '' } });
				if (existing.length > 0) {
					log.info(`Skipping migration for ${providerId}/${accountId}: session already exists`);
					return;
				}
				await provider.storeKey(accountId, label, key);
			}
		)
	);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ApiKeyAuthenticationProvider } from './apiKeyProvider';
import { apiKeyProviders, registerApiKeyProvider, showConfigurationDialog } from './configDialog';
import { log } from './log';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(log);

	registerAnthropicProvider(context);
	log.info('Authentication extension activated');

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'authentication.configureProviders',
			async (
				sources?: positron.ai.LanguageModelSource[],
				options?: positron.ai.ShowLanguageModelConfigOptions
			) => {
				return showConfigurationDialog(sources ?? [], options);
			}
		),
		vscode.commands.registerCommand(
			'authentication.migrateApiKey',
			async (providerId: string, accountId: string, label: string, key: string) => {
				const provider = apiKeyProviders.get(providerId);
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

function registerAnthropicProvider(context: vscode.ExtensionContext): void {
	const provider = new ApiKeyAuthenticationProvider(
		'anthropic-api', 'Anthropic', context
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'anthropic-api', 'Anthropic', provider,
			{ supportsMultipleAccounts: true }
		),
		provider
	);
	registerApiKeyProvider('anthropic-api', provider);
	log.info('Registered auth provider: anthropic-api');
}

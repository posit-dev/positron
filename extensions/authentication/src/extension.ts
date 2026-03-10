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
				await showConfigurationDialog(sources ?? [], options);
			}
		),
		vscode.commands.registerCommand(
			'authentication.storeApiKey',
			async (providerId: string, accountId: string, label: string, key: string) => {
				const provider = apiKeyProviders.get(providerId);
				if (!provider) {
					throw new Error(`No auth provider registered for ${providerId}`);
				}
				await provider.storeKey(accountId, label, key);
			}
		),
		vscode.commands.registerCommand(
			'authentication.removeApiKey',
			async (providerId: string, accountId: string) => {
				const provider = apiKeyProviders.get(providerId);
				if (!provider) {
					throw new Error(`No auth provider registered for ${providerId}`);
				}
				await provider.removeSession(accountId);
			}
		),
		// TODO: Remove before merging. Dev-only command for testing auth flow.
		vscode.commands.registerCommand(
			'authentication.testSignIn',
			async () => {
				const session = await vscode.authentication.getSession(
					'anthropic-api', [], { createIfNone: true }
				);
				log.info(`Test sign-in result: ${session.account.label} (${session.account.id})`);
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

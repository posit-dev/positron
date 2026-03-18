/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ApiKeyAuthenticationProvider } from './apiKeyProvider';
import { AwsAuthProvider } from './awsAuthProvider';
import { getApiKeyProvider, registerAuthProvider, showConfigurationDialog } from './configDialog';
import { log } from './log';
import { FOUNDRY_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(log);

	registerAnthropicProvider(context);
	registerFoundryProvider(context);

	// Migrate settings before registering the AWS provider so it
	// reads the new setting values during initialization.
	await migrateAwsSettings().catch(err =>
		log.error(`AWS settings migration failed: ${err}`)
	);
	await registerAwsProvider(context);
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
				const provider = getApiKeyProvider(providerId);
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
	registerAuthProvider('anthropic-api', provider);
	log.info('Registered auth provider: anthropic-api');
}

async function registerAwsProvider(context: vscode.ExtensionContext): Promise<void> {
	const provider = new AwsAuthProvider();
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'aws', 'AWS', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider('aws', provider);
	await provider.resolveInitialCredentials();
	log.info('Registered auth provider: aws');
}

/**
 * Migrate AWS settings from positron-assistant to the auth extension.
 * Reads old settings and writes them to the new location if not already set.
 */
async function migrateAwsSettings(): Promise<void> {
	type AwsVars = { AWS_PROFILE?: string; AWS_REGION?: string };

	const oldVars = vscode.workspace
		.getConfiguration('positron.assistant.providerVariables')
		.inspect<AwsVars>('bedrock');
	const oldInference = vscode.workspace
		.getConfiguration('positron.assistant.bedrock')
		.inspect<string>('inferenceProfileRegion');

	const newVars = vscode.workspace
		.getConfiguration('authentication.aws')
		.inspect<AwsVars>('credentials');
	const newInference = vscode.workspace
		.getConfiguration('authentication.aws')
		.inspect<string>('inferenceProfileRegion');

	const newConfig = vscode.workspace
		.getConfiguration('authentication.aws');

	// Copy the credentials object as-is
	if (oldVars?.globalValue && !newVars?.globalValue) {
		await newConfig.update(
			'credentials', oldVars.globalValue,
			vscode.ConfigurationTarget.Global
		);
	}
	if (oldVars?.workspaceValue && !newVars?.workspaceValue) {
		await newConfig.update(
			'credentials', oldVars.workspaceValue,
			vscode.ConfigurationTarget.Workspace
		);
	}

	// Copy inferenceProfileRegion
	if (oldInference?.globalValue && !newInference?.globalValue) {
		await newConfig.update(
			'inferenceProfileRegion', oldInference.globalValue,
			vscode.ConfigurationTarget.Global
		);
	}
	if (oldInference?.workspaceValue && !newInference?.workspaceValue) {
		await newConfig.update(
			'inferenceProfileRegion', oldInference.workspaceValue,
			vscode.ConfigurationTarget.Workspace
		);
	}

	log.info('AWS settings migration complete');
}

function registerFoundryProvider(context: vscode.ExtensionContext): void {
	const provider = new ApiKeyAuthenticationProvider(
		'ms-foundry', 'Microsoft Foundry', context,
		{
			authProviderId: FOUNDRY_MANAGED_CREDENTIALS.authProvider.id,
			scopes: FOUNDRY_MANAGED_CREDENTIALS.authProvider.scopes,
			isAvailable: () => hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS),
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'ms-foundry', 'Microsoft Foundry', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider('ms-foundry', provider);
	log.info('Registered auth provider: ms-foundry');

	// Sync Workbench endpoint to auth extension setting
	if (hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS)) {
		const endpoint = vscode.workspace
			.getConfiguration('positWorkbench.foundry')
			.get<string>('endpoint', '');
		if (endpoint) {
			vscode.workspace
				.getConfiguration('authentication.foundry')
				.update('baseUrl', endpoint, vscode.ConfigurationTarget.Global)
				.then(undefined, err => log.error(`Failed to sync Foundry endpoint: ${err}`));
		}
	}
}

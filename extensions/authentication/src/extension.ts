/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AuthProvider } from './authProvider';
import { getAuthProvider, registerAuthProvider, showConfigurationDialog } from './configDialog';
import { normalizeToV1Url, validateAnthropicApiKey, validateFoundryApiKey } from './validation';
import { FOUNDRY_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';
import { log } from './log';

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

function registerAnthropicProvider(context: vscode.ExtensionContext): void {
	const provider = new AuthProvider(
		'anthropic-api', 'Anthropic', context
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'anthropic-api', 'Anthropic', provider,
			{ supportsMultipleAccounts: true }
		),
		provider
	);
	registerAuthProvider('anthropic-api', provider, {
		validateApiKey: validateAnthropicApiKey,
	});
	log.info('Registered auth provider: anthropic-api');
}

async function registerAwsProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const awsConfig = vscode.workspace
		.getConfiguration('authentication.aws')
		.get<{ AWS_PROFILE?: string; AWS_REGION?: string }>(
			'credentials', {}
		);

	const profile = awsConfig?.AWS_PROFILE
		?? process.env.AWS_PROFILE;
	const region = awsConfig?.AWS_REGION
		?? process.env.AWS_REGION ?? 'us-east-1';

	const credentialProvider = fromNodeProviderChain(
		profile ? { profile } : {}
	);

	log.info(
		`[AWS] Credential chain initialized ` +
		`(region=${region}, profile=${profile ?? '(default)'})`
	);

	const provider = new AuthProvider(
		'amazon-bedrock', 'AWS', context,
		undefined,
		{
			resolve: async () => {
				const resolved = await credentialProvider();
				return JSON.stringify({
					accessKeyId: resolved.accessKeyId,
					secretAccessKey: resolved.secretAccessKey,
					sessionToken: resolved.sessionToken,
				});
			},
			refreshIntervalMs: 10 * 60 * 1000,
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'amazon-bedrock', 'AWS', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider('amazon-bedrock', provider);
	await provider.resolveChainCredentials();
	log.info('Registered auth provider: amazon-bedrock');
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
	const provider = new AuthProvider(
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
	registerAuthProvider('ms-foundry', provider, {
		validateApiKey: validateFoundryApiKey,
		onSave: async (config) => {
			if (config.baseUrl) {
				config.baseUrl = normalizeToV1Url(config.baseUrl);
				await vscode.workspace
					.getConfiguration('authentication.foundry')
					.update('baseUrl', config.baseUrl, vscode.ConfigurationTarget.Global);
			}
		},
	});
	log.info('Registered auth provider: ms-foundry');

	// Sync Workbench endpoint to auth extension setting
	if (hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS)) {
		const endpoint = vscode.workspace
			.getConfiguration('positWorkbench.foundry')
			.get<string>('endpoint', '');
		if (endpoint) {
			const normalized = normalizeToV1Url(endpoint);
			vscode.workspace
				.getConfiguration('authentication.foundry')
				.update('baseUrl', normalized, vscode.ConfigurationTarget.Global)
				.then(undefined, err => log.error(`Failed to sync Foundry endpoint: ${err}`));
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AuthProvider } from './authProvider';
import { registerAuthProvider, showConfigurationDialog } from './configDialog';
import { normalizeToV1Url, validateAnthropicApiKey, validateFoundryApiKey, validateSnowflakeApiKey } from './validation';
import { FOUNDRY_MANAGED_CREDENTIALS, hasManagedCredentials, SNOWFLAKE_MANAGED_CREDENTIALS } from './managedCredentials';
import { detectSnowflakeCredentials, getSnowflakeConnectionsTomlPath } from './snowflakeCredentials';
import { CREDENTIAL_REFRESH_INTERVAL_MS } from './constants';
import * as fs from 'fs';
import { log } from './log';
import { migrateAwsSettings } from './migration/aws';
import { migrateSnowflakeSettings } from './migration/snowflake';
import { registerMigrateApiKeyCommand } from './migration/apiKey';

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(log);

	registerAnthropicProvider(context);
	registerFoundryProvider(context);

	// Migrate settings before registering providers so they
	// read the migrated values during initialization.
	await migrateAwsSettings().catch(err =>
		log.error(`AWS settings migration failed: ${err}`)
	);
	registerAwsProvider(context);

	await migrateSnowflakeSettings().catch(err =>
		log.error(`Snowflake settings migration failed: ${err}`)
	);
	registerSnowflakeProvider(context);

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
	);
	registerMigrateApiKeyCommand(context);
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

function registerAwsProvider(
	context: vscode.ExtensionContext
): void {
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
			refreshIntervalMs: CREDENTIAL_REFRESH_INTERVAL_MS,
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
	provider.resolveChainCredentials().catch(err =>
		log.debug(`[AWS] Initial credential resolution failed: ${err}`)
	);
	log.info('Registered auth provider: amazon-bedrock');
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

function registerSnowflakeProvider(context: vscode.ExtensionContext): void {
	let lastTomlCheck: number | undefined;

	const provider = new AuthProvider(
		'snowflake-cortex', 'Snowflake Cortex', context,
		undefined,
		{
			resolve: async () => {
				const credentials = await detectSnowflakeCredentials();
				if (!credentials) {
					throw new Error('No Snowflake credentials found');
				}
				// Sync detected account to settings for baseUrl derivation
				if (credentials.account) {
					const cfg = vscode.workspace.getConfiguration(
						'authentication.snowflake'
					);
					const current = cfg.get<Record<string, string>>(
						'credentials', {}
					);
					if (current.SNOWFLAKE_ACCOUNT !== credentials.account) {
						await cfg.update('credentials',
							{ ...current, SNOWFLAKE_ACCOUNT: credentials.account },
							vscode.ConfigurationTarget.Global
						).then(undefined, err =>
							log.error(`Failed to sync Snowflake account: ${err}`)
						);
					}
				}
				return credentials.token;
			},
			shouldRefresh: async () => {
				const tomlPath = getSnowflakeConnectionsTomlPath();
				if (!tomlPath) {
					return false;
				}
				try {
					const stats = await fs.promises.stat(tomlPath);
					const mtime = stats.mtime.getTime();
					if (!lastTomlCheck || mtime > lastTomlCheck) {
						lastTomlCheck = mtime;
						return true;
					}
					return false;
				} catch {
					return false;
				}
			},
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			'snowflake-cortex', 'Snowflake Cortex', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider('snowflake-cortex', provider, {
		validateApiKey: validateSnowflakeApiKey,
	});
	provider.resolveChainCredentials().catch(err =>
		log.debug(`[Snowflake] Initial credential resolution failed: ${err}`)
	);
	log.info('Registered auth provider: snowflake-cortex');
}

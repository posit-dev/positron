/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { ANTHROPIC_AUTH_PROVIDER_ID, AWS_AUTH_PROVIDER_ID, CREDENTIAL_REFRESH_INTERVAL_MS, FOUNDRY_AUTH_PROVIDER_ID, POSIT_AUTH_PROVIDER_ID } from './constants';
import { AuthProvider } from './authProvider';
import { registerAuthProvider, showConfigurationDialog } from './configDialog';
import { normalizeToV1Url, validateAnthropicApiKey, validateFoundryApiKey, validateSnowflakeApiKey } from './validation';
import { FOUNDRY_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';
import { detectSnowflakeCredentials, getSnowflakeConnectionsTomlPath } from './snowflakeCredentials';
import { PositOAuthProvider } from './positOAuthProvider';
import * as fs from 'fs';
import { log } from './log';
import { migrateAwsSettings } from './migration/aws';
import { migrateSnowflakeSettings } from './migration/snowflake';
import { registerMigrateApiKeyCommand } from './migration/apiKey';
import { AuthProviderLogger } from './authProviderLogger';

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(log);

	await registerAnthropicProvider(context);
	registerPositAIProvider(context);
	registerFoundryProvider(context);

	// Migrate settings before registering providers so they
	// read the migrated values during initialization.
	await registerAwsProvider(context);

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

async function registerAnthropicProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const logger = new AuthProviderLogger('Anthropic');

	// Sync ANTHROPIC_BASE_URL env var to the config setting before
	// chain resolution so validation uses the correct endpoint.
	const envBaseUrl = process.env.ANTHROPIC_BASE_URL;
	if (envBaseUrl) {
		await vscode.workspace
			.getConfiguration('authentication.anthropic')
			.update(
				'baseUrl', envBaseUrl,
				vscode.ConfigurationTarget.Global
			).then(undefined, err =>
				logger.logOperationError('sync Anthropic base URL', err)
			);
	}

	const provider = new AuthProvider(
		ANTHROPIC_AUTH_PROVIDER_ID, 'Anthropic', context,
		undefined,
		{
			resolve: async () => {
				const apiKey = process.env.ANTHROPIC_API_KEY;
				if (!apiKey) {
					throw new Error('ANTHROPIC_API_KEY not set');
				}
				const baseUrl = vscode.workspace
					.getConfiguration('authentication.anthropic')
					.get<string>('baseUrl') || undefined;
				await validateAnthropicApiKey(apiKey, {
					provider: ANTHROPIC_AUTH_PROVIDER_ID,
					name: 'Anthropic',
					model: '',
					type: positron.PositronLanguageModelType.Chat,
					...(baseUrl && { baseUrl }),
				});
				return apiKey;
			},
			preventSignOut: true,
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			ANTHROPIC_AUTH_PROVIDER_ID, 'Anthropic', provider,
			{ supportsMultipleAccounts: true }
		),
		provider
	);
	registerAuthProvider(ANTHROPIC_AUTH_PROVIDER_ID, provider, {
		validateApiKey: validateAnthropicApiKey,
		onSave: async (config) => {
			if (config.baseUrl) {
				await vscode.workspace
					.getConfiguration('authentication.anthropic')
					.update(
						'baseUrl', config.baseUrl,
						vscode.ConfigurationTarget.Global
					);
			}
		},
	});

	// Eagerly resolve env var credentials so the session is
	// available before positron-assistant registers models.
	await provider.resolveChainCredentials().catch(err =>
		logger.logCredentialResolution(
			'failed',
			`Initial credential resolution: ${err}`
		)
	);

	logger.info('Registered auth provider');
}

function registerPositAIProvider(context: vscode.ExtensionContext): void {
	const logger = new AuthProviderLogger('Posit AI');
	const provider = new PositOAuthProvider(context);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			POSIT_AUTH_PROVIDER_ID, 'Posit AI', provider
		),
		provider
	);
	registerAuthProvider(POSIT_AUTH_PROVIDER_ID, provider);
	logger.info('Registered auth provider');
}

async function registerAwsProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const logger = new AuthProviderLogger('AWS');

	await migrateAwsSettings().catch(err =>
		logger.logOperationError('settings migration', err)
	);

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

	logger.info(
		`Credential chain initialized ` +
		`(region=${region}, profile=${profile ?? '(default)'})`
	);

	const provider = new AuthProvider(
		AWS_AUTH_PROVIDER_ID, 'AWS', context,
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
			AWS_AUTH_PROVIDER_ID, 'AWS', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider(AWS_AUTH_PROVIDER_ID, provider);
	provider.resolveChainCredentials().catch(err =>
		logger.logCredentialResolution(
			'failed',
			`Initial credential resolution failed: ${err}`
		)
	);
	logger.info('Registered auth provider');
}

function registerFoundryProvider(context: vscode.ExtensionContext): void {
	const logger = new AuthProviderLogger('Microsoft Foundry');
	const provider = new AuthProvider(
		FOUNDRY_AUTH_PROVIDER_ID, 'Microsoft Foundry', context,
		{
			authProviderId: FOUNDRY_MANAGED_CREDENTIALS.authProvider.id,
			scopes: FOUNDRY_MANAGED_CREDENTIALS.authProvider.scopes,
			isAvailable: () => hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS),
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			FOUNDRY_AUTH_PROVIDER_ID, 'Microsoft Foundry', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider(FOUNDRY_AUTH_PROVIDER_ID, provider, {
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
	logger.info('Registered auth provider');

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
				.then(undefined, err =>
					logger.logOperationError('sync Foundry endpoint', err)
				);
		}
	}
}

function registerSnowflakeProvider(context: vscode.ExtensionContext): void {
	const logger = new AuthProviderLogger('Snowflake Cortex');
	let lastTomlCheck: number | undefined;
	let pendingMtime: number | undefined;

	const provider = new AuthProvider(
		'snowflake-cortex', 'Snowflake Cortex', context,
		undefined,
		{
			resolve: async () => {
				const credentials = await detectSnowflakeCredentials();
				if (!credentials) {
					throw new Error('No Snowflake credentials found');
				}
				// Sync detected account to global settings for baseUrl
				// derivation. Use inspect() to read only the global scope
				// so workspace-scoped values are not copied into global.
				if (credentials.account) {
					const cfg = vscode.workspace.getConfiguration(
						'authentication.snowflake'
					);
					const inspection = cfg.inspect<Record<string, string>>(
						'credentials'
					);
					const globalValue = inspection?.globalValue ?? {};
					if (globalValue.SNOWFLAKE_ACCOUNT !== credentials.account) {
						await cfg.update('credentials',
							{ ...globalValue, SNOWFLAKE_ACCOUNT: credentials.account },
							vscode.ConfigurationTarget.Global
						).then(undefined, err =>
							logger.logOperationError('sync Snowflake account', err)
						);
					}
				}
				// Advance mtime only after successful resolve so a failed
				// attempt retries on the next getSessions call.
				if (pendingMtime !== undefined) {
					lastTomlCheck = pendingMtime;
					pendingMtime = undefined;
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
						pendingMtime = mtime;
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
		logger.logCredentialResolution(
			'failed',
			`Initial credential resolution failed: ${err}`
		)
	);
	logger.info('Registered auth provider');
}

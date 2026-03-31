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
import { normalizeToV1Url, validateAnthropicApiKey, validateFoundryApiKey } from './validation';
import { FOUNDRY_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';
import { PositOAuthProvider } from './positOAuthProvider';
import { log } from './log';
import { migrateAwsSettings } from './migration/aws';
import { registerMigrateApiKeyCommand } from './migration/apiKey';

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(log);

	await registerAnthropicProvider(context);
	registerPositAIProvider(context);
	registerFoundryProvider(context);

	// Migrate settings before registering the AWS provider so it
	// reads the migrated profile/region during initialization.
	await migrateAwsSettings().catch(err =>
		log.error(`AWS settings migration failed: ${err}`)
	);
	registerAwsProvider(context);
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
				log.error(`Failed to sync Anthropic base URL: ${err}`)
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
		log.debug(`[Anthropic] Initial credential resolution: ${err}`)
	);

	log.info(`Registered auth provider: ${ANTHROPIC_AUTH_PROVIDER_ID}`);
}

function registerPositAIProvider(context: vscode.ExtensionContext): void {
	const provider = new PositOAuthProvider(context);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			POSIT_AUTH_PROVIDER_ID, 'Posit AI', provider
		),
		provider
	);
	registerAuthProvider(POSIT_AUTH_PROVIDER_ID, provider);
	log.info(`Registered auth provider: ${POSIT_AUTH_PROVIDER_ID}`);
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
		log.debug(`[AWS] Initial credential resolution failed: ${err}`)
	);
	log.info(`Registered auth provider: ${AWS_AUTH_PROVIDER_ID}`);
}

function registerFoundryProvider(context: vscode.ExtensionContext): void {
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
	log.info(`Registered auth provider: ${FOUNDRY_AUTH_PROVIDER_ID}`);

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

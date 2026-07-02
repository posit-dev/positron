/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
	ANTHROPIC_AUTH_PROVIDER_ID,
	AWS_AUTH_PROVIDER_ID,
	CREDENTIAL_REFRESH_INTERVAL_MS,
	CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
	DEEPSEEK_AUTH_PROVIDER_ID,
	FOUNDRY_AUTH_PROVIDER_ID,
	GEMINI_AUTH_PROVIDER_ID,
	GOOGLE_CLOUD_AUTH_PROVIDER_ID,
	OPENAI_AUTH_PROVIDER_ID,
	POSIT_AUTH_PROVIDER_ID,
} from './constants';
import { AuthProvider } from './authProvider';
import { registerAuthProvider, providerAction, updateProviderFromSessions, authProviders } from './configDialog';
import { getProviderSources } from './providerSources';
import {
	normalizeToV1Url,
	validateAnthropicApiKey,
	validateCustomProviderApiKey,
	validateDeepSeekApiKey,
	validateFoundryApiKey,
	validateGeminiApiKey,
	validateOpenaiApiKey,
	validateSnowflakeApiKey
} from './validation';
import { FOUNDRY_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';
import { detectSnowflakeCredentials, getSnowflakeConnectionsTomlPath } from './snowflakeCredentials';
import { PositOAuthProvider } from './positOAuthProvider';
import * as fs from 'fs';
import { log } from './log';
import { migrateAwsSettings } from './migration/aws';
import { migrateSnowflakeSettings } from './migration/snowflake';
import { registerMigrateApiKeyCommand } from './migration/apiKey';
import { AuthProviderLogger } from './authProviderLogger';
import { resolveGeapCredential } from './geapResolver';

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
	await registerSnowflakeProvider(context);

	await registerOpenaiProvider(context);
	await registerGeminiProvider(context);
	await registerGeapProvider(context);
	await registerDeepSeekProvider(context);
	registerCustomProvider(context);

	// Register providers so the Settings UI shows per-provider
	// enable toggles (positron.assistant.provider.<settingName>.enable).
	for (const source of getProviderSources()) {
		const disposable = positron.ai.registerProvider(source, providerAction);
		context.subscriptions.push(disposable);
	}

	// Reactive updates: send all auth session changes through updateProvider
	// so the dialog and other listeners see updated signedIn state immediately.
	context.subscriptions.push(
		vscode.authentication.onDidChangeSessions(async (e) => {
			const provider = authProviders.get(e.provider.id);
			if (provider) {
				const sessions = await provider.getSessions();
				await updateProviderFromSessions(e.provider.id, sessions);
			}
			// Copilot uses GitHub's built-in auth, not a registered AuthProvider
			if (e.provider.id === 'github') {
				const session = await vscode.authentication.getSession('github', [], { silent: true });
				await updateProviderFromSessions('copilot-auth', session ? [session] : []);
			}
		})
	);

	// Push initial state: credentials resolved during activation (env-var or
	// chain credentials) fire their session-change event before the listener
	// above is registered, so sweep current sessions once to reflect them.
	for (const source of getProviderSources()) {
		const provider = authProviders.get(source.provider.id);
		if (provider) {
			const sessions = await provider.getSessions();
			await updateProviderFromSessions(source.provider.id, sessions);
		}
	}
	const githubSession = await vscode.authentication.getSession('github', [], { silent: true });
	await updateProviderFromSessions('copilot-auth', githubSession ? [githubSession] : []);

	// Remove auth sessions when a provider is disabled in settings.
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e) => {
			for (const source of getProviderSources()) {
				const settingKeys = [
					`assistant.provider.${source.provider.settingName}.enabled`,
					`positron.assistant.provider.${source.provider.settingName}.enable`,
				];
				if (settingKeys.some(key => e.affectsConfiguration(key))) {
					const isEnabled = settingKeys.some(
						key => vscode.workspace.getConfiguration().get<boolean>(key)
					);
					if (!isEnabled) {
						const provider = authProviders.get(source.provider.id);
						if (provider) {
							const sessions = await provider.getSessions();
							for (const session of sessions) {
								await provider.removeSession(session.id);
							}
						}
					}
				}
			}
		})
	);

	log.info('Authentication extension activated');

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'authentication.configureProviders',
			async (options?: positron.ai.ShowLanguageModelConfigOptions) => {
				return positron.ai.showLanguageModelConfig(options);
			}
		),
	);
	registerMigrateApiKeyCommand(context);

	return { getLogs: () => log.formatEntriesForDiagnostics() };
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
				await validateAnthropicApiKey(apiKey, { baseUrl });
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
				return {
					token: JSON.stringify({
						accessKeyId: resolved.accessKeyId,
						secretAccessKey: resolved.secretAccessKey,
						sessionToken: resolved.sessionToken,
					}),
					expiration: resolved.expiration,
				};
			},
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
	await provider.resolveChainCredentials().catch(err =>
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

	// Forward Workbench session changes so consumers listening for
	// ms-foundry events are notified when the managed token arrives.
	context.subscriptions.push(
		vscode.authentication.onDidChangeSessions((e) => {
			if (e.provider.id === FOUNDRY_MANAGED_CREDENTIALS.authProvider.id) {
				provider.fireSessionsChanged({ added: [], removed: [], changed: [] });
			}
		})
	);

	// Sync Workbench endpoint to auth extension setting
	if (hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS)) {
		const endpoint = vscode.workspace
			.getConfiguration('posit.workbench.foundry')
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

async function registerSnowflakeProvider(context: vscode.ExtensionContext): Promise<void> {
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
		onSave: async (config) => {
			// baseUrl holds the bare account; persist it as SNOWFLAKE_ACCOUNT,
			// not as a baseUrl setting like other providers do (#13750).
			const account = config.baseUrl?.trim();
			if (!account) {
				return;
			}
			// Read the global scope only, matching the resolve() sync above.
			const cfg = vscode.workspace.getConfiguration('authentication.snowflake');
			const inspection = cfg.inspect<Record<string, string>>('credentials');
			const globalValue = inspection?.globalValue ?? {};
			if (globalValue.SNOWFLAKE_ACCOUNT !== account) {
				await cfg.update(
					'credentials',
					{ ...globalValue, SNOWFLAKE_ACCOUNT: account },
					vscode.ConfigurationTarget.Global
				);
			}
		},
	});
	await provider.resolveChainCredentials().catch(err =>
		logger.logCredentialResolution(
			'failed',
			`Initial credential resolution failed: ${err}`
		)
	);
	logger.info('Registered auth provider');
}

async function registerOpenaiProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const envBaseUrl = process.env.OPENAI_BASE_URL;
	if (envBaseUrl) {
		await vscode.workspace
			.getConfiguration(`authentication.${OPENAI_AUTH_PROVIDER_ID}`)
			.update(
				'baseUrl', envBaseUrl,
				vscode.ConfigurationTarget.Global
			).then(undefined, err =>
				log.error(`Failed to sync OpenAI base URL: ${err}`)
			);
	}

	const provider = new AuthProvider(
		OPENAI_AUTH_PROVIDER_ID, 'OpenAI', context,
		undefined,
		{
			resolve: async () => {
				const apiKey = process.env.OPENAI_API_KEY;
				if (!apiKey) {
					throw new Error('OPENAI_API_KEY not set');
				}
				const baseUrl = vscode.workspace
					.getConfiguration(`authentication.${OPENAI_AUTH_PROVIDER_ID}`)
					.get<string>('baseUrl') || undefined;
				await validateOpenaiApiKey(apiKey, { baseUrl });
				return apiKey;
			},
			preventSignOut: true,
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			OPENAI_AUTH_PROVIDER_ID, 'OpenAI', provider,
			{ supportsMultipleAccounts: true }
		),
		provider
	);
	registerAuthProvider(OPENAI_AUTH_PROVIDER_ID, provider, {
		validateApiKey: validateOpenaiApiKey,
		onSave: async (config) => {
			if (config.baseUrl) {
				await vscode.workspace
					.getConfiguration(`authentication.${OPENAI_AUTH_PROVIDER_ID}`)
					.update(
						'baseUrl', config.baseUrl,
						vscode.ConfigurationTarget.Global
					);
			}
		},
	});

	await provider.resolveChainCredentials().catch(err =>
		log.debug(`[OpenAI] Initial credential resolution: ${err}`)
	);

	log.info(`Registered auth provider: ${OPENAI_AUTH_PROVIDER_ID}`);
}

async function registerGeminiProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const envBaseUrl = process.env.GEMINI_BASE_URL;
	if (envBaseUrl) {
		await vscode.workspace
			.getConfiguration(`authentication.${GEMINI_AUTH_PROVIDER_ID}`)
			.update(
				'baseUrl', envBaseUrl,
				vscode.ConfigurationTarget.Global
			).then(undefined, err =>
				log.error(`Failed to sync Gemini base URL: ${err}`)
			);
	}

	const provider = new AuthProvider(
		GEMINI_AUTH_PROVIDER_ID, 'Google Gemini', context,
		undefined,
		{
			resolve: async () => {
				const apiKey = process.env.GEMINI_API_KEY
					?? process.env.GOOGLE_API_KEY;
				if (!apiKey) {
					throw new Error(
						'GEMINI_API_KEY or GOOGLE_API_KEY not set'
					);
				}
				const baseUrl = vscode.workspace
					.getConfiguration(`authentication.${GEMINI_AUTH_PROVIDER_ID}`)
					.get<string>('baseUrl') || undefined;
				await validateGeminiApiKey(apiKey, { baseUrl });
				return apiKey;
			},
			preventSignOut: true,
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			GEMINI_AUTH_PROVIDER_ID, 'Google Gemini', provider,
			{ supportsMultipleAccounts: true }
		),
		provider
	);
	registerAuthProvider(GEMINI_AUTH_PROVIDER_ID, provider, {
		validateApiKey: validateGeminiApiKey,
		onSave: async (config) => {
			if (config.baseUrl) {
				await vscode.workspace
					.getConfiguration(`authentication.${GEMINI_AUTH_PROVIDER_ID}`)
					.update(
						'baseUrl', config.baseUrl,
						vscode.ConfigurationTarget.Global
					);
			}
		},
	});

	await provider.resolveChainCredentials().catch(err =>
		log.debug(`[Gemini] Initial credential resolution: ${err}`)
	);

	log.info(`Registered auth provider: ${GEMINI_AUTH_PROVIDER_ID}`);
}

async function registerGeapProvider(
	context: vscode.ExtensionContext,
): Promise<void> {
	const logger = new AuthProviderLogger('Gemini Enterprise Agent Platform');
	const envBaseUrl = process.env.GOOGLE_VERTEX_BASE_URL;
	if (envBaseUrl) {
		await vscode.workspace
			.getConfiguration('authentication.googleVertex')
			.update(
				'baseUrl', envBaseUrl,
				vscode.ConfigurationTarget.Global,
			).then(undefined, err =>
				log.error(`Failed to sync Gemini Enterprise Agent Platform base URL: ${err}`)
			);
	}

	const provider = new AuthProvider(
		GOOGLE_CLOUD_AUTH_PROVIDER_ID, 'Gemini Enterprise Agent Platform', context,
		undefined,
		{
			resolve: () => resolveGeapCredential(logger),
			refreshIntervalMs: CREDENTIAL_REFRESH_INTERVAL_MS,
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			GOOGLE_CLOUD_AUTH_PROVIDER_ID, 'Gemini Enterprise Agent Platform', provider,
			{ supportsMultipleAccounts: false }
		),
		provider,
	);
	registerAuthProvider(GOOGLE_CLOUD_AUTH_PROVIDER_ID, provider, {
		onSave: async (config) => {
			if (config.baseUrl) {
				await vscode.workspace
					.getConfiguration('authentication.googleVertex')
					.update(
						'baseUrl', config.baseUrl,
						vscode.ConfigurationTarget.Global,
					);
			}
		},
	});

	await provider.resolveChainCredentials().catch(err =>
		log.debug(`[Gemini Enterprise Agent Platform] Initial credential resolution: ${err}`)
	);

	log.info(`Registered auth provider: ${GOOGLE_CLOUD_AUTH_PROVIDER_ID}`);
}

async function registerDeepSeekProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const envBaseUrl = process.env.DEEPSEEK_BASE_URL;
	if (envBaseUrl) {
		await vscode.workspace
			.getConfiguration(`authentication.${DEEPSEEK_AUTH_PROVIDER_ID}`)
			.update(
				'baseUrl', envBaseUrl,
				vscode.ConfigurationTarget.Global
			).then(undefined, err =>
				log.error(`Failed to sync DeepSeek base URL: ${err}`)
			);
	}

	const provider = new AuthProvider(
		DEEPSEEK_AUTH_PROVIDER_ID, 'DeepSeek', context,
		undefined,
		{
			resolve: async () => {
				const apiKey = process.env.DEEPSEEK_API_KEY;
				if (!apiKey) {
					throw new Error('DEEPSEEK_API_KEY not set');
				}
				const baseUrl = vscode.workspace
					.getConfiguration(`authentication.${DEEPSEEK_AUTH_PROVIDER_ID}`)
					.get<string>('baseUrl') || undefined;
				await validateDeepSeekApiKey(apiKey, { baseUrl });
				return apiKey;
			},
			preventSignOut: true,
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			DEEPSEEK_AUTH_PROVIDER_ID, 'DeepSeek', provider,
			{ supportsMultipleAccounts: true }
		),
		provider
	);
	registerAuthProvider(DEEPSEEK_AUTH_PROVIDER_ID, provider, {
		validateApiKey: validateDeepSeekApiKey,
		onSave: async (config) => {
			if (config.baseUrl) {
				await vscode.workspace
					.getConfiguration(`authentication.${DEEPSEEK_AUTH_PROVIDER_ID}`)
					.update(
						'baseUrl', config.baseUrl,
						vscode.ConfigurationTarget.Global
					);
			}
		},
	});

	await provider.resolveChainCredentials().catch(err =>
		log.debug(`[DeepSeek] Initial credential resolution: ${err}`)
	);

	log.info(`Registered auth provider: ${DEEPSEEK_AUTH_PROVIDER_ID}`);
}

function registerCustomProvider(
	context: vscode.ExtensionContext
): void {
	const provider = new AuthProvider(
		CUSTOM_PROVIDER_AUTH_PROVIDER_ID, 'Custom Provider', context
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			CUSTOM_PROVIDER_AUTH_PROVIDER_ID, 'Custom Provider', provider,
			{ supportsMultipleAccounts: true }
		),
		provider
	);
	registerAuthProvider(CUSTOM_PROVIDER_AUTH_PROVIDER_ID, provider, {
		validateApiKey: validateCustomProviderApiKey,
		onSave: async (config) => {
			if (config.baseUrl) {
				await vscode.workspace
					.getConfiguration(`authentication.${CUSTOM_PROVIDER_AUTH_PROVIDER_ID}`)
					.update(
						'baseUrl', config.baseUrl,
						vscode.ConfigurationTarget.Global
					);
			}
		},
	});
	log.info(
		`Registered auth provider: ${CUSTOM_PROVIDER_AUTH_PROVIDER_ID}`
	);
}

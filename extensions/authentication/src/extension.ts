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
import { getProviderSources, PROVIDER_METADATA } from './providerSources';
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
import { resolveAwsChainInit } from './credentials/aws';
import { resolveGeapCredential } from './credentials/geap';
import {
	detectSnowflakeCredentials,
	getSnowflakeConnectionsTomlPath,
} from './credentials/snowflake';
import { PositOAuthProvider } from './positOAuthProvider';
import * as fs from 'fs';
import { log } from './log';
import { migrateAwsSettings } from './migration/aws';
import { migrateSnowflakeSettings } from './migration/snowflake';
import { registerProvidersJsonMigration } from './migration/providersJsonUi';
import { AuthProviderLogger } from './authProviderLogger';
import { applyPwbPositAIDefault } from './pwbDefaults';
import {
	createConfigurationLegacySettingsReader,
	getCachedProvider,
	initProviderCatalog,
	onDidChangeProviderCatalog,
	saveCustomProviderModels,
	saveProviderBaseUrl,
	saveSnowflakeAccount,
} from './providerCatalog';

/** A settings migration, named so a failure says which one gave up. */
interface SettingsMigration {
	readonly name: string;
	readonly run: () => Promise<void>;
}

const SETTINGS_MIGRATIONS: readonly SettingsMigration[] = [
	{ name: 'AWS', run: migrateAwsSettings },
	{ name: 'Snowflake', run: migrateSnowflakeSettings },
];

/**
 * Runs the settings migrations, then primes the cached provider catalog.
 *
 * The order matters: the legacy-settings reader hands the catalog the same
 * `authentication.aws.credentials` / `authentication.snowflake.credentials`
 * keys these migrations write, so a catalog primed first misses migrated
 * AWS/Snowflake connections on the first run and resolves credentials against
 * the wrong profile until the debounced catalog watch catches up.
 *
 * `catalogOptions` and `migrations` are test seams; production passes neither.
 */
export async function migrateSettingsAndPrimeCatalog(
	context: vscode.ExtensionContext,
	catalogOptions: ProviderCatalogOptions = {},
	migrations: readonly SettingsMigration[] = SETTINGS_MIGRATIONS,
): Promise<void> {
	for (const { name, run } of migrations) {
		await run().catch(err =>
			log.error(`${name} settings migration failed: ${err}`)
		);
	}

	// Prime the cached provider catalog before registering providers so
	// registration callbacks resolve connection config from it synchronously.
	// The legacy-settings reader keeps this cache in sync with the core catalog
	// during the providers.json migration window.
	await initProviderCatalog(context, {
		legacyPositronSettings: createConfigurationLegacySettingsReader(),
		...catalogOptions,
	});
}

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(log);

	await migrateSettingsAndPrimeCatalog(context);

	await registerAnthropicProvider(context);
	registerPositAIProvider(context);
	registerFoundryProvider(context);

	await registerAwsProvider(context);
	await registerSnowflakeProvider(context);

	await registerOpenaiProvider(context);
	await registerGeminiProvider(context);
	await registerGeapProvider(context);
	await registerDeepSeekProvider(context);
	registerCustomProvider(context);

	// Register providers so the assistant knows about them; enablement is
	// read from the provider catalog (providers.json), not a settings toggle.
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

	// React to provider-catalog changes: drop sessions for providers disabled
	// in the catalog, and re-resolve chain sessions whose connection changed.
	context.subscriptions.push(
		onDidChangeProviderCatalog(async (e) => {
			for (const metadata of Object.values(PROVIDER_METADATA)) {
				const { id, catalogId } = metadata;
				if (!catalogId) {
					continue;
				}
				if (e.disabledIds.includes(catalogId)) {
					const provider = authProviders.get(id);
					if (provider) {
						for (const session of await provider.getSessions()) {
							await provider.removeSession(session.id);
						}
					}
				}
				if (e.changedConnectionIds.includes(catalogId)) {
					await authProviders.get(id)?.resolveChainCredentials();
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
	registerProvidersJsonMigration(context);

	return { getLogs: () => log.formatEntriesForDiagnostics() };
}

async function registerAnthropicProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const logger = new AuthProviderLogger('Anthropic');

	const provider = new AuthProvider(
		ANTHROPIC_AUTH_PROVIDER_ID, 'Anthropic', context,
		undefined,
		{
			resolve: async () => {
				const apiKey = process.env.ANTHROPIC_API_KEY;
				if (!apiKey) {
					throw new Error('ANTHROPIC_API_KEY not set');
				}
				const baseUrl = getCachedProvider(PROVIDER_METADATA.anthropic.catalogId!)?.connection.baseUrl;
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
				await saveProviderBaseUrl(PROVIDER_METADATA.anthropic.catalogId!, config.baseUrl);
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

	// On PWB, Posit AI defaults to disabled so admins control AI access.
	// We apply this once on first activation and skip it afterwards so user
	// or admin choices are never overwritten.
	applyPwbPositAIDefault(context).catch(err =>
		logger.logOperationError('apply PWB Posit AI default', err)
	);
}

async function registerAwsProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const logger = new AuthProviderLogger('AWS');

	const provider = new AuthProvider(
		AWS_AUTH_PROVIDER_ID, 'AWS', context,
		undefined,
		{
			resolve: async () => {
				const aws = getCachedProvider(PROVIDER_METADATA.amazonBedrock.catalogId!)?.connection.aws;
				const chainInit = resolveAwsChainInit(aws, process.env);
				const credentialProvider = fromNodeProviderChain(chainInit);
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
				await saveProviderBaseUrl(PROVIDER_METADATA.foundry.catalogId!, config.baseUrl);
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

	// Seed the Workbench-managed Foundry endpoint into the catalog so the
	// provider reads it from providers.json like a user-configured base URL.
	if (hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS)) {
		const endpoint = vscode.workspace
			.getConfiguration('posit.workbench.foundry')
			.get<string>('endpoint', '');
		const catalogId = PROVIDER_METADATA.foundry.catalogId!;
		if (endpoint) {
			const normalized = normalizeToV1Url(endpoint);
			if (getCachedProvider(catalogId)?.connection.baseUrl !== normalized) {
				saveProviderBaseUrl(catalogId, normalized).then(undefined, err =>
					logger.logOperationError('sync Foundry endpoint', err)
				);
			}
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
				const snowflake = getCachedProvider(PROVIDER_METADATA.snowflake.catalogId!)?.connection.snowflake;
				const credentials = await detectSnowflakeCredentials(snowflake);
				if (!credentials) {
					throw new Error('No Snowflake credentials found');
				}
				// Persist the detected account to the catalog so the Cortex
				// baseUrl derivation picks it up. saveSnowflakeAccount no-ops
				// when the account is unchanged.
				if (credentials.account) {
					await saveSnowflakeAccount(credentials.account).then(undefined, err =>
						logger.logOperationError('sync Snowflake account', err)
					);
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
				const snowflake = getCachedProvider(PROVIDER_METADATA.snowflake.catalogId!)?.connection.snowflake;
				const tomlPath = getSnowflakeConnectionsTomlPath(snowflake);
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
			// baseUrl carries the bare account (#13750); persist it as the
			// catalog's snowflake account, not as a baseUrl.
			const account = config.baseUrl?.trim();
			if (account) {
				await saveSnowflakeAccount(account);
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
	const provider = new AuthProvider(
		OPENAI_AUTH_PROVIDER_ID, 'OpenAI', context,
		undefined,
		{
			resolve: async () => {
				const apiKey = process.env.OPENAI_API_KEY;
				if (!apiKey) {
					throw new Error('OPENAI_API_KEY not set');
				}
				const baseUrl = getCachedProvider(PROVIDER_METADATA.openai.catalogId!)?.connection.baseUrl;
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
				await saveProviderBaseUrl(PROVIDER_METADATA.openai.catalogId!, config.baseUrl);
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
				const baseUrl = getCachedProvider(PROVIDER_METADATA.google.catalogId!)?.connection.baseUrl;
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
				await saveProviderBaseUrl(PROVIDER_METADATA.google.catalogId!, config.baseUrl);
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

	const provider = new AuthProvider(
		GOOGLE_CLOUD_AUTH_PROVIDER_ID, 'Gemini Enterprise Agent Platform', context,
		undefined,
		{
			resolve: () => {
				const googleCloud = getCachedProvider(PROVIDER_METADATA.geap.catalogId!)?.connection.googleCloud;
				return resolveGeapCredential(googleCloud, logger);
			},
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
				await saveProviderBaseUrl(PROVIDER_METADATA.geap.catalogId!, config.baseUrl);
			}
		},
	});

	await provider.resolveChainCredentials().catch(err =>
		logger.debug(`Initial credential resolution: ${err}`)
	);

	logger.info(`Registered auth provider: ${GOOGLE_CLOUD_AUTH_PROVIDER_ID}`);
}

async function registerDeepSeekProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const provider = new AuthProvider(
		DEEPSEEK_AUTH_PROVIDER_ID, 'DeepSeek', context,
		undefined,
		{
			resolve: async () => {
				const apiKey = process.env.DEEPSEEK_API_KEY;
				if (!apiKey) {
					throw new Error('DEEPSEEK_API_KEY not set');
				}
				const baseUrl = getCachedProvider(PROVIDER_METADATA.deepseek.catalogId!)?.connection.baseUrl;
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
				await saveProviderBaseUrl(PROVIDER_METADATA.deepseek.catalogId!, config.baseUrl);
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
			const catalogId = PROVIDER_METADATA.customProvider.catalogId!;
			if (config.baseUrl) {
				await saveProviderBaseUrl(catalogId, config.baseUrl);
			}
			await saveCustomProviderModels(catalogId, config.protocol, config.customModels);
		},
	});
	log.info(
		`Registered auth provider: ${CUSTOM_PROVIDER_AUTH_PROVIDER_ID}`
	);
}

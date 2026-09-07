/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
	AWS_AUTH_PROVIDER_ID,
	CREDENTIAL_REFRESH_INTERVAL_MS,
	DATABRICKS_AUTH_PROVIDER_ID,
	FOUNDRY_AUTH_PROVIDER_ID,
	GOOGLE_CLOUD_AUTH_PROVIDER_ID,
	SNOWFLAKE_AUTH_PROVIDER_ID,
} from './constants';
import { AuthProvider } from './authProvider';
import { registerAuthProvider, authProviders } from './authProviderRegistry';
import { PROVIDER_METADATA } from './providerSources';
import {
	normalizeToV1Url,
	validateDatabricksApiKey,
} from './validation';
import { FOUNDRY_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';
import { resolveAwsChainInit } from './credentials/aws';
import { createAwsSsoRecovery } from './awsRecovery';
import { resolveGeapCredential } from './credentials/geap';
import {
	detectSnowflakeCredentials,
	getSnowflakeConnectionsTomlPath,
} from './credentials/snowflake';
import {
	detectDatabricksConfigCredentials,
	getDatabricksConfigPath,
} from './credentials/databricks';
import { DatabricksAuthProvider } from './databricksAuthProvider';
import { normalizeHost } from './databricksOAuth';
import * as fs from 'fs';
import { log } from './log';
import { migrateAwsSettings } from './migration/aws';
import { migrateSnowflakeSettings } from './migration/snowflake';
import { autoMigrateProvidersJson, registerProvidersJsonMigration } from './migration/providersJsonUi';
import { registerCredentialExport } from './credentialMigration';
import { AuthProviderLogger } from './authProviderLogger';
import { applyPwbPositAIDefault } from './pwbDefaults';
import {
	getCachedProvider,
	initProviderCatalog,
	onDidChangeProviderCatalog,
	ProviderCatalogOptions,
	removeProviderBlock,
	saveCustomProviderModels,
	saveAwsSettings,
	saveDatabricksHost,
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
 * Runs the settings migrations, migrates them into providers.json, then primes
 * the cached provider catalog.
 *
 * The order is load-bearing in both directions: the providers.json migration
 * reads the `authentication.aws.credentials` /
 * `authentication.snowflake.credentials` keys the settings migrations write, and
 * the catalog reads no legacy settings, so anything not in providers.json by
 * prime time is missing when providers resolve credentials.
 *
 * `catalogOptions`, `migrations` and `autoMigrate` are test seams; production
 * passes none of them.
 */
export async function migrateSettingsAndPrimeCatalog(
	context: vscode.ExtensionContext,
	catalogOptions: ProviderCatalogOptions = {},
	migrations: readonly SettingsMigration[] = SETTINGS_MIGRATIONS,
	autoMigrate: () => Promise<void> = autoMigrateProvidersJson,
): Promise<void> {
	for (const { name, run } of migrations) {
		await run().catch(err =>
			log.error(`${name} settings migration failed: ${err}`)
		);
	}

	await autoMigrate();

	// Prime the cached provider catalog before registering providers so
	// registration callbacks resolve connection config from it synchronously.
	await initProviderCatalog(context, catalogOptions);
}

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(log);

	// Bridge the buffered trace/debug logs to the core "Collect AI Diagnostics"
	// command. That command runs in the workbench (renderer), which can't read an
	// extension's activate() exports, so it invokes this command across the
	// extension-host boundary and receives the return value. The `getLogs` export
	// below stays for any extension-to-extension consumer. Not declared in
	// package.json, so it stays out of the command palette. Registered before the
	// migration and catalog init below so the logs stay reachable if either throws
	// or hangs.
	context.subscriptions.push(
		vscode.commands.registerCommand('authentication.getDiagnosticLogs',
			() => log.formatEntriesForDiagnostics()),
	);

	await migrateSettingsAndPrimeCatalog(context);

	// Reports provider state for the core "AI: Create Diagnostic Report" command:
	// which providers the user is signed in to, and which are turned off in
	// settings. Returns display names only (no account details). Bridged as a
	// command for the same reason as the logs above.
	context.subscriptions.push(
		vscode.commands.registerCommand('authentication.getProviderDiagnostics', async () => {
			const authenticated: string[] = [];

			// "Authenticated" means an active session (getSessions().length > 0),
			// matching how the Accounts UI decides signed-in - not isConfigured(),
			// which also counts providers set up once but now signed out or expired.
			await Promise.all([...authProviders.values()].map(async (provider) => {
				try {
					if ((await provider.getSessions()).length > 0) {
						authenticated.push(provider.label);
					}
				} catch (e) {
					log.warn(`getProviderDiagnostics: could not check ${provider.label}: ${e instanceof Error ? e.message : String(e)}`);
				}
			}));

			// "Disabled" means the provider's catalog entry isn't enabled.
			// Match core's rule: enabled only when `enabled === true`, so a
			// missing or false entry counts as off.
			const disabled = Object.values(PROVIDER_METADATA)
				.filter(meta => getCachedProvider(meta.catalogId)?.enabled !== true)
				.map(meta => meta.displayName);

			return { authenticated: authenticated.sort(), disabled: disabled.sort() };
		}),
	);

	registerFoundryProvider(context);

	await registerAwsProvider(context);
	await registerSnowflakeProvider(context);
	await registerGeapProvider(context);
	await registerDatabricksProvider(context);

	// React to provider-catalog changes: drop sessions for providers disabled
	// in the catalog, and re-resolve chain sessions whose connection changed.
	context.subscriptions.push(
		onDidChangeProviderCatalog(async (e) => {
			for (const { id, catalogId } of Object.values(PROVIDER_METADATA)) {
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

	registerProvidersJsonMigration(context);
	registerCredentialExport(context);

	return { getLogs: () => log.formatEntriesForDiagnostics() };
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
		},
		createAwsSsoRecovery({
			getProfile: () => getCachedProvider(
				PROVIDER_METADATA.amazonBedrock.catalogId!
			)?.connection.aws?.profile,
		})
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			AWS_AUTH_PROVIDER_ID, 'AWS', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider(AWS_AUTH_PROVIDER_ID, provider);
	await provider.resolveChainCredentials();
	logger.info('Registered auth provider');
}

function registerFoundryProvider(context: vscode.ExtensionContext): void {
	const logger = new AuthProviderLogger('Microsoft Foundry');
	const provider = new AuthProvider(
		FOUNDRY_AUTH_PROVIDER_ID, 'Microsoft Foundry', context,
		{
			authProviderId: FOUNDRY_MANAGED_CREDENTIALS.authProvider.id,
			scopes: FOUNDRY_MANAGED_CREDENTIALS.authProvider.scopes,
			isAvailable: () => !!hasManagedCredentials(FOUNDRY_MANAGED_CREDENTIALS),
		}
	);
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			FOUNDRY_AUTH_PROVIDER_ID, 'Microsoft Foundry', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider(FOUNDRY_AUTH_PROVIDER_ID, provider);
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
		SNOWFLAKE_AUTH_PROVIDER_ID, 'Snowflake Cortex', context,
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
			SNOWFLAKE_AUTH_PROVIDER_ID, 'Snowflake Cortex', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider(SNOWFLAKE_AUTH_PROVIDER_ID, provider);
	await provider.resolveChainCredentials();
	logger.info('Registered auth provider');
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
	registerAuthProvider(GOOGLE_CLOUD_AUTH_PROVIDER_ID, provider);

	await provider.resolveChainCredentials();

	logger.info(`Registered auth provider: ${GOOGLE_CLOUD_AUTH_PROVIDER_ID}`);
}

async function registerDatabricksProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const logger = new AuthProviderLogger('Databricks');
	let lastCfgCheck: number | undefined;
	let pendingMtime: number | undefined;

	const provider = new DatabricksAuthProvider(context, {
		resolve: async () => {
			// A Workbench-provisioned profile outranks DATABRICKS_TOKEN: the
			// admin-supplied credential shouldn't be overridable from the shell.
			const envToken = hasManagedCredentials(DATABRICKS_AUTH_PROVIDER_ID)
				? undefined
				: process.env.DATABRICKS_TOKEN?.trim();
			if (envToken) {
				const host = getCachedProvider('databricks')?.connection.databricks?.host?.trim();
				if (!host) {
					throw new Error(
						'DATABRICKS_TOKEN is set but no workspace host is configured. ' +
						'Set DATABRICKS_HOST or enter the workspace URL in the provider dialog.'
					);
				}
				await validateDatabricksApiKey(envToken, { baseUrl: host });
				return envToken;
			}
			const credential = await detectDatabricksConfigCredentials();
			if (!credential) {
				throw new Error('No Databricks credentials found in the environment');
			}
			if (credential.host) {
				await saveDatabricksHost(normalizeHost(credential.host)).then(undefined, err =>
					logger.logOperationError('sync Databricks host', err)
				);
			}
			// Advance mtime only after a successful resolve so a failed
			// attempt retries on the next getSessions call.
			if (pendingMtime !== undefined) {
				lastCfgCheck = pendingMtime;
				pendingMtime = undefined;
			}
			return credential.token;
		},
		shouldRefresh: async () => {
			if (process.env.DATABRICKS_TOKEN &&
				!hasManagedCredentials(DATABRICKS_AUTH_PROVIDER_ID)) {
				return false; // Static env token; nothing to re-read.
			}
			try {
				const stats = await fs.promises.stat(getDatabricksConfigPath());
				const mtime = stats.mtime.getTime();
				if (!lastCfgCheck || mtime > lastCfgCheck) {
					pendingMtime = mtime;
					return true;
				}
				return false;
			} catch {
				// The config file is gone or unreadable; re-resolve so the cached
				// session is dropped, and forget the watermark so a file restored
				// with an older mtime still re-resolves.
				lastCfgCheck = undefined;
				pendingMtime = undefined;
				return true;
			}
		},
	});
	context.subscriptions.push(
		vscode.authentication.registerAuthenticationProvider(
			DATABRICKS_AUTH_PROVIDER_ID, 'Databricks', provider,
			{ supportsMultipleAccounts: false }
		),
		provider
	);
	registerAuthProvider(DATABRICKS_AUTH_PROVIDER_ID, provider);

	await provider.resolveChainCredentials();
	logger.info('Registered auth provider');
}

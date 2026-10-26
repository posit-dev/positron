/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
	AWS_AUTH_PROVIDER_ID,
	DATABRICKS_AUTH_PROVIDER_ID,
	SNOWFLAKE_AUTH_PROVIDER_ID,
} from './constants';
import { AuthProvider } from './authProvider';
import { registerAuthProvider, authProviders } from './authProviderRegistry';
import { PROVIDER_METADATA } from './providerSources';
import {
	validateDatabricksApiKey,
} from './validation';
import { hasManagedCredentials } from './managedCredentials';
import { createManagedCredentialsApi } from './managedCredentialsApi';
import { createAwsCredentialChain, watchWebIdentityTokenFile } from './credentials/aws';
import { createAwsSsoRecovery } from './awsRecovery';
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
import { AuthProviderLogger } from './authProviderLogger';
import { applyPwbPositAIDefault } from './pwbDefaults';
import {
	getCachedProvider,
	initProviderCatalog,
	onDidChangeProviderCatalog,
	ProviderCatalogOptions,
	saveDatabricksHost,
	saveSnowflakeAccount,
} from './providerCatalog';

const POSIT_ASSISTANT_EXTENSION_ID = 'posit.assistant';

/** A settings migration, named so a failure says which one gave up. */
interface SettingsMigration {
	readonly name: string;
	readonly run: () => Promise<void>;
}

// Drop these, and the deprecated `authentication.aws.credentials` /
// `authentication.snowflake.credentials` declarations they write, once Posit
// Workbench drops support for Positron 2026.07
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

	// On PWB, Posit AI Pass defaults to off so admins control AI access.
	applyPwbPositAIDefault(context).catch(err =>
		log.error(`Failed to apply the Posit Workbench default for Posit AI Pass: ${err}`)
	);

	await registerAwsProvider(context);
	const snowflake = registerUnlessAssistantOwns(SNOWFLAKE_AUTH_PROVIDER_ID, () => registerSnowflakeProvider(context));
	context.subscriptions.push(snowflake.disposable);
	await snowflake.ready;
	const databricks = registerUnlessAssistantOwns(DATABRICKS_AUTH_PROVIDER_ID, () => registerDatabricksProvider(context));
	context.subscriptions.push(databricks.disposable);
	await databricks.ready;

	// React to provider-catalog changes: drop sessions for providers disabled
	// in the catalog, and re-resolve chain sessions whose connection changed.
	context.subscriptions.push(
		onDidChangeProviderCatalog(async (e) => {
			for (const { id } of Object.values(PROVIDER_METADATA)) {
				if (e.disabledIds.includes(id)) {
					const provider = authProviders.get(id);
					if (provider) {
						for (const session of await provider.getSessions()) {
							await provider.removeSession(session.id);
						}
					}
				}
				if (e.changedConnectionIds.includes(id)) {
					await authProviders.get(id)?.resolveChainCredentials();
				}
			}
		})
	);

	log.info('Authentication extension activated');

	registerProvidersJsonMigration(context);

	return {
		getLogs: () => log.formatEntriesForDiagnostics(),
		// Lets the Snowflake and Databricks data connection drivers offer a "Workbench managed
		// credentials" mechanism without parsing Workbench's credential files themselves.
		managedCredentials: createManagedCredentialsApi(),
	};
}

async function registerAwsProvider(
	context: vscode.ExtensionContext
): Promise<void> {
	const logger = new AuthProviderLogger('AWS');

	const credentialChain = createAwsCredentialChain(
		() => getCachedProvider(PROVIDER_METADATA.amazonBedrock.id)?.connection.aws,
		process.env,
		fromNodeProviderChain,
	);
	const provider = new AuthProvider(
		AWS_AUTH_PROVIDER_ID, 'AWS', context,
		credentialChain,
		createAwsSsoRecovery({
			getProfile: () => getCachedProvider(
				PROVIDER_METADATA.amazonBedrock.id
			)?.connection.aws?.profile,
		})
	);
	context.subscriptions.push(registerProvider(AWS_AUTH_PROVIDER_ID, 'AWS', provider));

	const tokenWatcher = watchWebIdentityTokenFile(
		process.env, credentialChain, () => provider.resolveChainCredentials()
	);
	if (tokenWatcher) {
		context.subscriptions.push(tokenWatcher);
	}
	await provider.resolveChainCredentials();
	logger.info('Registered auth provider');
}

/** An auth provider registration, plus its first look for existing credentials. */
export interface ProviderRegistration {
	readonly disposable: vscode.Disposable;
	readonly ready: Promise<void>;
}

/**
 * Registers an auth provider only while Posit Assistant doesn't, since an id can only be registered once.
 * Re-checks when extensions are installed, enabled or disabled.
 */
export function registerUnlessAssistantOwns(
	authProviderId: string,
	register: () => ProviderRegistration,
	isOwnedByAssistant: (authProviderId: string) => boolean = assistantRegisters,
	onDidChangeExtensions: vscode.Event<void> = vscode.extensions.onDidChange,
): ProviderRegistration {
	let current: vscode.Disposable | undefined;
	const update = (): Promise<void> => {
		if (isOwnedByAssistant(authProviderId)) {
			current?.dispose();
			current = undefined;
		} else if (!current) {
			try {
				const registration = register();
				current = registration.disposable;
				return registration.ready;
			} catch (err) {
				// Left unregistered, so the next extension change tries again.
				return Promise.reject(err);
			}
		}
		return Promise.resolve();
	};

	const listener = onDidChangeExtensions(() => {
		update().catch(err => log.error(`Could not update the ${authProviderId} auth provider: ${err}`));
	});
	return {
		disposable: new vscode.Disposable(() => {
			listener.dispose();
			current?.dispose();
			current = undefined;
		}),
		ready: update(),
	};
}

/** Whether Posit Assistant is installed and enabled, and declares this auth provider id. */
function assistantRegisters(authProviderId: string): boolean {
	return declaresAuthProvider(vscode.extensions.getExtension(POSIT_ASSISTANT_EXTENSION_ID)?.packageJSON, authProviderId);
}

/** Whether an extension manifest lists the id in `contributes.authentication`. */
export function declaresAuthProvider(packageJSON: { contributes?: { authentication?: unknown } } | undefined, authProviderId: string): boolean {
	const declared = packageJSON?.contributes?.authentication;
	return Array.isArray(declared) && declared.some(entry => entry?.id === authProviderId);
}

/** Registers the provider with VS Code and the local registry, disposing it if registration throws. */
function registerProvider(authProviderId: string, label: string, provider: AuthProvider): vscode.Disposable {
	try {
		return vscode.Disposable.from(
			vscode.authentication.registerAuthenticationProvider(
				authProviderId, label, provider,
				{ supportsMultipleAccounts: false }
			),
			provider,
			registerAuthProvider(authProviderId, provider)
		);
	} catch (err) {
		provider.dispose();
		throw err;
	}
}

function registerSnowflakeProvider(context: vscode.ExtensionContext): ProviderRegistration {
	const logger = new AuthProviderLogger('Snowflake Cortex');
	let lastTomlCheck: number | undefined;
	let pendingMtime: number | undefined;

	const provider = new AuthProvider(
		SNOWFLAKE_AUTH_PROVIDER_ID, 'Snowflake Cortex', context,
		{
			resolve: async () => {
				const snowflake = getCachedProvider(PROVIDER_METADATA.snowflake.id)?.connection.snowflake;
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
				const snowflake = getCachedProvider(PROVIDER_METADATA.snowflake.id)?.connection.snowflake;
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
	return {
		disposable: registerProvider(SNOWFLAKE_AUTH_PROVIDER_ID, 'Snowflake Cortex', provider),
		ready: provider.resolveChainCredentials().then(() => logger.info('Registered auth provider')),
	};
}

function registerDatabricksProvider(
	context: vscode.ExtensionContext
): ProviderRegistration {
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
						'Set DATABRICKS_HOST, or add the workspace URL in Posit Assistant\'s AI provider settings.'
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
	return {
		disposable: registerProvider(DATABRICKS_AUTH_PROVIDER_ID, 'Databricks', provider),
		ready: provider.resolveChainCredentials().then(() => logger.info('Registered auth provider')),
	};
}

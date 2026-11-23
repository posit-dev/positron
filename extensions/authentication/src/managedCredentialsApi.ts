/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AuthProviderLogger } from './authProviderLogger';
import { DATABRICKS_AUTH_PROVIDER_ID, EXPIRY_REFRESH_BUFFER_MS, SNOWFLAKE_AUTH_PROVIDER_ID } from './constants';
import { AzureTokenError, AzureTokenErrorCode, DelegatedAzureToken, DelegatedAzureTokenClient } from './credentials/azure';
import { detectDatabricksConfigCredentials } from './credentials/databricks';
import { readSnowflakeManagedCredentials } from './credentials/snowflake';
import { AZURE_DELEGATED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';

const azureLogger = new AuthProviderLogger('Azure Delegated Credentials');

/** A Workbench-managed credential, read as one unit from the file Workbench provisions. */
export interface ManagedCredential {
	/** The current access token. */
	readonly accessToken: string;
	/**
	 * What the token is for: the Snowflake account identifier, or the Databricks workspace host
	 * (possibly with a scheme).
	 */
	readonly locator: string;
	/**
	 * The host to connect to instead of the one the locator implies, when Workbench names one (the
	 * Snowflake account's `$SNOWFLAKE_HOST` inside Snowpark Container Services).
	 */
	readonly host?: string;
}

/**
 * The managed-credentials surface this extension exports for other extensions (the Snowflake and
 * Databricks data connection drivers).
 *
 * Consumers declare a structural copy of this interface rather than importing it, since extensions
 * cannot import each other's sources.
 */
export interface ManagedCredentialsApi {
	/**
	 * Reads the credential Posit Workbench provisions for the given authentication provider id
	 * (`snowflake-cortex` or `databricks`). The token and locator come from the same read of the
	 * Workbench-provisioned file, so a rotated token is never paired with a stale locator, and the
	 * user's own stored keys or configured locators are never substituted. Undefined outside
	 * Workbench, for other provider ids, or when the file is missing or incomplete.
	 */
	getManagedCredential(authProviderId: string): Promise<ManagedCredential | undefined>;

	/**
	 * Whether this session can ask Posit Workbench for delegated Azure (Entra ID) tokens. True on any
	 * Workbench that gives the session an RPC cookie, including one that does not sign in with Entra
	 * ID; only `getDelegatedAzureToken` can tell.
	 */
	isDelegatedAzureTokenAvailable(): boolean;

	/**
	 * A delegated Azure access token for one resource (e.g. `https://ossrdbms-aad.database.windows.net`),
	 * issued by Workbench on the signed-in user's behalf and cached until shortly before it expires.
	 * Undefined outside Workbench. Throws an `Error` with a localized message saying what the user or
	 * their administrator needs to do when Workbench refuses.
	 *
	 * @param resource The Azure resource URI or application id the token is for.
	 * @param serviceName The service's user-facing name, for the consent error message.
	 */
	getDelegatedAzureToken(resource: string, serviceName: string): Promise<DelegatedAzureToken | undefined>;
}

/** Reads the managed credential for a provider id from its Workbench-provisioned file. */
async function readManagedCredential(authProviderId: string): Promise<ManagedCredential | undefined> {
	if (!hasManagedCredentials(authProviderId)) {
		return undefined;
	}
	switch (authProviderId) {
		case SNOWFLAKE_AUTH_PROVIDER_ID: {
			// hasManagedCredentials has confirmed SNOWFLAKE_HOME points at the managed directory.
			// Read without deriving the Cortex base URL, whose account validation rejects regional
			// identifiers (e.g. `xy12345.us-east-2.aws`) that the data drivers accept.
			const credential = readSnowflakeManagedCredentials({ home: process.env.SNOWFLAKE_HOME });
			return credential?.account ? { accessToken: credential.token, locator: credential.account, host: credential.host } : undefined;
		}
		case DATABRICKS_AUTH_PROVIDER_ID: {
			// hasManagedCredentials has confirmed DATABRICKS_CONFIG_FILE points at the managed file.
			const credential = await detectDatabricksConfigCredentials();
			return credential?.host ? { accessToken: credential.token, locator: credential.host } : undefined;
		}
		default:
			return undefined;
	}
}

/** A localized message telling the user what to do about a failed delegated Azure token request. */
function azureTokenErrorMessage(code: AzureTokenErrorCode, serviceName: string): string {
	switch (code) {
		case 'consent-required':
			return vscode.l10n.t('Your Posit Workbench administrator needs to add the user_impersonation delegated permission for {0} and grant admin consent. After they do, sign out of Workbench and sign in again.', serviceName);
		case 'reauthenticate':
			return vscode.l10n.t('Your Microsoft Entra ID sign-in has expired. Sign out of Posit Workbench and sign in again.');
		case 'entra-not-configured':
			return vscode.l10n.t('Azure credentials need Posit Workbench to sign in with Microsoft Entra ID. Ask your Workbench administrator.');
		case 'no-rpc-cookie':
			return vscode.l10n.t('This Posit Workbench session is missing its RPC cookie, so it cannot request Azure credentials. Ask your Workbench administrator; a temporary-file cleaner may have removed the session\'s runtime directory.');
		case 'unreachable':
			return vscode.l10n.t('Could not reach the Posit Workbench server to request Azure credentials. Ask your Workbench administrator to check the session callback address.');
		case 'workbench-too-old':
			return vscode.l10n.t('Azure credentials need Posit Workbench 2024.12.0 or later. Ask your Workbench administrator to upgrade.');
		case 'unavailable':
			return vscode.l10n.t('Azure credentials are only available in Posit Workbench sessions.');
		case 'unknown':
			return vscode.l10n.t('Posit Workbench could not provide Azure credentials for {0}. See the Authentication log for details.', serviceName);
	}
}

/** Builds the exported managed-credentials API. */
export function createManagedCredentialsApi(): ManagedCredentialsApi {
	// Created on first use: most sessions never ask for an Azure token.
	let azureClient: DelegatedAzureTokenClient | undefined;
	return {
		getManagedCredential: readManagedCredential,
		isDelegatedAzureTokenAvailable: () => !!hasManagedCredentials(AZURE_DELEGATED_CREDENTIALS),
		async getDelegatedAzureToken(resource, serviceName) {
			if (!hasManagedCredentials(AZURE_DELEGATED_CREDENTIALS)) {
				return undefined;
			}
			azureClient ??= new DelegatedAzureTokenClient({
				refreshBufferMs: EXPIRY_REFRESH_BUFFER_MS,
				log: message => azureLogger.debug(message),
			});
			try {
				return await azureClient.getToken(resource);
			} catch (error) {
				const code = error instanceof AzureTokenError ? error.code : 'unknown';
				azureLogger.warn(`Delegated Azure token request for ${resource} failed (${code}): ${error instanceof Error ? error.message : String(error)}`);
				throw new Error(azureTokenErrorMessage(code, serviceName));
			}
		},
	};
}

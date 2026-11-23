/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Bridges a data connection driver to the credentials Posit Workbench manages for a session. The
// Authentication extension owns reading the Workbench-provisioned credential files; this module only
// decides whether to offer the mechanism and asks that extension for the credential at connect time.
//
// This file is copied verbatim into each driver that offers Workbench managed credentials (extensions
// cannot import each other's sources). `extensions/workbenchCredentials-copies.vitest.ts` keeps the
// copies identical.

import * as vscode from 'vscode';

/** The extension id of the Authentication extension, which exports the managed-credentials API. */
const AUTHENTICATION_EXTENSION_ID = 'positron.authentication';

/** A Workbench-managed credential: the access token and what it is for, read together. */
export interface ManagedCredential {
	/** The current access token. */
	readonly accessToken: string;
	/** The Snowflake account identifier, or the Databricks workspace host (possibly with a scheme). */
	readonly locator: string;
	/**
	 * The host to connect to instead of the one the locator implies, when Workbench names one (the
	 * Snowflake account's `$SNOWFLAKE_HOST` inside Snowpark Container Services).
	 */
	readonly host?: string;
}

/**
 * The slice of the Authentication extension's exports a driver uses. A structural copy of its
 * `ManagedCredentialsApi`.
 */
interface ManagedCredentialsApi {
	getManagedCredential(authProviderId: string): Promise<ManagedCredential | undefined>;
	getDelegatedAzureToken?(resource: string, serviceName: string): Promise<{ accessToken: string; expiresAt: number } | undefined>;
}

/** The shape of the Authentication extension's `activate()` return value that a driver reads. */
interface AuthenticationExtensionExports {
	managedCredentials?: ManagedCredentialsApi;
}

/**
 * Whether Posit Workbench is supplying managed credentials through the given environment variable
 * (`SNOWFLAKE_HOME` or `DATABRICKS_CONFIG_FILE`) in this session. Mirrors the Authentication
 * extension's own check, so a driver can decide which mechanisms to offer at registration without
 * waiting for that extension to activate. The environment is fixed for the session, so the answer
 * does not change.
 *
 * @param envVar The environment variable Workbench points at its managed credential file.
 * @param env The environment to read; the process environment by default.
 * @param uiKind The UI kind; Workbench always serves the web UI.
 */
export function isWorkbenchManaged(envVar: string, env: NodeJS.ProcessEnv = process.env, uiKind = vscode.env.uiKind): boolean {
	return !!env.RS_SERVER_URL && uiKind === vscode.UIKind.Web && !!env[envVar]?.includes('posit-workbench');
}

/**
 * Whether this Posit Workbench session can ask Workbench for delegated Azure (Entra ID) tokens: the
 * session names the Workbench server and has an RPC cookie. Mirrors the Authentication extension's own
 * check, so a driver can decide which mechanisms to offer at registration without waiting for that
 * extension to activate. True on every Workbench, including ones that do not sign in with Entra ID,
 * where a token request fails with a message saying so.
 *
 * @param env The environment to read; the process environment by default.
 * @param uiKind The UI kind; Workbench always serves the web UI.
 */
export function isWorkbenchAzureAvailable(env: NodeJS.ProcessEnv = process.env, uiKind = vscode.env.uiKind): boolean {
	return !!env.RS_SERVER_URL && uiKind === vscode.UIKind.Web && !!env.RS_SERVER_ADDRESS &&
		(!!env.PWB_SESSION_RUNTIME_DIR || !!env.RS_SESSION_RPC_COOKIE);
}

/** The Authentication extension's managed-credentials API, activating that extension if needed. */
async function managedCredentialsApi(): Promise<ManagedCredentialsApi | undefined> {
	const extension = vscode.extensions.getExtension<AuthenticationExtensionExports>(AUTHENTICATION_EXTENSION_ID);
	return (extension?.isActive ? extension.exports : await extension?.activate())?.managedCredentials;
}

/**
 * A token provider for a delegated Azure (Entra ID) token for one resource, for the connection to call
 * on every connect and reconnect. Each call asks the Authentication extension, whose cache keeps that
 * from becoming one Entra ID token exchange per connect. Throws the Authentication extension's
 * localized error, which says what the user or their administrator needs to do.
 *
 * @param resource The Azure resource URI or application id the token is for.
 * @param displayName The service's user-facing name, for error messages.
 */
export function azureTokenProvider(resource: string, displayName: string): () => Promise<string> {
	return async () => {
		let api: ManagedCredentialsApi | undefined;
		try {
			api = await managedCredentialsApi();
		} catch {
			// A broken Authentication extension surfaces as the missing-credential error below.
		}
		const token = await api?.getDelegatedAzureToken?.(resource, displayName);
		if (!token) {
			throw new Error(vscode.l10n.t('No Posit Workbench managed Azure credentials are available for {0}.', displayName));
		}
		return token.accessToken;
	};
}

/**
 * Reads the current Workbench-managed credential through the Authentication extension, activating
 * that extension if needed. Called on every (re)connect, so a token Workbench has rotated is picked
 * up. Throws a localized error when the extension is unavailable or the credential is missing or
 * incomplete.
 *
 * @param authProviderId The Authentication extension's provider id for the credential (e.g. `databricks`).
 * @param displayName The service's user-facing name, for the error message.
 */
export async function getManagedCredential(authProviderId: string, displayName: string): Promise<ManagedCredential> {
	let credential: ManagedCredential | undefined;
	try {
		credential = await (await managedCredentialsApi())?.getManagedCredential(authProviderId);
	} catch {
		// A broken Authentication extension or an unreadable credential file surfaces as the
		// missing-credential error below, rather than as an unlocalized internal error.
	}
	if (!credential) {
		throw new Error(vscode.l10n.t('No Posit Workbench managed credentials are available for {0}.', displayName));
	}
	return credential;
}

/**
 * Reads the Workbench-managed credential to learn its locator and host, and pairs them with a token provider
 * for the connection to call on every connect and reconnect. The provider re-reads the credential so
 * a rotated token is picked up, and refuses a token Workbench has since issued for a different
 * locator rather than sending it to the connection's original account or workspace.
 *
 * @param authProviderId The Authentication extension's provider id for the credential.
 * @param displayName The service's user-facing name, for error messages.
 * @param normalizeLocator Normalizes the locator to the form the driver connects with.
 */
export async function resolveManagedCredential(
	authProviderId: string,
	displayName: string,
	normalizeLocator: (locator: string) => string
): Promise<{ locator: string; host?: string; tokenProvider: () => Promise<string> }> {
	const initial = await getManagedCredential(authProviderId, displayName);
	const locator = normalizeLocator(initial.locator);
	const tokenProvider = async () => {
		const credential = await getManagedCredential(authProviderId, displayName);
		if (normalizeLocator(credential.locator) !== locator) {
			throw new Error(vscode.l10n.t('The Posit Workbench managed credentials for {0} changed to a different account or workspace. Connect again to use them.', displayName));
		}
		return credential.accessToken;
	};
	return { locator, host: initial.host, tokenProvider };
}

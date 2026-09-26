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
}

/**
 * The slice of the Authentication extension's exports a driver uses. A structural copy of its
 * `ManagedCredentialsApi`.
 */
interface ManagedCredentialsApi {
	getManagedCredential(authProviderId: string): Promise<ManagedCredential | undefined>;
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
 * Reads the current Workbench-managed credential through the Authentication extension, activating
 * that extension if needed. Called on every (re)connect, so a token Workbench has rotated is picked
 * up. Throws a localized error when the extension is unavailable or the credential is missing or
 * incomplete.
 *
 * @param authProviderId The Authentication extension's provider id for the credential (e.g. `databricks`).
 * @param displayName The service's user-facing name, for the error message.
 */
export async function getManagedCredential(authProviderId: string, displayName: string): Promise<ManagedCredential> {
	const extension = vscode.extensions.getExtension<AuthenticationExtensionExports>(AUTHENTICATION_EXTENSION_ID);
	let credential: ManagedCredential | undefined;
	try {
		const api = (extension?.isActive ? extension.exports : await extension?.activate())?.managedCredentials;
		credential = await api?.getManagedCredential(authProviderId);
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
 * Reads the Workbench-managed credential to learn its locator, and pairs that with a token provider
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
): Promise<{ locator: string; tokenProvider: () => Promise<string> }> {
	const locator = normalizeLocator((await getManagedCredential(authProviderId, displayName)).locator);
	const tokenProvider = async () => {
		const credential = await getManagedCredential(authProviderId, displayName);
		if (normalizeLocator(credential.locator) !== locator) {
			throw new Error(vscode.l10n.t('The Posit Workbench managed credentials for {0} changed to a different account or workspace. Connect again to use them.', displayName));
		}
		return credential.accessToken;
	};
	return { locator, tokenProvider };
}

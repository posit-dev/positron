/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { RequestAuthenticator } from './connectAuth.js';

/** The id of the authentication provider Posit Publisher registers for Posit Connect. */
export const PUBLISHER_AUTH_PROVIDER_ID = 'posit-connect';

/** The session scope Publisher sets when the access token is an OAuth token. */
const AUTH_SCHEME_BEARER = 'auth-scheme:Bearer';

/** The subset of `vscode.authentication.getSession` the authenticator uses; injectable for tests. */
export type GetSessionFn = (
	providerId: string,
	scopes: readonly string[],
	options: vscode.AuthenticationGetSessionOptions,
) => Thenable<vscode.AuthenticationSession | undefined>;

/** The Authorization header for a Publisher session, chosen by its `auth-scheme:` scope. */
export function sessionAuthHeader(session: vscode.AuthenticationSession): string {
	const scheme = session.scopes.includes(AUTH_SCHEME_BEARER) ? 'Bearer' : 'Key';
	return `${scheme} ${session.accessToken}`;
}

/**
 * Authenticates with a session from Posit Publisher's `posit-connect` authentication provider. The
 * session is an API key or an OAuth access token. Publisher refreshes an expiring OAuth token when a
 * session is requested, so {@link prepare} asks for the session again before each request instead of
 * holding on to the first one.
 */
export class PublisherSessionAuthenticator implements RequestAuthenticator {
	readonly authFailureHint = 'Your Posit Connect sign-in in Posit Publisher may have expired or been removed. Connect again to sign in.';

	/**
	 * @param _serverUrl The normalized Connect server URL, passed to Publisher as a scope.
	 * @param _session The session from the initial (interactive) request.
	 * @param _getSession Requests sessions; defaults to `vscode.authentication.getSession`.
	 */
	constructor(
		private readonly _serverUrl: string,
		private _session: vscode.AuthenticationSession,
		private readonly _getSession: GetSessionFn = vscode.authentication.getSession,
	) { }

	/** Asks Publisher for the current session without prompting, which refreshes an expiring token. */
	async prepare(): Promise<void> {
		const session = await this._getSession(PUBLISHER_AUTH_PROVIDER_ID, [this._serverUrl], { silent: true });
		if (!session) {
			throw new Error(`No Posit Connect sign-in for ${this._serverUrl} was found in Posit Publisher. Connect again to sign in.`);
		}
		this._session = session;
	}

	headers(_method?: string, _path?: string, _bodyChecksum?: string): Record<string, string> {
		return { 'Authorization': sessionAuthHeader(this._session) };
	}
}

/**
 * Gets a Publisher session for a server: silently first, so reconnecting a saved connection does not
 * prompt, then interactively, which runs Publisher's sign-in flow when it has no credential for the
 * server. Rejects with a clear error when Publisher is missing or the user cancels.
 */
export async function getPublisherSession(serverUrl: string, getSession: GetSessionFn = vscode.authentication.getSession): Promise<vscode.AuthenticationSession> {
	try {
		const existing = await getSession(PUBLISHER_AUTH_PROVIDER_ID, [serverUrl], { silent: true });
		if (existing) {
			return existing;
		}
		const created = await getSession(PUBLISHER_AUTH_PROVIDER_ID, [serverUrl], { createIfNone: true });
		if (!created) {
			throw new Error(vscode.l10n.t('Sign in to {0} was canceled.', serverUrl));
		}
		return created;
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		// VS Code rejects with this message when no extension has registered the provider.
		if (/No authentication provider/i.test(detail)) {
			throw new Error(vscode.l10n.t('Posit Publisher is not available. Install or enable the Posit Publisher extension to sign in with it.'));
		}
		throw err;
	}
}

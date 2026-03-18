/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { log } from './log';
import { AWS_MANAGED_CREDENTIALS, hasManagedCredentials } from './managedCredentials';

/** Credentials returned in the session's accessToken (JSON-encoded). */
export interface AwsSessionCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}

/** How often to re-resolve credentials in the background (ms). */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Authentication provider for AWS.
 *
 * Resolves AWS credentials via the standard credential chain
 * (`fromNodeProviderChain`) and exposes them as cached sessions
 * through `vscode.authentication.getSession('aws', ...)`.
 *
 * The session's `accessToken` is a JSON-encoded
 * `AwsSessionCredentials` containing AWS credentials only.
 * Region and profile live in `authentication.aws.credentials`
 * settings and are read directly by consumers.
 *
 * Credentials are resolved once on activation and refreshed on a
 * background timer. `onDidChangeSessions` fires when credentials
 * change or expire so consumers can re-fetch.
 */
export class AwsAuthProvider
	implements vscode.AuthenticationProvider, vscode.Disposable {

	private readonly _onDidChangeSessions =
		new vscode.EventEmitter<
			vscode.AuthenticationProviderAuthenticationSessionsChangeEvent
		>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _credentialProvider: AwsCredentialIdentityProvider | undefined;
	private _cachedSession: vscode.AuthenticationSession | undefined;
	private _refreshTimer: ReturnType<typeof setInterval> | undefined;
	private _region: string = 'us-east-1';
	private _profile: string | undefined;

	constructor() {
		this.initialize();
	}

	dispose(): void {
		if (this._refreshTimer) {
			clearInterval(this._refreshTimer);
		}
		this._onDidChangeSessions.dispose();
	}

	/**
	 * Returns the cached session without performing I/O.
	 */
	async getSessions(): Promise<vscode.AuthenticationSession[]> {
		return this._cachedSession ? [this._cachedSession] : [];
	}

	/**
	 * Accounts menu "Sign in": re-resolves credentials from the AWS
	 * credential chain. Useful after `aws sso login` or credential
	 * file changes.
	 */
	async createSession(): Promise<vscode.AuthenticationSession> {
		const session = await this.resolveCredentials();
		if (!session) {
			throw new Error(
				vscode.l10n.t(
					'No AWS credentials found. Configure credentials ' +
					'using the AWS CLI or environment variables.'
				)
			);
		}
		this.startRefreshTimer();
		return session;
	}

	/**
	 * Clears the cached session and fires a removal event.
	 */
	async removeSession(sessionId: string): Promise<void> {
		if (this._cachedSession?.id === sessionId) {
			this.stopRefreshTimer();
			const removed = this._cachedSession;
			this._cachedSession = undefined;
			this._onDidChangeSessions.fire({
				added: [], removed: [removed], changed: [],
			});
			log.info('[AWS] Session removed');
		}
	}

	private initialize(): void {
		const awsConfig = vscode.workspace
			.getConfiguration('authentication.aws')
			.get<{ AWS_PROFILE?: string; AWS_REGION?: string }>(
				'credentials', {}
			);

		// Settings override environment variables
		this._profile = awsConfig.AWS_PROFILE
			?? process.env.AWS_PROFILE;
		this._region = awsConfig.AWS_REGION
			?? process.env.AWS_REGION ?? 'us-east-1';

		// Always set up the credential provider (needed for createSession on desktop)
		this._credentialProvider = fromNodeProviderChain(
			this._profile ? { profile: this._profile } : {}
		);

		log.info(
			`[AWS] Credential provider initialized ` +
			`(region=${this._region}, ` +
			`profile=${this._profile ?? '(default)'})`
		);

	}

	/**
	 * Attempt to resolve credentials from the chain. On PWB this
	 * picks up managed credentials; on desktop it picks up cached
	 * SSO tokens, env vars, or credential files from a previous
	 * sign-in. Fails silently if nothing is available.
	 *
	 * Called by activate() so the extension dependency guarantees
	 * credentials are cached before consumers activate.
	 */
	async resolveInitialCredentials(): Promise<void> {
		const session = await this.resolveCredentials();
		if (session) {
			this.startRefreshTimer();
		}
	}

	private startRefreshTimer(): void {
		if (!this._refreshTimer) {
			this._refreshTimer = setInterval(
				() => this.resolveCredentials(),
				REFRESH_INTERVAL_MS
			);
		}
	}

	private stopRefreshTimer(): void {
		if (this._refreshTimer) {
			clearInterval(this._refreshTimer);
			this._refreshTimer = undefined;
		}
	}

	/**
	 * Resolves AWS credentials, updates the cache, and fires
	 * session-change events when the state transitions.
	 */
	private async resolveCredentials(
	): Promise<vscode.AuthenticationSession | undefined> {
		if (!this._credentialProvider) {
			return undefined;
		}

		try {
			const resolved = await this._credentialProvider();
			const credentials: AwsSessionCredentials = {
				accessKeyId: resolved.accessKeyId,
				secretAccessKey: resolved.secretAccessKey,
				sessionToken: resolved.sessionToken,
			};

			const session: vscode.AuthenticationSession = {
				id: 'aws',
				accessToken: JSON.stringify(credentials),
				account: {
					id: 'aws',
					label: 'AWS',
				},
				scopes: [],
			};

			const hadSession = !!this._cachedSession;
			this._cachedSession = session;

			if (!hadSession) {
				this._onDidChangeSessions.fire({
					added: [session], removed: [], changed: [],
				});
				log.info('[AWS] Credentials resolved');
			}
			// Credentials rotated silently; no event needed for
			// changed values since the session ID is stable.

			return session;
		} catch (err) {
			log.debug(
				`[AWS] Credential resolution failed: ` +
				`${err instanceof Error ? err.message : String(err)}`
			);

			if (this._cachedSession) {
				const removed = this._cachedSession;
				this._cachedSession = undefined;
				this._onDidChangeSessions.fire({
					added: [], removed: [removed], changed: [],
				});
				log.info(
					'[AWS] Cached session invalidated'
				);
			}
			return undefined;
		}
	}
}

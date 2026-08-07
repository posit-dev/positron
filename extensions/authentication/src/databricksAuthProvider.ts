/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { DATABRICKS_AUTH_PROVIDER_ID, DATABRICKS_OAUTH_SESSION_ID } from './constants';
import { AuthProvider, CredentialChainConfig } from './authProvider';
import { DatabricksLoopbackServer } from './databricksAuthServer';
import {
	buildAuthorizeUrl,
	discoverOAuthEndpoints,
	exchangeCodeForTokens,
	generatePkcePair,
	generateState,
	normalizeHost,
	refreshTokens,
	TokenSet,
} from './databricksOAuth';
import { log } from './log';
import { getCachedProvider, saveDatabricksHost } from './providerCatalog';

const SECRET_ACCESS_TOKEN = 'databricks.access_token';
const SECRET_REFRESH_TOKEN = 'databricks.refresh_token';
const SECRET_TOKEN_EXPIRY = 'databricks.token_expiry';
const SECRET_HOST = 'databricks.host';

/** Refresh the access token when within this window of expiry. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** How long to wait for the browser redirect before giving up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

function throwIfCancelled(token: vscode.CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new Error('Databricks sign-in was cancelled.');
	}
}

/**
 * Databricks authentication provider.
 *
 * Three credential paths, listed in getSessions() precedence order:
 * 1. OAuth U2M (desktop only) -- authorization code + PKCE against the
 *    built-in `databricks-cli` public client, with a loopback server on
 *    ports 8020-8040. Tokens are refreshed lazily. Uses its own session id
 *    (DATABRICKS_OAUTH_SESSION_ID) since it can coexist with a chain session.
 * 2. Credential chain (base-class machinery) -- DATABRICKS_TOKEN env var or
 *    a Workbench-managed .databrickscfg profile.
 * 3. Personal access tokens -- the base-class API key machinery, used on
 *    remote/web where the loopback redirect cannot reach the extension
 *    host, or whenever the user prefers a PAT.
 */
export class DatabricksAuthProvider extends AuthProvider {

	/** Single in-flight refresh so concurrent getSessions calls don't double-refresh. */
	private _refreshPromise: Promise<string | undefined> | null = null;

	private _signInCancellation: vscode.CancellationTokenSource | null = null;

	constructor(
		context: vscode.ExtensionContext,
		credentialChain?: CredentialChainConfig,
	) {
		super(DATABRICKS_AUTH_PROVIDER_ID, 'Databricks', context, undefined, credentialChain);
	}

	// --- AuthProvider overrides ---

	override async getSessions(
		scopes?: readonly string[],
		options?: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession[]> {
		const sessions: vscode.AuthenticationSession[] = [];

		const oauthSession = await this.getOAuthSession();
		if (oauthSession &&
			(!options?.account || options.account.id === oauthSession.account.id)) {
			sessions.push(oauthSession);
		}

		// Credential chain session, else stored personal access tokens
		// (base-class machinery).
		const chainOrPatSessions = await super.getSessions(scopes, options);
		return [...sessions, ...chainOrPatSessions];
	}

	override async createSession(
		_scopes: readonly string[],
		_options?: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession> {
		const host = normalizeHost(await this.resolveHost());
		await this.persistHostSetting(host);

		if (vscode.env.remoteName !== undefined ||
			vscode.env.uiKind === vscode.UIKind.Web) {
			// The loopback redirect can't reach a remote extension host;
			// fall back to a personal access token.
			return this.createPatSession(host);
		}

		return this.signInWithOAuth(host);
	}

	override async removeSession(sessionId: string): Promise<void> {
		if (sessionId === DATABRICKS_OAUTH_SESSION_ID) {
			const removed = await this.buildStoredOAuthSession();
			await this.clearOAuthSecrets();
			if (removed) {
				this.fireSessionsChanged({
					added: [], removed: [removed], changed: [],
				});
			}
			log.info('[Databricks] Signed out of OAuth session.');
			return;
		}
		return super.removeSession(sessionId);
	}

	override cancelSignIn(): void {
		this._signInCancellation?.cancel();
		this._signInCancellation?.dispose();
		this._signInCancellation = null;
	}

	override dispose(): void {
		this.cancelSignIn();
		super.dispose();
	}

	// --- OAuth session management ---

	/**
	 * Return the stored OAuth session, lazily refreshing the access token
	 * when it is within REFRESH_BUFFER_MS of expiry. Returns undefined when
	 * no OAuth credentials are stored or the refresh fails (the stored
	 * credentials are cleared in that case).
	 */
	private async getOAuthSession(
	): Promise<vscode.AuthenticationSession | undefined> {
		const accessToken = await this.context.secrets.get(SECRET_ACCESS_TOKEN);
		const expiry = await this.context.secrets.get(SECRET_TOKEN_EXPIRY);
		if (!accessToken || !expiry) {
			return undefined;
		}

		let token: string | undefined = accessToken;
		if (Date.now() >= parseInt(expiry) - REFRESH_BUFFER_MS) {
			if (!this._refreshPromise) {
				this._refreshPromise = this.refreshOAuthTokens()
					.finally(() => { this._refreshPromise = null; });
			}
			token = await this._refreshPromise;
			if (!token) {
				return undefined;
			}
		}

		const host = await this.context.secrets.get(SECRET_HOST);
		return this.makeOAuthSession(token, host);
	}

	/**
	 * Refresh the stored tokens. On failure, clears the OAuth secrets and
	 * fires a removed event so consumers know to re-authenticate.
	 */
	private async refreshOAuthTokens(): Promise<string | undefined> {
		try {
			const refreshToken = await this.context.secrets.get(SECRET_REFRESH_TOKEN);
			const host = await this.context.secrets.get(SECRET_HOST);
			if (!refreshToken || !host) {
				throw new Error('No stored refresh token or workspace host');
			}
			log.info('[Databricks] Refreshing OAuth access token.');
			const endpoints = await discoverOAuthEndpoints(host);
			const tokens = await refreshTokens(endpoints.tokenEndpoint, refreshToken);
			await this.storeOAuthSecrets(host, tokens);
			log.info('[Databricks] OAuth access token refreshed.');
			return tokens.accessToken;
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			log.error(`[Databricks] Failed to refresh OAuth access token: ${errorMsg}`);
			const removed = await this.buildStoredOAuthSession();
			await this.clearOAuthSecrets();
			if (removed) {
				this.fireSessionsChanged({
					added: [], removed: [removed], changed: [],
				});
			}
			// The refresh runs from getSessions, so this can fire while the
			// user is mid-chat with no provider modal open. Clearing the
			// secrets signs them out, so say so rather than failing silently.
			vscode.window.showErrorMessage(vscode.l10n.t(
				'Databricks sign-in has expired. Sign in again to keep using Databricks models: {0}',
				errorMsg
			));
			return undefined;
		}
	}

	private async signInWithOAuth(
		host: string
	): Promise<vscode.AuthenticationSession> {
		const state = generateState();
		const { verifier, challenge } = generatePkcePair();
		const server = new DatabricksLoopbackServer(state);
		const cancellation = new vscode.CancellationTokenSource();
		this._signInCancellation = cancellation;
		const abort = new AbortController();
		const abortOnCancel = cancellation.token.onCancellationRequested(
			() => abort.abort()
		);

		try {
			await server.start();
			throwIfCancelled(cancellation.token);
			const endpoints = await discoverOAuthEndpoints(host, abort.signal);
			throwIfCancelled(cancellation.token);
			const authorizeUrl = buildAuthorizeUrl(
				endpoints.authorizationEndpoint, state, challenge, server.redirectUri
			);
			log.info(`[Databricks] Starting OAuth sign-in for ${host} (redirect ${server.redirectUri}).`);
			await vscode.env.openExternal(vscode.Uri.parse(authorizeUrl));

			const code = await server.waitForCode(
				SIGN_IN_TIMEOUT_MS, cancellation.token
			);
			const tokens = await exchangeCodeForTokens(
				endpoints.tokenEndpoint, code, verifier, server.redirectUri
			);
			await this.storeOAuthSecrets(host, tokens);

			const session = this.makeOAuthSession(tokens.accessToken, host);
			this.fireSessionsChanged({
				added: [session], removed: [], changed: [],
			});
			log.info('[Databricks] OAuth sign-in successful.');
			return session;
		} finally {
			abortOnCancel.dispose();
			await server.stop();
			cancellation.dispose();
			if (this._signInCancellation === cancellation) {
				this._signInCancellation = null;
			}
		}
	}

	private async createPatSession(
		host: string
	): Promise<vscode.AuthenticationSession> {
		const raw = await vscode.window.showInputBox({
			prompt: vscode.l10n.t(
				'Enter a Databricks personal access token for {0}', host
			),
			password: true,
			ignoreFocusOut: true,
			validateInput: value => value.trim()
				? undefined
				: vscode.l10n.t('A personal access token is required'),
		});
		const token = raw?.trim();
		if (!token) {
			throw new Error(vscode.l10n.t('A personal access token is required'));
		}
		return this.storeKey(
			randomUUID(), this.accountLabel(host), token
		);
	}

	// --- Helpers ---

	/**
	 * Resolve the workspace host from the provider catalog, then prompt the
	 * user. The catalog already folds in the DATABRICKS_HOST env var and the
	 * legacy `authentication.databricks.credentials` setting, so both are
	 * covered by the single read.
	 */
	private async resolveHost(): Promise<string> {
		const configuredHost = getCachedProvider('databricks')
			?.connection.databricks?.host?.trim();
		if (configuredHost) {
			return configuredHost;
		}

		const input = await vscode.window.showInputBox({
			prompt: vscode.l10n.t(
				'Enter your Databricks workspace URL (e.g. https://adb-1234567890123456.7.azuredatabricks.net)'
			),
			ignoreFocusOut: true,
			validateInput: value => value.trim()
				? undefined
				: vscode.l10n.t('A workspace URL is required'),
		});
		const host = input?.trim();
		if (!host) {
			throw new Error(vscode.l10n.t('A Databricks workspace URL is required'));
		}
		return host;
	}

	/**
	 * Persist the normalized host to the provider catalog. saveDatabricksHost
	 * no-ops when the host is unchanged.
	 */
	private async persistHostSetting(host: string): Promise<void> {
		await saveDatabricksHost(host).then(undefined, err =>
			log.error(`[Databricks] Failed to persist workspace host: ${err}`)
		);
	}

	private accountLabel(host: string | undefined): string {
		let hostname = host ?? '';
		try {
			hostname = host ? new URL(normalizeHost(host)).hostname : '';
		} catch {
			// Fall back to the raw host string.
		}
		return hostname ? `Databricks (${hostname})` : 'Databricks';
	}

	private makeOAuthSession(
		accessToken: string,
		host: string | undefined
	): vscode.AuthenticationSession {
		return {
			id: DATABRICKS_OAUTH_SESSION_ID,
			accessToken,
			account: {
				id: DATABRICKS_OAUTH_SESSION_ID,
				label: this.accountLabel(host),
			},
			scopes: [],
		};
	}

	/**
	 * Build a session object from the stored secrets, for removed events.
	 */
	private async buildStoredOAuthSession(
	): Promise<vscode.AuthenticationSession | undefined> {
		const accessToken = await this.context.secrets.get(SECRET_ACCESS_TOKEN);
		if (!accessToken) {
			return undefined;
		}
		const host = await this.context.secrets.get(SECRET_HOST);
		return this.makeOAuthSession(accessToken, host);
	}

	private async storeOAuthSecrets(
		host: string,
		tokens: TokenSet
	): Promise<void> {
		await this.context.secrets.store(SECRET_ACCESS_TOKEN, tokens.accessToken);
		await this.context.secrets.store(SECRET_REFRESH_TOKEN, tokens.refreshToken);
		await this.context.secrets.store(SECRET_TOKEN_EXPIRY, tokens.expiresAt.toString());
		await this.context.secrets.store(SECRET_HOST, host);
	}

	private async clearOAuthSecrets(): Promise<void> {
		await this.context.secrets.delete(SECRET_ACCESS_TOKEN);
		await this.context.secrets.delete(SECRET_REFRESH_TOKEN);
		await this.context.secrets.delete(SECRET_TOKEN_EXPIRY);
		await this.context.secrets.delete(SECRET_HOST);
	}
}

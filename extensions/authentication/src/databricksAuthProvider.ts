/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { DATABRICKS_AUTH_PROVIDER_ID } from './constants';
import { AuthProvider } from './authProvider';
import { DatabricksLoopbackServer } from './databricksAuthServer';
import {
	buildAuthorizeUrl,
	exchangeCodeForTokens,
	generatePkcePair,
	generateState,
	normalizeHost,
	refreshTokens,
	TokenSet,
} from './databricksOAuth';
import { log } from './log';

const SECRET_ACCESS_TOKEN = 'databricks.access_token';
const SECRET_REFRESH_TOKEN = 'databricks.refresh_token';
const SECRET_TOKEN_EXPIRY = 'databricks.token_expiry';
const SECRET_HOST = 'databricks.host';

/** Refresh the access token when within this window of expiry. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** How long to wait for the browser redirect before giving up. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Databricks authentication provider.
 *
 * Two credential paths:
 * 1. OAuth U2M (desktop only) -- authorization code + PKCE against the
 *    built-in `databricks-cli` public client, with a loopback server on
 *    the fixed redirect port 8020. Tokens are refreshed lazily.
 * 2. Personal access tokens -- the base-class API key machinery, used on
 *    remote/web where the loopback redirect cannot reach the extension
 *    host, or whenever the user prefers a PAT.
 */
export class DatabricksAuthProvider extends AuthProvider {

	/** Single in-flight refresh so concurrent getSessions calls don't double-refresh. */
	private _refreshPromise: Promise<string | undefined> | null = null;

	private _signInCancellation: vscode.CancellationTokenSource | null = null;

	constructor(context: vscode.ExtensionContext) {
		super(DATABRICKS_AUTH_PROVIDER_ID, 'Databricks', context);
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

		// Stored personal access tokens (base-class machinery).
		const patSessions = await super.getSessions(scopes, options);
		return [...sessions, ...patSessions];
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
		if (sessionId === DATABRICKS_AUTH_PROVIDER_ID) {
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
			const tokens = await refreshTokens(host, refreshToken);
			await this.storeOAuthSecrets(host, tokens);
			log.info('[Databricks] OAuth access token refreshed.');
			return tokens.accessToken;
		} catch (err) {
			log.error(`[Databricks] Failed to refresh OAuth access token: ${err instanceof Error ? err.message : String(err)}`);
			const removed = await this.buildStoredOAuthSession();
			await this.clearOAuthSecrets();
			if (removed) {
				this.fireSessionsChanged({
					added: [], removed: [removed], changed: [],
				});
			}
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

		try {
			await server.start();
			const authorizeUrl = buildAuthorizeUrl(host, state, challenge);
			log.info(`[Databricks] Starting OAuth sign-in for ${host}.`);
			await vscode.env.openExternal(vscode.Uri.parse(authorizeUrl));

			const code = await server.waitForCode(
				SIGN_IN_TIMEOUT_MS, cancellation.token
			);
			const tokens = await exchangeCodeForTokens(host, code, verifier);
			await this.storeOAuthSecrets(host, tokens);

			const session = this.makeOAuthSession(tokens.accessToken, host);
			this.fireSessionsChanged({
				added: [session], removed: [], changed: [],
			});
			log.info('[Databricks] OAuth sign-in successful.');
			return session;
		} finally {
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
	 * Resolve the workspace host: setting, then environment variable,
	 * then prompt the user.
	 */
	private async resolveHost(): Promise<string> {
		const credentials = vscode.workspace
			.getConfiguration('authentication.databricks')
			.get<Record<string, string>>('credentials', {});
		const configuredHost = credentials?.DATABRICKS_HOST?.trim();
		if (configuredHost) {
			return configuredHost;
		}

		const envHost = process.env.DATABRICKS_HOST?.trim();
		if (envHost) {
			return envHost;
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
	 * Persist the normalized host back to the global credentials setting.
	 * Read the global scope only so workspace-scoped values are not copied
	 * into global (same pattern as the Snowflake account sync).
	 */
	private async persistHostSetting(host: string): Promise<void> {
		const cfg = vscode.workspace
			.getConfiguration('authentication.databricks');
		const inspection = cfg.inspect<Record<string, string>>('credentials');
		const globalValue = inspection?.globalValue ?? {};
		if (globalValue.DATABRICKS_HOST !== host) {
			await cfg.update(
				'credentials',
				{ ...globalValue, DATABRICKS_HOST: host },
				vscode.ConfigurationTarget.Global
			).then(undefined, err =>
				log.error(`[Databricks] Failed to persist workspace host: ${err}`)
			);
		}
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
			id: DATABRICKS_AUTH_PROVIDER_ID,
			accessToken,
			account: {
				id: DATABRICKS_AUTH_PROVIDER_ID,
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

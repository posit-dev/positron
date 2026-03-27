/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { POSIT_AUTH_PROVIDER_ID } from './constants';
import { log } from './log';


/**
 * Posit AI authentication provider using OAuth 2.0 Device Authorization
 * Grant (RFC 8628).
 *
 * Sign-in and sign-out are routed through `createSession`/`removeSession`
 * so the config dialog can use the standard AuthenticationProvider API.
 */
export class PositOAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	private readonly _onDidChangeSessions = new vscode.EventEmitter<
		vscode.AuthenticationProviderAuthenticationSessionsChangeEvent
	>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _cancellationToken: vscode.CancellationTokenSource | null = null;

	constructor(private readonly _context: vscode.ExtensionContext) { }

	private async signIn(): Promise<void> {
		log.info('[Posit AI] Signing in.');

		const params = this.getOAuthParameters();
		const response = await fetch(
			`${params.authHost}/oauth/device/authorize?scope=${params.scope}&client_id=${params.clientId}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
			}
		);

		if (!response.ok) {
			throw new Error(`Failed to start device authorization: ${response.statusText}`);
		}

		const data = await response.json() as {
			verification_uri_complete: string;
			interval: number;
			user_code: string;
			device_code: string;
		};
		const { verification_uri_complete, interval, user_code, device_code } = data;

		await vscode.env.clipboard.writeText(user_code);
		await positron.methods.showDialog(
			'Posit AI Sign In',
			`You will need this code to sign in: <code>${user_code}</code>. It has been copied to your clipboard.`,
		);
		await vscode.env.openExternal(vscode.Uri.parse(verification_uri_complete));

		const cancellationToken = new vscode.CancellationTokenSource();
		this._cancellationToken = cancellationToken;

		cancellationToken.token.onCancellationRequested(() => {
			vscode.window.showInformationMessage(vscode.l10n.t('Posit AI sign-in cancelled.'));
		});

		try {
			let currentInterval = Math.max(interval ?? 5, 5);
			while (true) {
				if (cancellationToken.token.isCancellationRequested) {
					throw new vscode.CancellationError();
				}

				await new Promise(resolve => setTimeout(resolve, currentInterval * 1000));

				const tokenResponse = await fetch(
					`${params.authHost}/oauth/token`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body: new URLSearchParams({
							scope: params.scope,
							client_id: params.clientId,
							grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
							device_code: device_code
						}).toString()
					}
				);

				if (tokenResponse.status === 200) {
					const tokenData = await tokenResponse.json() as {
						access_token: string;
						refresh_token: string;
						expires_in: number;
					};
					const { access_token, refresh_token, expires_in } = tokenData;
					const expiryTime = Date.now() + expires_in * 1000;

					await this._context.secrets.store('posit-ai.access_token', access_token);
					await this._context.secrets.store('posit-ai.refresh_token', refresh_token);
					await this._context.secrets.store('posit-ai.token_expiry', expiryTime.toString());

					log.info('[Posit AI] Sign-in successful.');
					return;
				}

				if (tokenResponse.status === 400) {
					const errorData = await tokenResponse.json() as { error: string };
					switch (errorData.error) {
						case 'authorization_pending':
							continue;
						case 'slow_down':
							currentInterval += 5;
							continue;
						case 'expired_token':
							vscode.window.showErrorMessage(vscode.l10n.t('Your verification code has expired. Please try signing in again.'));
							throw new Error('Verification code expired.');
						case 'access_denied':
							vscode.window.showErrorMessage(vscode.l10n.t('Authorization request was denied.'));
							throw new Error('Authorization denied.');
						default:
							throw new Error(`Unexpected error during token exchange: ${errorData.error}`);
					}
				} else {
					throw new Error(`Unexpected response from token endpoint: ${tokenResponse.statusText}`);
				}
			}
		} finally {
			cancellationToken.dispose();
			this._cancellationToken = null;
		}
	}

	private async signOut(): Promise<void> {
		log.info('[Posit AI] Signing out.');
		await this._context.secrets.delete('posit-ai.access_token');
		await this._context.secrets.delete('posit-ai.refresh_token');
		await this._context.secrets.delete('posit-ai.token_expiry');
	}

	cancelSignIn(): void {
		this._cancellationToken?.cancel();
		this._cancellationToken?.dispose();
		this._cancellationToken = null;
	}

	// --- vscode.AuthenticationProvider ---

	async getSessions(_scopes?: readonly string[], _options?: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession[]> {
		try {
			const accessToken = await this.getAccessToken();
			return [{
				id: POSIT_AUTH_PROVIDER_ID,
				accessToken,
				account: { label: 'Posit AI', id: POSIT_AUTH_PROVIDER_ID },
				scopes: [],
			}];
		} catch {
			return [];
		}
	}

	async createSession(_scopes: readonly string[], _options: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession> {
		await this.signIn();

		const accessToken = await this.getAccessToken();

		const session: vscode.AuthenticationSession = {
			id: POSIT_AUTH_PROVIDER_ID,
			accessToken,
			account: { label: 'Posit AI', id: POSIT_AUTH_PROVIDER_ID },
			scopes: [],
		};

		this._onDidChangeSessions.fire({
			added: [session], removed: [], changed: [],
		});

		return session;
	}

	async removeSession(_sessionId: string): Promise<void> {
		const sessions = await this.getSessions();
		await this.signOut();

		this._onDidChangeSessions.fire({
			added: [], removed: sessions, changed: [],
		});
	}

	// --- Token management ---

	/**
	 * Get the current access token, refreshing if needed.
	 */
	async getAccessToken(): Promise<string> {
		let accessToken = await this._context.secrets.get('posit-ai.access_token');
		const tokenExpiry = await this._context.secrets.get('posit-ai.token_expiry');

		if (!accessToken || !tokenExpiry) {
			throw new Error('No Posit AI access token found. Please sign in.');
		}

		const tenMin = 10 * 60 * 1000;
		const expiry = parseInt(tokenExpiry) - tenMin;
		if (Date.now() >= expiry) {
			const result = await this.refreshAccessToken();
			if (!result.success) {
				throw new Error('Failed to refresh Posit AI access token. Please sign in again.');
			}
			accessToken = result.accessToken;
		}

		return accessToken;
	}

	private async refreshAccessToken(): Promise<{ success: false } | { success: true; accessToken: string }> {
		log.info('[Posit AI] Refreshing access token.');
		const params = this.getOAuthParameters();

		const refreshToken = await this._context.secrets.get('posit-ai.refresh_token');
		if (!refreshToken) {
			log.error('[Posit AI] No refresh token found.');
			return { success: false };
		}

		const response = await fetch(
			`${params.authHost}/oauth/token`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					scope: params.scope,
					client_id: params.clientId,
					grant_type: 'refresh_token',
					refresh_token: refreshToken
				}).toString()
			}
		);

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({})) as { error_description?: string };
			const errorMsg = errorData.error_description || response.statusText;
			log.error(`[Posit AI] Failed to refresh token: ${errorMsg}`);
			vscode.window.showErrorMessage(vscode.l10n.t('Failed to refresh Posit AI access token: {0}', errorMsg));
			return { success: false };
		}

		const tokenData = await response.json() as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};
		const { access_token, refresh_token, expires_in } = tokenData;
		const expiryTime = Date.now() + expires_in * 1000;

		await this._context.secrets.store('posit-ai.access_token', access_token);
		await this._context.secrets.store('posit-ai.refresh_token', refresh_token);
		await this._context.secrets.store('posit-ai.token_expiry', expiryTime.toString());

		log.info('[Posit AI] Access token refreshed successfully.');
		return { success: true, accessToken: access_token };
	}

	private getOAuthParameters(): { authHost: string; scope: string; clientId: string } {
		const config = vscode.workspace.getConfiguration('authentication.positai');
		const authHost = config.inspect<string>('authHost')?.globalValue
			?? 'https://login.posit.cloud';
		const scope = config.inspect<string>('scope')?.globalValue
			?? 'prism';
		const clientId = config.inspect<string>('clientId')?.globalValue
			?? 'positron';

		return { authHost, scope, clientId };
	}

	dispose(): void {
		this.cancelSignIn();
		this._onDidChangeSessions.dispose();
	}
}

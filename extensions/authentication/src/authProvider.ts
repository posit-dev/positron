/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { AuthProviderLogger } from './authProviderLogger';

interface StoredAccount {
	readonly id: string;
	readonly label: string;
}

/**
 * Optional Workbench delegation config. When present, `getSessions` checks
 * for a Workbench-managed bearer token before falling back to stored API keys.
 */
export interface WorkbenchCredentialConfig {
	readonly authProviderId: string;
	readonly scopes: string[];
	/** Additional check beyond IS_RUNNING_ON_PWB (e.g. endpoint configured). */
	readonly isAvailable: () => boolean;
}

/**
 * Credential chain config for providers that resolve credentials
 * from an external source (e.g. AWS SDK credential chain).
 */
export interface CredentialChainConfig {
	readonly resolve: () => Promise<string>;
	readonly refreshIntervalMs?: number;
	/** Optional check called in getSessions to decide whether to re-resolve. */
	readonly shouldRefresh?: () => Promise<boolean>;
	/**
	 * When true, prevents the user from signing out while the chain
	 * can still resolve. Use for static env var credentials that will
	 * just reappear immediately after removal.
	 */
	readonly preventSignOut?: boolean;
}

/**
 * Generic AuthenticationProvider supporting three credential strategies:
 * 1. Credential chain -- resolved from environment (e.g. AWS SDK)
 * 2. Workbench delegation -- bearer tokens from Posit Workbench
 * 3. Stored API keys -- user-provided keys in secret storage
 */
export class AuthProvider
	implements vscode.AuthenticationProvider, vscode.Disposable {

	private readonly _onDidChangeSessions =
		new vscode.EventEmitter<
			vscode.AuthenticationProviderAuthenticationSessionsChangeEvent
		>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private _chainSession: vscode.AuthenticationSession | undefined;
	private _refreshTimer: ReturnType<typeof setInterval> | undefined;
	private _disposed = false;
	private readonly logger: AuthProviderLogger;

	constructor(
		private readonly providerId: string,
		private readonly displayName: string,
		protected readonly context: vscode.ExtensionContext,
		private readonly workbench?: WorkbenchCredentialConfig,
		private readonly credentialChain?: CredentialChainConfig,
	) {
		this.logger = new AuthProviderLogger(this.displayName);
	}

	/** Whether this provider blocks sign-out for chain sessions. */
	get chainPreventsSignOut(): boolean {
		return !!this.credentialChain?.preventSignOut;
	}

	/** Expose session-change events to subclasses. */
	protected fireSessionsChanged(
		event: vscode.AuthenticationProviderAuthenticationSessionsChangeEvent
	): void {
		this._onDidChangeSessions.fire(event);
	}

	dispose(): void {
		this._disposed = true;
		this.stopRefreshTimer();
		this._onDidChangeSessions.dispose();
	}

	private get accountsKey(): string {
		return `auth.accounts.${this.providerId}`;
	}

	private getStoredAccounts(): StoredAccount[] {
		return this.context.globalState.get<StoredAccount[]>(this.accountsKey) ?? [];
	}

	private async setStoredAccounts(accounts: StoredAccount[]): Promise<void> {
		await this.context.globalState.update(this.accountsKey, accounts);
	}

	private secretKey(accountId: string): string {
		return `apiKey-${this.providerId}-${accountId}`;
	}

	async getSessions(
		_scopes?: readonly string[],
		options?: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession[]> {
		// Credential chain (e.g. AWS, Snowflake)
		if (this.credentialChain) {
			if (this.credentialChain.shouldRefresh) {
				const needsRefresh = await this.credentialChain.shouldRefresh();
				if (needsRefresh) {
					await this.resolveChainCredentials();
				}
			}
			if (this._chainSession) {
				this.logger.logSessionChange('retrieved', 'getSessions: returned chain session');
				return [this._chainSession];
			}
		}

		// Workbench-managed credentials
		if (this.workbench) {
			const session = await this.getManagedSession();
			if (session) {
				this.logger.logSessionChange('retrieved', 'getSessions: returned Workbench-managed session');
				return [session];
			}
		}

		// Stored API keys
		const accounts = this.getStoredAccounts();
		const filtered = options?.account
			? accounts.filter(a => a.id === options.account!.id)
			: accounts;

		const sessions: vscode.AuthenticationSession[] = [];
		for (const account of filtered) {
			const key = await this.context.secrets.get(this.secretKey(account.id));
			if (key !== undefined) {
				sessions.push({
					id: account.id,
					accessToken: key,
					account: { id: account.id, label: account.label },
					scopes: [],
				});
			}
		}
		this.logger.logSessionChange('retrieved', `getSessions: returned ${sessions.length} stored session(s)`);
		return sessions;
	}

	/**
	 * Accounts menu entry point. For credential chain providers,
	 * re-resolves from the chain. Otherwise prompts for an API key.
	 */
	async createSession(
		_scopes: readonly string[],
		_options?: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession> {
		if (this.credentialChain) {
			const session = await this.resolveChainCredentials();
			if (!session) {
				throw new Error(
					vscode.l10n.t(
						'No credentials found for {0}. Configure credentials ' +
						'using the provider CLI or environment variables.',
						this.displayName
					)
				);
			}
			return session;
		}

		const raw = await vscode.window.showInputBox({
			prompt: vscode.l10n.t('Enter your {0} API key', this.displayName),
			password: true,
			ignoreFocusOut: true,
		});
		const key = raw?.trim();
		if (!key) {
			throw new Error(vscode.l10n.t('API key is required'));
		}
		this.logger.logSessionChange('created', 'Creating session via Accounts menu');
		return this.storeKey(randomUUID(), this.displayName, key);
	}

	/**
	 * Store an API key and fire a session-added event.
	 */
	async storeKey(
		accountId: string,
		label: string,
		key: string
	): Promise<vscode.AuthenticationSession> {
		await this.context.secrets.store(this.secretKey(accountId), key);

		const accounts = this.getStoredAccounts();
		const existing = accounts.findIndex(a => a.id === accountId);
		if (existing >= 0) {
			accounts[existing] = { id: accountId, label };
		} else {
			accounts.push({ id: accountId, label });
		}
		await this.setStoredAccounts(accounts);

		const session: vscode.AuthenticationSession = {
			id: accountId,
			accessToken: key,
			account: { id: accountId, label },
			scopes: [],
		};
		this._onDidChangeSessions.fire({
			added: [session], removed: [], changed: [],
		});
		this.logger.logSessionChange('stored', `Stored key for account "${label}"`);
		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		if (this._chainSession?.id === sessionId) {
			// If the chain can still resolve, re-resolve immediately
			// instead of leaving an inconsistent state where the
			// session is gone but registered models still work.
			if (this.credentialChain?.preventSignOut) {
				try {
					const token = await this.credentialChain.resolve();
					if (token) {
						this.logger.info(
							'Chain session removal blocked -- ' +
							'credentials still available from environment'
						);
						vscode.window.showInformationMessage(
							vscode.l10n.t(
								'{0} credentials are configured via ' +
								'environment variable and cannot be ' +
								'signed out.',
								this.displayName
							)
						);
						return;
					}
				} catch {
					// Chain can no longer resolve; allow removal.
				}
			}

			this.stopRefreshTimer();
			const removed = this._chainSession;
			this._chainSession = undefined;
			this._onDidChangeSessions.fire({
				added: [], removed: [removed], changed: [],
			});
			this.logger.logSessionChange('removed', 'Chain session removed');
			return;
		}

		const accounts = this.getStoredAccounts();
		const account = accounts.find(a => a.id === sessionId);
		if (!account) {
			this.logger.warn(`removeSession: no account found for ${sessionId}`);
			return;
		}

		await this.context.secrets.delete(this.secretKey(sessionId));
		await this.setStoredAccounts(accounts.filter(a => a.id !== sessionId));

		this._onDidChangeSessions.fire({
			added: [],
			removed: [{
				id: sessionId,
				accessToken: '',
				account: { id: account.id, label: account.label },
				scopes: [],
			}],
			changed: [],
		});
		this.logger.logSessionChange('removed', `Removed session for account "${account.label}" (${sessionId})`);
	}

	/**
	 * Resolve credentials from the chain, update cache, and
	 * start the background refresh timer.
	 */
	async resolveChainCredentials(
	): Promise<vscode.AuthenticationSession | undefined> {
		if (!this.credentialChain) {
			return undefined;
		}

		try {
			const accessToken = await this.credentialChain.resolve();
			if (this._disposed) {
				return undefined;
			}
			const session: vscode.AuthenticationSession = {
				id: this.providerId,
				accessToken,
				account: {
					id: this.providerId,
					label: this.displayName,
				},
				scopes: [],
			};

			const hadSession = !!this._chainSession;
			this._chainSession = session;
			this.startRefreshTimer();

			if (!hadSession) {
				this._onDidChangeSessions.fire({
					added: [session], removed: [], changed: [],
				});
				this.logger.logCredentialResolution('resolved');
			}

			return session;
		} catch (err) {
			this.logger.logCredentialResolution('failed', `${err instanceof Error ? err.message : String(err)}`);

			if (this._chainSession) {
				const removed = this._chainSession;
				this._chainSession = undefined;
				this._onDidChangeSessions.fire({
					added: [], removed: [removed], changed: [],
				});
				this.logger.logCredentialResolution('invalidated', 'Cached session invalidated');
			}
			return undefined;
		}
	}

	private startRefreshTimer(): void {
		const interval = this.credentialChain?.refreshIntervalMs;
		if (!interval || this._refreshTimer) {
			return;
		}
		this._refreshTimer = setInterval(
			() => this.resolveChainCredentials(),
			interval
		);
	}

	private stopRefreshTimer(): void {
		if (this._refreshTimer) {
			clearInterval(this._refreshTimer);
			this._refreshTimer = undefined;
		}
	}

	private async getManagedSession(
	): Promise<vscode.AuthenticationSession | undefined> {
		if (!this.workbench!.isAvailable()) {
			return undefined;
		}

		try {
			const session = await vscode.authentication.getSession(
				this.workbench!.authProviderId,
				this.workbench!.scopes,
				{ silent: true }
			);
			if (session) {
				this.logger.logCredentialResolution('resolved', 'Using Workbench-managed credentials');
			}
			return session ?? undefined;
		} catch (err) {
			this.logger.logCredentialResolution('failed', `Failed to get Workbench session: ${err instanceof Error ? err.message : String(err)}`);
			return undefined;
		}
	}
}

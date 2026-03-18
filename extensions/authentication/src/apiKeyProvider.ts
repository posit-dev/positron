/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { IS_RUNNING_ON_PWB } from './constants';
import { log } from './log';

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
 * Generic AuthenticationProvider for API-key-based services.
 * Each provider instance manages keys for a single LLM provider (e.g. Anthropic, OpenAI).
 * Stores API keys in `context.secrets` with pattern `apiKey-{providerId}-{accountId}`.
 * The account registry lives in `context.globalState`.
 */
export class ApiKeyAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {

	private readonly _onDidChangeSessions =
		new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	constructor(
		private readonly providerId: string,
		private readonly displayName: string,
		private readonly context: vscode.ExtensionContext,
		private readonly workbench?: WorkbenchCredentialConfig,
	) { }

	dispose(): void {
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
		// Workbench-managed credentials take priority when available.
		if (this.workbench) {
			const managed = await this.getManagedSession();
			if (managed) {
				log.debug(`[${this.displayName}] getSessions: returned Workbench-managed session`);
				return [managed];
			}
		}

		// Fall back to stored API keys.
		const accounts = this.getStoredAccounts();
		const filtered = options?.account
			? accounts.filter(a => a.id === options.account!.id)
			: accounts;

		const sessions: vscode.AuthenticationSession[] = [];
		for (const account of filtered) {
			const key = await this.context.secrets.get(this.secretKey(account.id));
			if (key) {
				sessions.push({
					id: account.id,
					accessToken: key,
					account: { id: account.id, label: account.label },
					scopes: [],
				});
			}
		}
		if (sessions.length > 0) {
			log.debug(`[${this.displayName}] getSessions: returned ${sessions.length} stored session(s)`);
			return sessions;
		}

		log.debug(`[${this.displayName}] getSessions: no sessions available`);
		return [];
	}

	/**
	 * Accounts menu entry point: prompts user for an API key via input box.
	 */
	async createSession(
		_scopes: readonly string[],
		_options?: vscode.AuthenticationProviderSessionOptions
	): Promise<vscode.AuthenticationSession> {
		const raw = await vscode.window.showInputBox({
			prompt: vscode.l10n.t('Enter your {0} API key', this.displayName),
			password: true,
			ignoreFocusOut: true,
		});
		const key = raw?.trim();
		if (!key) {
			throw new Error(vscode.l10n.t('API key is required'));
		}
		log.info(`[${this.displayName}] Creating session via Accounts menu`);
		return this.storeKey(randomUUID(), this.displayName, key);
	}

	/**
	 * Store an API key and fire a session-added event.
	 * Called internally by the config dialog onAction('save') handler.
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
		log.info(`[${this.displayName}] Stored key for account "${label}"`);
		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		const accounts = this.getStoredAccounts();
		const account = accounts.find(a => a.id === sessionId);
		if (!account) {
			log.warn(`[${this.displayName}] removeSession: no account found for ${sessionId}`);
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
		log.info(`[${this.displayName}] Removed session for account "${account.label}" (${sessionId})`);
	}

	private async getManagedSession(): Promise<vscode.AuthenticationSession | undefined> {
		if (!IS_RUNNING_ON_PWB || !this.workbench!.isAvailable()) {
			return undefined;
		}

		try {
			const session = await vscode.authentication.getSession(
				this.workbench!.authProviderId,
				this.workbench!.scopes,
				{ silent: true }
			);
			if (session) {
				log.debug(`[${this.displayName}] Using Workbench-managed credentials`);
			}
			return session ?? undefined;
		} catch (err) {
			log.warn(
				`[${this.displayName}] Failed to get Workbench session: ` +
				`${err instanceof Error ? err.message : String(err)}`
			);
			return undefined;
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { log } from './log';

interface StoredAccount {
	readonly id: string;
	readonly label: string;
}

/**
 * Generic AuthenticationProvider for API-key-based services.
 * Each provider instance manages keys for a single LLM provider (e.g. Anthropic, OpenAI).
 * Keys are stored in `context.secrets` with pattern `apiKey-{providerId}-{accountId}`.
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
		log.debug(`[${this.providerId}] getSessions: returned ${sessions.length} session(s)`);
		return sessions;
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
		log.info(`[${this.providerId}] Creating session via Accounts menu`);
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
		log.info(`[${this.providerId}] Stored key for account "${label}" (${accountId})`);
		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		const accounts = this.getStoredAccounts();
		const account = accounts.find(a => a.id === sessionId);
		if (!account) {
			log.warn(`[${this.providerId}] removeSession: no account found for ${sessionId}`);
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
		log.info(`[${this.providerId}] Removed session for account "${account.label}" (${sessionId})`);
	}
}

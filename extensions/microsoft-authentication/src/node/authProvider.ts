/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { AccountInfo, AuthenticationResult, ClientAuthError, ClientAuthErrorCodes, ServerError } from '@azure/msal-node';
import { AuthenticationGetSessionOptions, AuthenticationProvider, AuthenticationProviderAuthenticationSessionsChangeEvent, AuthenticationProviderSessionOptions, AuthenticationSession, AuthenticationSessionAccountInformation, CancellationError, EventEmitter, ExtensionContext, ExtensionKind, l10n, LogOutputChannel, window } from 'vscode';
import { Environment } from '@azure/ms-rest-azure-env';
import { CachedPublicClientApplicationManager } from './publicClientCache';
import { UriEventHandler } from '../UriEventHandler';
import { ICachedPublicClientApplication } from '../common/publicClientCache';
import { MicrosoftAccountType, MicrosoftAuthenticationTelemetryReporter } from '../common/telemetryReporter';
import { ScopeData } from '../common/scopeData';
import { EventBufferer } from '../common/event';
import { BetterTokenStorage } from '../betterSecretStorage';
import { IStoredSession } from '../AADHelper';
import { ExtensionHost, getMsalFlows } from './flows';

const redirectUri = 'https://vscode.dev/redirect';
const MSA_TID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const MSA_PASSTHRU_TID = 'f8cdef31-a31e-4b4a-93e4-5f571e91255a';

export class MsalAuthProvider implements AuthenticationProvider {

	private readonly _disposables: { dispose(): void }[];
	private readonly _publicClientManager: CachedPublicClientApplicationManager;
	private readonly _eventBufferer = new EventBufferer();

	/**
	 * Event to signal a change in authentication sessions for this provider.
	 */
	private readonly _onDidChangeSessionsEmitter = new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();

	/**
	 * Event to signal a change in authentication sessions for this provider.
	 *
	 * NOTE: This event is handled differently in the Microsoft auth provider than "typical" auth providers. Normally,
	 * this event would fire when the provider's sessions change... which are tied to a specific list of scopes. However,
	 * since Microsoft identity doesn't care too much about scopes (you can mint a new token from an existing token),
	 * we just fire this event whenever the account list changes... so essentially there is one session per account.
	 *
	 * This is not quite how the API should be used... but this event really is just for signaling that the account list
	 * has changed.
	 */
	onDidChangeSessions = this._onDidChangeSessionsEmitter.event;

	constructor(
		private readonly _context: ExtensionContext,
		private readonly _telemetryReporter: MicrosoftAuthenticationTelemetryReporter,
		private readonly _logger: LogOutputChannel,
		private readonly _uriHandler: UriEventHandler,
		private readonly _env: Environment = Environment.AzureCloud
	) {
		this._disposables = _context.subscriptions;
		this._publicClientManager = new CachedPublicClientApplicationManager(
			_context.globalState,
			_context.secrets,
			this._logger,
			this._env.name
		);
		const accountChangeEvent = this._eventBufferer.wrapEvent(
			this._publicClientManager.onDidAccountsChange,
			(last, newEvent) => {
				if (!last) {
					return newEvent;
				}
				const mergedEvent = {
					added: [...(last.added ?? []), ...(newEvent.added ?? [])],
					deleted: [...(last.deleted ?? []), ...(newEvent.deleted ?? [])],
					changed: [...(last.changed ?? []), ...(newEvent.changed ?? [])]
				};

				const dedupedEvent = {
					added: Array.from(new Map(mergedEvent.added.map(item => [item.username, item])).values()),
					deleted: Array.from(new Map(mergedEvent.deleted.map(item => [item.username, item])).values()),
					changed: Array.from(new Map(mergedEvent.changed.map(item => [item.username, item])).values())
				};

				return dedupedEvent;
			},
			{ added: new Array<AccountInfo>(), deleted: new Array<AccountInfo>(), changed: new Array<AccountInfo>() }
		)(e => this._handleAccountChange(e));
		this._disposables.push(
			this._onDidChangeSessionsEmitter,
			this._publicClientManager,
			accountChangeEvent
		);
	}

	/**
	 * Migrate sessions from the old secret storage to MSAL.
	 * TODO: MSAL Migration. Remove this when we remove the old flow.
	 */
	private async _migrateSessions() {
		const betterSecretStorage = new BetterTokenStorage<IStoredSession>('microsoft.login.keylist', this._context);
		const sessions = await betterSecretStorage.getAll(item => {
			item.endpoint ||= Environment.AzureCloud.activeDirectoryEndpointUrl;
			return item.endpoint === this._env.activeDirectoryEndpointUrl;
		});
		this._context.globalState.update('msalMigration', true);

		const clientTenantMap = new Map<string, { clientId: string; tenant: string; refreshTokens: string[] }>();

		for (const session of sessions) {
			const scopeData = new ScopeData(session.scope.split(' '));
			const key = `${scopeData.clientId}:${scopeData.tenant}`;
			if (!clientTenantMap.has(key)) {
				clientTenantMap.set(key, { clientId: scopeData.clientId, tenant: scopeData.tenant, refreshTokens: [] });
			}
			clientTenantMap.get(key)!.refreshTokens.push(session.refreshToken);
		}

		for (const { clientId, tenant, refreshTokens } of clientTenantMap.values()) {
			await this.getOrCreatePublicClientApplication(clientId, tenant, refreshTokens);
		}
	}

	async initialize(): Promise<void> {
		await this._eventBufferer.bufferEventsAsync(() => this._publicClientManager.initialize());

		if (!this._context.globalState.get('msalMigration', false)) {
			await this._migrateSessions();
		}

		// Send telemetry for existing accounts
		for (const cachedPca of this._publicClientManager.getAll()) {
			for (const account of cachedPca.accounts) {
				if (!account.idTokenClaims?.tid) {
					continue;
				}
				const tid = account.idTokenClaims.tid;
				const type = tid === MSA_TID || tid === MSA_PASSTHRU_TID ? MicrosoftAccountType.MSA : MicrosoftAccountType.AAD;
				this._telemetryReporter.sendAccountEvent([], type);
			}
		}
	}

	/**
	 * See {@link onDidChangeSessions} for more information on how this is used.
	 * @param param0 Event that contains the added and removed accounts
	 */
	private _handleAccountChange({ added, changed, deleted }: { added: AccountInfo[]; changed: AccountInfo[]; deleted: AccountInfo[] }) {
		this._logger.debug(`[_handleAccountChange] added: ${added.length}, changed: ${changed.length}, deleted: ${deleted.length}`);
		this._onDidChangeSessionsEmitter.fire({
			added: added.map(this.sessionFromAccountInfo),
			changed: changed.map(this.sessionFromAccountInfo),
			removed: deleted.map(this.sessionFromAccountInfo)
		});
	}

	//#region AuthenticationProvider methods

	async getSessions(scopes: string[] | undefined, options?: AuthenticationGetSessionOptions): Promise<AuthenticationSession[]> {
		const askingForAll = scopes === undefined;
		const scopeData = new ScopeData(scopes);
		// Do NOT use `scopes` beyond this place in the code. Use `scopeData` instead.
		this._logger.info('[getSessions]', askingForAll ? '[all]' : `[${scopeData.scopeStr}]`, 'starting');

		// This branch only gets called by Core for sign out purposes and initial population of the account menu. Since we are
		// living in a world where a "session" from Core's perspective is an account, we return 1 session per account.
		// See the large comment on `onDidChangeSessions` for more information.
		if (askingForAll) {
			const allSessionsForAccounts = new Map<string, AuthenticationSession>();
			for (const cachedPca of this._publicClientManager.getAll()) {
				for (const account of cachedPca.accounts) {
					if (allSessionsForAccounts.has(account.homeAccountId)) {
						continue;
					}
					allSessionsForAccounts.set(account.homeAccountId, this.sessionFromAccountInfo(account));
				}
			}
			const allSessions = Array.from(allSessionsForAccounts.values());
			this._logger.info('[getSessions] [all]', `returned ${allSessions.length} session(s)`);
			return allSessions;
		}

		const cachedPca = await this.getOrCreatePublicClientApplication(scopeData.clientId, scopeData.tenant);
		const sessions = await this.getAllSessionsForPca(cachedPca, scopeData.originalScopes, scopeData.scopesToSend, options?.account);
		this._logger.info(`[getSessions] [${scopeData.scopeStr}] returned ${sessions.length} session(s)`);
		return sessions;

	}

	async createSession(scopes: readonly string[], options: AuthenticationProviderSessionOptions): Promise<AuthenticationSession> {
		const scopeData = new ScopeData(scopes);
		// Do NOT use `scopes` beyond this place in the code. Use `scopeData` instead.

		this._logger.info('[createSession]', `[${scopeData.scopeStr}]`, 'starting');
		const cachedPca = await this.getOrCreatePublicClientApplication(scopeData.clientId, scopeData.tenant);

		// Used for showing a friendlier message to the user when the explicitly cancel a flow.
		let userCancelled: boolean | undefined;
		const yes = l10n.t('Yes');
		const no = l10n.t('No');
		const promptToContinue = async (mode: string) => {
			if (userCancelled === undefined) {
				// We haven't had a failure yet so wait to prompt
				return;
			}
			const message = userCancelled
				? l10n.t('Having trouble logging in? Would you like to try a different way? ({0})', mode)
				: l10n.t('You have not yet finished authorizing this extension to use your Microsoft Account. Would you like to try a different way? ({0})', mode);
			const result = await window.showWarningMessage(message, yes, no);
			if (result !== yes) {
				throw new CancellationError();
			}
		};

		const flows = getMsalFlows({
			extensionHost: typeof navigator === 'undefined'
				? this._context.extension.extensionKind === ExtensionKind.UI ? ExtensionHost.Local : ExtensionHost.Remote
				: ExtensionHost.WebWorker,
		});

		let lastError: Error | undefined;
		for (const flow of flows) {
			if (flow !== flows[0]) {
				try {
					await promptToContinue(flow.label);
				} finally {
					this._telemetryReporter.sendLoginFailedEvent();
				}
			}
			try {
				const result = await flow.trigger({
					cachedPca,
					scopes: scopeData.scopesToSend,
					loginHint: options.account?.label,
					windowHandle: window.nativeHandle ? Buffer.from(window.nativeHandle) : undefined,
					logger: this._logger,
					uriHandler: this._uriHandler
				});

				const session = this.sessionFromAuthenticationResult(result, scopeData.originalScopes);
				this._telemetryReporter.sendLoginEvent(session.scopes);
				this._logger.info('[createSession]', `[${scopeData.scopeStr}]`, 'returned session');
				return session;
			} catch (e) {
				lastError = e;
				if (e instanceof ServerError || (e as ClientAuthError)?.errorCode === ClientAuthErrorCodes.userCanceled) {
					this._telemetryReporter.sendLoginFailedEvent();
					throw e;
				}
				// Continue to next flow
				if (e instanceof CancellationError) {
					userCancelled = true;
				}
			}
		}

		this._telemetryReporter.sendLoginFailedEvent();
		throw lastError ?? new Error('No auth flow succeeded');
	}

	async removeSession(sessionId: string): Promise<void> {
		this._logger.info('[removeSession]', sessionId, 'starting');
		const promises = new Array<Promise<void>>();
		for (const cachedPca of this._publicClientManager.getAll()) {
			const accounts = cachedPca.accounts;
			for (const account of accounts) {
				if (account.homeAccountId === sessionId) {
					this._telemetryReporter.sendLogoutEvent();
					promises.push(cachedPca.removeAccount(account));
					this._logger.info(`[removeSession] [${sessionId}] [${cachedPca.clientId}] [${cachedPca.authority}] removing session...`);
				}
			}
		}
		if (!promises.length) {
			this._logger.info('[removeSession]', sessionId, 'session not found');
			return;
		}
		const results = await Promise.allSettled(promises);
		for (const result of results) {
			if (result.status === 'rejected') {
				this._telemetryReporter.sendLogoutFailedEvent();
				this._logger.error('[removeSession]', sessionId, 'error removing session', result.reason);
			}
		}

		this._logger.info('[removeSession]', sessionId, `attempted to remove ${promises.length} sessions`);
	}

	//#endregion

	private async getOrCreatePublicClientApplication(clientId: string, tenant: string, refreshTokensToMigrate?: string[]): Promise<ICachedPublicClientApplication> {
		const authority = new URL(tenant, this._env.activeDirectoryEndpointUrl).toString();
		return await this._publicClientManager.getOrCreate(clientId, authority, refreshTokensToMigrate);
	}

	private async getAllSessionsForPca(
		cachedPca: ICachedPublicClientApplication,
		originalScopes: readonly string[],
		scopesToSend: string[],
		accountFilter?: AuthenticationSessionAccountInformation
	): Promise<AuthenticationSession[]> {
		const accounts = accountFilter
			? cachedPca.accounts.filter(a => a.homeAccountId === accountFilter.id)
			: cachedPca.accounts;
		const sessions: AuthenticationSession[] = [];
		return this._eventBufferer.bufferEventsAsync(async () => {
			for (const account of accounts) {
				try {
					const result = await cachedPca.acquireTokenSilent({ account, scopes: scopesToSend, redirectUri });
					sessions.push(this.sessionFromAuthenticationResult(result, originalScopes));
				} catch (e) {
					// If we can't get a token silently, the account is probably in a bad state so we should skip it
					// MSAL will log this already, so we don't need to log it again
					continue;
				}
			}
			return sessions;
		});
	}

	private sessionFromAuthenticationResult(result: AuthenticationResult, scopes: readonly string[]): AuthenticationSession & { idToken: string } {
		return {
			accessToken: result.accessToken,
			idToken: result.idToken,
			id: result.account?.homeAccountId ?? result.uniqueId,
			account: {
				id: result.account?.homeAccountId ?? result.uniqueId,
				label: result.account?.username ?? 'Unknown',
			},
			scopes
		};
	}

	private sessionFromAccountInfo(account: AccountInfo): AuthenticationSession {
		return {
			accessToken: '1234',
			id: account.homeAccountId,
			scopes: [],
			account: {
				id: account.homeAccountId,
				label: account.username
			},
			idToken: account.idToken,
		};
	}
}

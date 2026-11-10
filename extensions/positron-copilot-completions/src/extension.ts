/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as vscode from 'vscode';
import { Command } from 'vscode-languageclient/node';
import {
	CONFIG_DIRECTORY_KEY,
	findGitHubSession,
	getConfigDirectory,
	getSignInMethod,
	isGitHubProvider,
	SIGN_IN_METHOD_KEY,
	signInToGitHub,
	signInWithDeviceFlow,
} from './auth.js';
import { AuthStatus, COPILOT_DOCUMENT_SELECTOR, CopilotLanguageClient, CopilotQuota, CopilotServerAuth, DidChangeStatusParams, StatusKind } from './client.js';
import { AIExclusions, CopilotSuggestionsGate } from './gate.js';
import { CopilotInlineCompletionProvider } from './provider.js';
import { createStatusTooltip, mergeQuota } from './quota.js';

/** Internal: runs a command from the server's `didChangeStatus` on the server. */
const RUN_SERVER_COMMAND = 'copilotCompletions.runServerCommand';

/**
 * How long a fetched quota stays fresh. Refocusing the window after this
 * fetches it again, since the server pushes quota changes only on token
 * refresh and after chat requests, not after completions.
 */
const QUOTA_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Starts the Copilot language server only while suggestions are allowed.
 *
 * With the `accounts` sign-in method the server needs a GitHub session from
 * the Accounts menu, and restarts when the session changes. With
 * `languageServer` it runs signed out until the user completes the server's
 * device flow.
 */
class CopilotCompletionsController implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];
	private readonly _gate: CopilotSuggestionsGate;
	private readonly _exclusions = new AIExclusions();
	private readonly _statusItem: vscode.StatusBarItem;

	/** The running client; set only once it has started successfully. */
	private _client: CopilotLanguageClient | undefined;
	/**
	 * Identifies the auth the running client was started with (sign-in
	 * method plus session and token, or config directory); a change means a
	 * restart.
	 */
	private _authKey: string | undefined;
	/**
	 * Set while the user has to sign in before suggestions work (no Accounts
	 * session, or the language server reports it is signed out): the message
	 * the status bar shows, linked to the sign-in command. Server status
	 * updates don't replace it; only a new auth status does.
	 */
	private _signInPrompt: string | undefined;
	/** The last server status shown, kept to redraw the status bar when the quota changes. */
	private _status: DidChangeStatusParams | undefined;
	/** The signed-in user's plan and quotas, once known. */
	private _quota: CopilotQuota | undefined;
	/** When the quota was last fetched, in ms since the epoch. */
	private _quotaFetchedAt = 0;
	/** Serializes start/stop so overlapping events can't race. */
	private _updating = Promise.resolve();
	/** Set once shutting down; no update may start a server after this. */
	private _disposed = false;

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _log: vscode.LogOutputChannel,
	) {
		this._gate = new CopilotSuggestionsGate(_log);
		this._statusItem = vscode.window.createStatusBarItem('copilotCompletions.status', vscode.StatusBarAlignment.Right, 100);
		this._statusItem.name = vscode.l10n.t('GitHub Copilot Completions');
		this._disposables.push(this._gate, this._exclusions, this._statusItem);

		this._disposables.push(
			this._gate.onDidChange(() => this.update()),
			vscode.authentication.onDidChangeSessions(e => {
				if (isGitHubProvider(e.provider.id)) {
					this.update();
				}
			}),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(SIGN_IN_METHOD_KEY) || e.affectsConfiguration(CONFIG_DIRECTORY_KEY)) {
					this.update();
				}
			}),
			vscode.commands.registerCommand('copilotCompletions.signIn', () => this.signIn()),
			vscode.commands.registerCommand('copilotCompletions.signOut', () => this.signOut()),
			vscode.commands.registerCommand('copilotCompletions.restart', () => this.update(true)),
			vscode.commands.registerCommand('copilotCompletions.showLog', () => this._log.show()),
			vscode.commands.registerCommand(RUN_SERVER_COMMAND, (command: Command) => this.runServerCommand(command)),
			vscode.window.onDidChangeWindowState(state => {
				if (state.focused && Date.now() - this._quotaFetchedAt > QUOTA_REFRESH_INTERVAL_MS) {
					void this.refreshQuota();
				}
			}),
		);

		const provider = new CopilotInlineCompletionProvider(() => this._client, this._gate, this._exclusions, this._log);
		this._disposables.push(
			provider,
			vscode.languages.registerInlineCompletionItemProvider(
				COPILOT_DOCUMENT_SELECTOR,
				provider,
				{ displayName: vscode.l10n.t('GitHub Copilot Completions') },
			),
		);
	}

	/** Reconcile the running server with the gate and the configured auth. */
	update(forceRestart = false): Promise<void> {
		if (this._disposed) {
			return this._updating;
		}
		this._updating = this._updating.then(() => this.doUpdate(forceRestart)).catch(err => {
			this._log.error(`Failed to update the Copilot language server: ${err}`);
			this.showStatus({ busy: false, kind: StatusKind.Error, message: vscode.l10n.t('GitHub Copilot Completions failed to start. Select to show the log.') });
		});
		return this._updating;
	}

	/**
	 * Stop the server for good. Waits for an in-flight update first, so a
	 * server it is starting is stopped too rather than left running.
	 */
	shutdown(): Promise<void> {
		if (!this._disposed) {
			this._disposed = true;
			this._updating = this._updating.then(() => this.stop());
		}
		return this._updating;
	}

	private async signIn(): Promise<void> {
		if (getSignInMethod() === 'accounts') {
			await signInToGitHub();
			await this.update();
			return;
		}

		await this.update();
		const client = this._client;
		if (!client) {
			vscode.window.showWarningMessage(vscode.l10n.t('GitHub Copilot Completions is turned off, so there is nothing to sign in to.'));
			return;
		}
		try {
			const status = await signInWithDeviceFlow(client, this._log);
			if (status) {
				this.applyAuthStatus(status);
			}
		} catch (err) {
			this._log.error(`Device flow sign-in failed: ${err}`);
			vscode.window.showErrorMessage(vscode.l10n.t('GitHub Copilot Completions sign-in failed: {0}', String(err)));
		}
	}

	private async signOut(): Promise<void> {
		if (getSignInMethod() === 'accounts') {
			vscode.window.showInformationMessage(vscode.l10n.t('GitHub Copilot Completions uses your GitHub account from the Accounts menu. Sign out of GitHub there.'));
			return;
		}

		await this.update();
		const client = this._client;
		if (!client) {
			return;
		}
		const status = await client.signOut();
		this._log.info(`Signed out of the language server: ${JSON.stringify(status)}`);
		this.applyAuthStatus(status);
	}

	private async runServerCommand(command: Command): Promise<void> {
		const client = this._client;
		if (!client) {
			return;
		}
		try {
			await client.executeCommand(command);
		} catch (err) {
			this._log.error(`Server command ${command.command} failed: ${err}`);
		}
	}

	/** Fetch the quota for the status bar tooltip, if signed in. */
	private async refreshQuota(): Promise<void> {
		const client = this._client;
		if (!client || this._signInPrompt) {
			return;
		}
		this._quotaFetchedAt = Date.now();
		try {
			const quota = await client.checkQuota();
			if (this._client === client) {
				this._quota = quota;
				this.renderStatus();
			}
		} catch (err) {
			this._log.warn(`Failed to fetch the Copilot quota: ${err}`);
		}
	}

	private async doUpdate(forceRestart: boolean): Promise<void> {
		if (this._disposed) {
			return;
		}
		if (!this._gate.allowed) {
			this._log.info('Copilot suggestions are not allowed (ai.enabled off or Copilot provider disabled).');
			await this.stop();
			this._statusItem.hide();
			return;
		}

		let auth: CopilotServerAuth;
		let authKey: string;
		if (getSignInMethod() === 'accounts') {
			const session = await findGitHubSession();
			if (!session) {
				this._log.info('No GitHub session from the Accounts menu; Copilot suggestions are off.');
				await this.stop();
				this.promptSignIn(vscode.l10n.t('Sign in to GitHub to use GitHub Copilot Completions'));
				return;
			}
			auth = { kind: 'accounts', credentials: { token: session.accessToken, user: session.account.label } };
			// A refreshed token can keep the session id, and the server reads
			// the token only at startup, so the token itself is part of the
			// key. Hash it so the raw token isn't kept around twice.
			const tokenHash = createHash('sha256').update(session.accessToken).digest('hex');
			authKey = `accounts:${session.id}:${tokenHash}`;
		} else {
			const configDirectory = getConfigDirectory(this._log);
			auth = { kind: 'languageServer', configDirectory };
			authKey = `languageServer:${configDirectory ?? ''}`;
		}

		if (this._client && this._authKey === authKey && !forceRestart) {
			return;
		}

		await this.stop();
		this._log.info(auth.kind === 'accounts'
			? `Starting the Copilot language server as GitHub user ${auth.credentials.user}.`
			: `Starting the Copilot language server with its own sign-in (config directory: ${auth.configDirectory ?? 'default'}).`);
		const client = new CopilotLanguageClient(this._context, auth, this._exclusions, this._log);
		client.onDidChangeStatus(status => {
			if (this._client === client) {
				this.showStatus(status);
			}
		});
		client.onDidChangeQuota(quota => {
			if (this._client === client) {
				this._quota = mergeQuota(this._quota, quota);
				this.renderStatus();
			}
		});
		const started = Date.now();
		let authStatus: AuthStatus | undefined;
		try {
			await client.start();
			if (auth.kind === 'languageServer') {
				authStatus = await client.checkStatus();
			}
		} catch (err) {
			// Leave _client and _authKey unset so the next update retries.
			await CopilotCompletionsController.stopClient(client);
			throw err;
		}
		this._log.info(`Copilot language server started in ${Date.now() - started}ms.`);
		this._client = client;
		this._authKey = authKey;
		if (auth.kind === 'accounts') {
			this.showStatus({ busy: false, kind: StatusKind.Normal, message: vscode.l10n.t('GitHub Copilot Completions: signed in as {0}', auth.credentials.user) });
			void this.refreshQuota();
		} else if (authStatus) {
			this.applyAuthStatus(authStatus);
		}
	}

	/** Reflect the language server's own sign-in state in the status bar. */
	private applyAuthStatus(status: AuthStatus): void {
		this._log.info(`Language server auth status: ${JSON.stringify(status)}`);
		if (status.status === 'OK') {
			this._signInPrompt = undefined;
			this.showStatus({ busy: false, kind: StatusKind.Normal, message: vscode.l10n.t('GitHub Copilot Completions: signed in as {0}', status.user ?? '') });
			void this.refreshQuota();
			return;
		}
		this._quota = undefined;
		if (status.status === 'NotAuthorized') {
			this.promptSignIn(vscode.l10n.t('GitHub account {0} does not have access to GitHub Copilot', status.user ?? ''));
		} else {
			this.promptSignIn(vscode.l10n.t('Sign in to GitHub to use GitHub Copilot Completions'));
		}
	}

	private promptSignIn(message: string): void {
		this._signInPrompt = message;
		this.showStatus({ busy: false, kind: StatusKind.Error });
	}

	private async stop(): Promise<void> {
		const client = this._client;
		this._client = undefined;
		this._authKey = undefined;
		this._signInPrompt = undefined;
		this._status = undefined;
		this._quota = undefined;
		if (client) {
			await CopilotCompletionsController.stopClient(client);
		}
	}

	private static async stopClient(client: CopilotLanguageClient): Promise<void> {
		await client.client.stop().catch(() => undefined);
		client.dispose();
	}

	private showStatus(status: DidChangeStatusParams): void {
		this._status = status;
		this.renderStatus();
	}

	private renderStatus(): void {
		const status = this._status;
		if (!status) {
			return;
		}
		if (this._signInPrompt) {
			// Server updates may still show progress, but must not hide the
			// way to sign in.
			this._statusItem.text = status.busy ? '$(loading~spin)' : '$(copilot-warning)';
			this._statusItem.tooltip = this._signInPrompt;
			this._statusItem.command = 'copilotCompletions.signIn';
		} else {
			this._statusItem.text = status.busy ? '$(loading~spin)' : status.kind === StatusKind.Normal ? '$(copilot-dot)' : '$(copilot-warning)';
			this._statusItem.tooltip = createStatusTooltip(status.message || vscode.l10n.t('GitHub Copilot Completions'), this._quota);
			// Prefer the server's own action (e.g. "Learn More" on a quota error).
			this._statusItem.command = status.command
				? { command: RUN_SERVER_COMMAND, title: status.command.title, arguments: [status.command] }
				: 'copilotCompletions.showLog';
		}
		this._statusItem.show();
	}

	dispose(): void {
		void this.shutdown();
		this._disposables.forEach(d => d.dispose());
	}
}

let controller: CopilotCompletionsController | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('GitHub Copilot Completions', { log: true });
	controller = new CopilotCompletionsController(context, log);
	context.subscriptions.push(log, controller);
	void controller.update();
}

export function deactivate(): Promise<void> | undefined {
	// Return the stop so the extension host waits for the server to exit.
	return controller?.shutdown();
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
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
import { AuthStatus, CopilotLanguageClient, CopilotServerAuth, DidChangeStatusParams, StatusKind } from './client.js';
import { CopilotSuggestionsGate } from './gate.js';
import { CopilotInlineCompletionProvider } from './provider.js';

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
	private readonly _statusItem: vscode.StatusBarItem;

	private _client: CopilotLanguageClient | undefined;
	/**
	 * Identifies the auth the running client was started with (sign-in
	 * method plus session id or config directory); a change means a restart.
	 */
	private _authKey: string | undefined;
	/** Whether the running client still needs the user to sign in. */
	private _needsSignIn = false;
	/** Serializes start/stop so overlapping events can't race. */
	private _updating = Promise.resolve();

	constructor(
		private readonly _context: vscode.ExtensionContext,
		private readonly _log: vscode.LogOutputChannel,
	) {
		this._gate = new CopilotSuggestionsGate(_log);
		this._statusItem = vscode.window.createStatusBarItem('copilotCompletions.status', vscode.StatusBarAlignment.Right, 100);
		this._statusItem.name = vscode.l10n.t('GitHub Copilot Completions');
		this._disposables.push(this._gate, this._statusItem);

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
		);

		const provider = new CopilotInlineCompletionProvider(() => this._client, this._gate, this._log);
		this._disposables.push(
			provider,
			vscode.languages.registerInlineCompletionItemProvider(
				{ pattern: '**' },
				provider,
				{ displayName: vscode.l10n.t('GitHub Copilot') },
			),
		);
	}

	/** Reconcile the running server with the gate and the configured auth. */
	update(forceRestart = false): Promise<void> {
		this._updating = this._updating.then(() => this.doUpdate(forceRestart)).catch(err => {
			this._log.error(`Failed to update the Copilot language server: ${err}`);
		});
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
			vscode.window.showWarningMessage(vscode.l10n.t('GitHub Copilot suggestions are turned off, so there is nothing to sign in to.'));
			return;
		}
		try {
			const status = await signInWithDeviceFlow(client, this._log);
			if (status) {
				this.applyAuthStatus(status);
			}
		} catch (err) {
			this._log.error(`Device flow sign-in failed: ${err}`);
			vscode.window.showErrorMessage(vscode.l10n.t('GitHub Copilot sign-in failed: {0}', String(err)));
		}
	}

	private async signOut(): Promise<void> {
		if (getSignInMethod() === 'accounts') {
			vscode.window.showInformationMessage(vscode.l10n.t('GitHub Copilot uses your GitHub account from the Accounts menu. Sign out of GitHub there.'));
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

	private async doUpdate(forceRestart: boolean): Promise<void> {
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
				this.showStatus({ busy: false, kind: StatusKind.Error, message: vscode.l10n.t('Sign in to GitHub to use Copilot') });
				return;
			}
			auth = { kind: 'accounts', credentials: { token: session.accessToken, user: session.account.label } };
			authKey = `accounts:${session.id}`;
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
		const client = new CopilotLanguageClient(this._context, auth, this._log);
		client.onDidChangeStatus(status => this.showStatus(status));
		this._client = client;
		this._authKey = authKey;
		const started = Date.now();
		await client.start();
		this._log.info(`Copilot language server started in ${Date.now() - started}ms.`);

		if (auth.kind === 'languageServer') {
			this.applyAuthStatus(await client.checkStatus());
		}
	}

	/** Reflect the language server's own sign-in state in the status bar. */
	private applyAuthStatus(status: AuthStatus): void {
		this._log.info(`Language server auth status: ${JSON.stringify(status)}`);
		this._needsSignIn = status.status !== 'OK';
		if (status.status === 'OK') {
			this.showStatus({ busy: false, kind: StatusKind.Normal, message: vscode.l10n.t('GitHub Copilot: signed in as {0}', status.user ?? '') });
		} else if (status.status === 'NotAuthorized') {
			this.showStatus({ busy: false, kind: StatusKind.Error, message: vscode.l10n.t('GitHub account {0} does not have access to Copilot', status.user ?? '') });
		} else {
			this.showStatus({ busy: false, kind: StatusKind.Error, message: vscode.l10n.t('Sign in to GitHub to use Copilot') });
		}
	}

	private async stop(): Promise<void> {
		const client = this._client;
		this._client = undefined;
		this._authKey = undefined;
		this._needsSignIn = false;
		if (client) {
			await client.client.stop().catch(() => undefined);
			client.dispose();
		}
	}

	private showStatus(status: DidChangeStatusParams): void {
		const icon = status.busy ? '$(loading~spin)' : status.kind === StatusKind.Normal ? '$(copilot)' : '$(copilot-warning)';
		this._statusItem.text = icon;
		this._statusItem.tooltip = status.message || vscode.l10n.t('GitHub Copilot Completions');
		this._statusItem.command = status.kind === StatusKind.Error && (!this._client || this._needsSignIn)
			? 'copilotCompletions.signIn'
			: 'copilotCompletions.showLog';
		this._statusItem.show();
	}

	dispose(): void {
		void this.stop();
		this._disposables.forEach(d => d.dispose());
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('GitHub Copilot Completions', { log: true });
	const controller = new CopilotCompletionsController(context, log);
	context.subscriptions.push(log, controller);
	void controller.update();
}

export function deactivate(): void { }

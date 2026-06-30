/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

import { ExtensionContext } from 'vscode';

const PROVIDER_ID = 'github';
const GITHUB_SCOPE_USER_EMAIL = ['user:email'];
const GITHUB_SCOPE_ALIGNED = ['read:user', 'user:email', 'repo', 'workflow'];


/** Register the Copilot service. */
export function registerCopilotService(context: ExtensionContext) {
	// Use the singleton pattern to ensure only one CopilotService instance exists
	const copilotService = CopilotService.create(context);
	context.subscriptions.push(copilotService);
}

export class CopilotService implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	/** The CopilotService singleton instance. */
	private static _instance?: CopilotService;

	/** Current auth session */
	private _authSession: vscode.AuthenticationSession | null = null;

	private readonly _onSignedInChanged = new vscode.EventEmitter<boolean>();
	public readonly onSignedInChanged = this._onSignedInChanged.event;

	/** The cancellation token for the current operation. */
	private _cancellationToken: vscode.CancellationTokenSource | null = null;

	/** Create the CopilotLanguageService singleton instance. */
	public static create(context: ExtensionContext) {
		if (CopilotService._instance) {
			return CopilotService._instance;
		}
		CopilotService._instance = new CopilotService(context);
		return CopilotService._instance;
	}

	/** Retrieve the CopilotLanguageService singleton instance. */
	public static instance(): CopilotService {
		if (!CopilotService._instance) {
			throw new Error('CopilotService was not created. Call create() first.');
		}
		return CopilotService._instance;
	}

	private constructor(
		private readonly _context: vscode.ExtensionContext,
	) {
		// Refresh signed-in state on startup
		this.refreshSignedInState();

		// Listen for authentication session changes to detect sign-out
		this._disposables.push(
			vscode.authentication.onDidChangeSessions((e) => {
				if (e.provider.id === PROVIDER_ID) {
					this.refreshSignedInState();
				}
			})
		);
	}

	/**
	 * Prompt the user to sign in to Copilot if they aren't already signed in.
	 */
	async signIn(): Promise<void> {
		// First, see if there's an existing session we can use
		let session = await vscode.authentication.getSession(PROVIDER_ID, GITHUB_SCOPE_ALIGNED, { silent: true });
		if (session) {
			// Already signed in
		} else {
			// Prompt the user to sign in
			session = await vscode.authentication.getSession(PROVIDER_ID, GITHUB_SCOPE_ALIGNED, { createIfNone: true });
			if (session) {
				// New session created, prompt the user to reload to finish setup
				const shouldReload = await positron.window.showSimpleModalDialogPrompt(
					vscode.l10n.t('Reload Required'),
					vscode.l10n.t('Positron needs to reload to finish setting up GitHub Copilot.'),
					vscode.l10n.t('Reload'),
					vscode.l10n.t('Cancel')
				);
				if (shouldReload) {
					await vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			}
		}

		if (session) {
			this.setAuthSession(session);
		}
	}

	private setAuthSession(session: vscode.AuthenticationSession | null): void {
		const wasSignedIn = !!this._authSession;
		this._authSession = session;
		if (!wasSignedIn && !!this._authSession) {
			this._onSignedInChanged.fire(true);
		} else if (wasSignedIn && !this._authSession) {
			this._onSignedInChanged.fire(false);
		}
	}

	/** Sign out of Copilot. */
	async signOut(): Promise<boolean> {
		return false;
	}

	public get isSignedIn(): boolean {
		// Always check the persistent state to determine if signed in
		return !!this._authSession;
	}

	/**
	 * Refresh the signed-in state based on the current model registration status.
	 * This should be called when a model is registered or deleted.
	 */
	public async refreshSignedInState(): Promise<void> {
		// Try the full scope first (used when signing in), then fall back to minimal scope
		let session = await vscode.authentication.getSession(PROVIDER_ID, GITHUB_SCOPE_ALIGNED, { silent: true });
		if (!session) {
			session = await vscode.authentication.getSession(PROVIDER_ID, GITHUB_SCOPE_USER_EMAIL, { silent: true });
		}
		if (session?.id !== this._authSession?.id) {
			this.setAuthSession(session);
		}
	}

	dispose(): void {
		this._disposables.forEach((disposable) => disposable.dispose());
		this._onSignedInChanged.dispose();
	}
}




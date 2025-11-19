/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CopilotService } from './copilot.js';

/**
 * Authentication provider that proxies GitHub Copilot auth via CopilotService.
 *
 * This provider is used so that VS Code's chat entitlement service tracks the
 * Copilot OAuth sign-in state and propagates it to the UI.
 *
 * Note: We do not obtain or expose a real access token from CopilotService.
 * Returning a session object is sufficient for VS Code to treat the user as
 * "signed in" for entitlement purposes; entitlement fetch may stay Unresolved
 * if no token is available, which still results in `chatEntitlementSignedOut=false`.
 */
export class CopilotAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	static readonly id = 'positron.assistant';
	static readonly label = 'GitHub Copilot';

	private readonly _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private disposed = false;

	constructor(private readonly context: vscode.ExtensionContext) {
		// Listen to CopilotService sign-in state changes
		const copilotService = CopilotService.instance();
		copilotService.onSignedInChanged(this.onCopilotSignInChanged, this);
	}

	private onCopilotSignInChanged(signedIn: boolean): void {
		// Fire session change event to notify VS Code
		if (signedIn) {
			const session = this.createSessionObject([]);
			this._onDidChangeSessions.fire({ added: [session], changed: [], removed: [] });
		} else {
			const session = this.createSessionObject([]);
			this._onDidChangeSessions.fire({ added: [], changed: [], removed: [session] });
		}
	}

	private createSessionObject(scopes: readonly string[]): vscode.AuthenticationSession {
		return {
			id: 'positron-copilot-session',
			accessToken: 'copilot',
			account: { id: 'github', label: 'GitHub' },
			scopes: [...scopes],
		};
	}

	async getSessions(scopes: readonly string[] | undefined, _options: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession[]> {
		// Simply check if CopilotService is signed in
		const copilotService = CopilotService.instance();
		if (copilotService.isSignedIn) {
			return [this.createSessionObject(scopes || [])];
		}
		return [];
	}

	async createSession(scopes: readonly string[], _options?: vscode.AuthenticationProviderSessionOptions): Promise<vscode.AuthenticationSession> {
		// Delegate sign-in to CopilotService
		await CopilotService.instance().signIn();

		// Return the session object
		return this.createSessionObject(scopes);
	}

	async removeSession(sessionId: string): Promise<void> {
		// Delegate sign-out to CopilotService
		await CopilotService.instance().signOut();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this._onDidChangeSessions.dispose();
	}
}

export function registerCopilotAuthProvider(context: vscode.ExtensionContext): vscode.Disposable {
	const provider = new CopilotAuthProvider(context);
	const disposable = vscode.authentication.registerAuthenticationProvider(
		CopilotAuthProvider.id,
		CopilotAuthProvider.label,
		provider,
		{ supportsMultipleAccounts: false }
	);

	context.subscriptions.push(provider, disposable);
	return disposable;
}

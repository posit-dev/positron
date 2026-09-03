/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Show a secret's shape without putting the secret itself on screen. */
function redact(value: string | undefined): string {
	if (!value) {
		return '(absent)';
	}
	return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`;
}

export function activate(context: vscode.ExtensionContext) {
	const log = vscode.window.createOutputChannel('Scratch', { log: true });
	context.subscriptions.push(log);

	const disposables = [];

	// Extensions can be granted access to AuthenticationProviders to obtain credentials.
	// We already do this with `positron.authentication` and `posit.assistant`.
	disposables.push(vscode.commands.registerCommand('scratch.helloWorld', async () => {
		const providerId = 'amazon-bedrock';
		try {
			// createIfNone so a missing grant surfaces the consent modal and a
			// missing credential surfaces the provider's own error, instead of
			// both collapsing into an indistinguishable undefined.
			const session = await vscode.authentication.getSession(providerId, [], { createIfNone: true });

			// The AWS provider serializes {accessKeyId, secretAccessKey,
			// sessionToken} as JSON into accessToken -- it is not a bearer token.
			const creds = JSON.parse(session.accessToken) as {
				accessKeyId?: string;
				secretAccessKey?: string;
				sessionToken?: string;
			};

			log.info(`account: ${session.account.label} (${session.account.id})`);
			log.info(`accessKeyId: ${creds.accessKeyId ?? '(absent)'}`);
			log.info(`secretAccessKey: ${redact(creds.secretAccessKey)}`);
			log.info(`sessionToken: ${redact(creds.sessionToken)}`);
			log.show(true);

			vscode.window.showInformationMessage(
				`Resolved ${providerId} credentials for ${creds.accessKeyId ?? 'unknown key'}. See the Scratch output channel.`
			);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			log.error(`${providerId}: ${message}`);
			log.show(true);
			vscode.window.showErrorMessage(`${providerId}: ${message}`);
		}
	}));

	class ScratchAuthenticationProvider implements vscode.AuthenticationProvider {

		SESSION: vscode.AuthenticationSession = { id: 'scratch.dummyId', accessToken: 'dummyAccessToken', scopes: [], account: { label: 'dummyAcountLabel', id: 'dummyAccountId' } };

		sessions: vscode.AuthenticationSession[] = [];

		onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;

		constructor() {
			this.onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>().event;
		}

		getSessions(scopes: readonly string[] | undefined, options: vscode.AuthenticationProviderSessionOptions): Thenable<vscode.AuthenticationSession[]> {
			return Promise.resolve(this.sessions);
		}
		createSession(scopes: readonly string[], options: vscode.AuthenticationProviderSessionOptions): Thenable<vscode.AuthenticationSession> {
			return Promise.resolve(this.SESSION);
		}
		removeSession(sessionId: string): Thenable<void> {
			throw new Error('Method not implemented.');
		}
	}
	const scratchAuthenticationProvider = new ScratchAuthenticationProvider();
	disposables.push(vscode.authentication.registerAuthenticationProvider('scratch.dummyId', 'Scratch Provider', scratchAuthenticationProvider));

	disposables.push(vscode.commands.registerCommand('scratch.createSession', async () => {
		// Implement the command logic here
		try {
			const session = await scratchAuthenticationProvider.createSession([], {});
			vscode.window.showInformationMessage('Create session command executed.');
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(`Failed to create session: ${message}`);
		}
	}));

	disposables.push(vscode.commands.registerCommand('scratch.removeSession', async () => {
		// Implement the command logic here
		try {
			await scratchAuthenticationProvider.removeSession('scratch.dummyId');
			vscode.window.showInformationMessage('Remove session command executed.');
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(`Failed to remove session: ${message}`);
		}
	}));

	disposables.push(vscode.commands.registerCommand('scratch.getSession', async () => {
		try {
			const session = await vscode.authentication.getSession('scratch.dummyId', []);
			if (!session) {
				vscode.window.showInformationMessage('No session found.');
				return;
			}

			vscode.window.showInformationMessage(`Get session command executed. Session ID: ${session.id}`);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(`Failed to list sessions: ${message}`);
		}
	}));

	for (const disposable of disposables) {
		context.subscriptions.push(disposable);
	}

	console.log('Here we go!');
}

export function deactivate() { }

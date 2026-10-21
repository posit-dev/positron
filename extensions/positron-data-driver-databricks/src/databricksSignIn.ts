/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Interactive Databricks OAuth U2M sign-in: opens the user's browser and waits for the redirect to
// come back, by whichever of two routes works where Positron is running. The flow's building blocks
// are in databricksOAuth.ts; this file adds the VS Code UI around them.

import * as positron from 'positron';
import * as vscode from 'vscode';
import {
	CallbackListener,
	CallbackResult,
	createAuthorizationRequest,
	DatabricksOAuthSession,
	discoverEndpoints,
	exchangeAuthorizationCode,
	listenForCallback,
	OAUTH_REDIRECT_PORT,
	OAUTH_REDIRECT_URI,
	parseCallbackUrl,
} from './databricksOAuth.js';

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** The page the loopback listener shows once the browser has delivered the redirect. */
function callbackPage(): string {
	const title = vscode.l10n.t('Signed in to Databricks');
	const body = vscode.l10n.t('You can close this tab and return to Positron.');
	return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>` +
		`<body style="font-family: system-ui, sans-serif; padding: 2em"><h1>${title}</h1><p>${body}</p></body></html>`;
}

// Sign-ins run one at a time: they share the redirect port, and a second prompt would replace the
// first one's input box and cancel it.
let signInQueue: Promise<unknown> = Promise.resolve();

/**
 * Signs the user in to a Databricks workspace through their browser and returns the session whose
 * access token the connection sends.
 *
 * The redirect comes back one of two ways, whichever happens first:
 * - A loopback listener on the registered redirect port, for when the browser runs on the same
 *   machine as the extension host (desktop Positron, or a remote whose port is forwarded).
 * - The user pasting the redirect URL. On Posit Workbench the browser runs on the user's machine and
 *   the extension host on the server, so the redirect lands on a localhost page nothing serves; the
 *   address bar still carries the code, and pasting it here completes the sign-in. This is the
 *   manual flow Databricks documents.
 *
 * @param host The workspace hostname, without a scheme.
 * @throws When the user cancels, the authorization server reports an error, or a step fails.
 */
export function signInToDatabricks(host: string, logger?: positron.DataConnectionLogger): Promise<DatabricksOAuthSession> {
	const run = signInQueue.then(() => signIn(host, logger));
	signInQueue = run.catch(() => { /* the next sign-in proceeds regardless */ });
	return run;
}

async function signIn(host: string, logger?: positron.DataConnectionLogger): Promise<DatabricksOAuthSession> {
	const endpoints = await discoverEndpoints(host);
	const request = createAuthorizationRequest(endpoints.authorizationEndpoint, OAUTH_REDIRECT_URI);

	let listener: CallbackListener | undefined;
	try {
		listener = await listenForCallback(OAUTH_REDIRECT_PORT, request.state, callbackPage());
	} catch (err) {
		// Another process (possibly another user's, on a shared server) may hold the port. The pasted
		// route still works, so carry on without the listener.
		logger?.warn(`Not listening for the OAuth redirect on port ${OAUTH_REDIRECT_PORT}: ${errorMessage(err)}`);
	}

	const prompt = new vscode.CancellationTokenSource();
	try {
		logger?.info(`Opening the browser to sign in to ${host}: ${request.url}`);
		const browserOpened = await vscode.env.openExternal(vscode.Uri.parse(request.url));
		if (!browserOpened) {
			// The user declined the external-link prompt, or the browser blocked the window. Hand the
			// address over so the sign-in can still be done by hand.
			await vscode.env.clipboard.writeText(request.url);
			logger?.warn('The browser did not open; the sign-in address was copied to the clipboard');
		}
		const callback = await Promise.race([
			listener?.result ?? new Promise<never>(() => { }),
			promptForCallbackUrl(request.state, browserOpened, prompt.token),
		]);
		if (!callback) {
			throw new Error(vscode.l10n.t('Databricks sign-in was cancelled.'));
		}
		if (callback.error !== undefined) {
			throw new Error(vscode.l10n.t('Databricks sign-in failed: {0}', callback.description ?? callback.error));
		}
		const tokens = await exchangeAuthorizationCode(endpoints.tokenEndpoint, {
			code: callback.code,
			verifier: request.verifier,
			redirectUri: OAUTH_REDIRECT_URI,
		});
		logger?.info(`Signed in to ${host}`);
		return new DatabricksOAuthSession(endpoints.tokenEndpoint, tokens);
	} finally {
		prompt.cancel();
		prompt.dispose();
		listener?.close();
	}
}

/**
 * Asks the user to paste the redirect URL, while the loopback listener (if any) waits in parallel.
 * Stays open across an accepted empty value so pressing Enter early does not abandon the sign-in,
 * and confirms before treating a dismissed box as a cancellation, since on desktop the browser may
 * be about to complete the sign-in on its own. The token closes whichever box is open once the
 * listener has delivered the redirect.
 */
async function promptForCallbackUrl(state: string, browserOpened: boolean, token: vscode.CancellationToken): Promise<CallbackResult | undefined> {
	const title = vscode.l10n.t('Sign in to Databricks');
	const prompt = browserOpened
		? vscode.l10n.t("Finish signing in to Databricks in your browser. If the browser ends on a page that cannot be reached, paste that page's address here.")
		: vscode.l10n.t("Positron could not open your browser. The sign-in address is on the clipboard: open it in a browser, finish signing in, then paste the address of the page the browser ends on here.");
	const pasteChoice = vscode.l10n.t('Paste the address of the page the browser ended on');
	const cancelChoice = vscode.l10n.t('Cancel the sign-in');
	while (!token.isCancellationRequested) {
		const value = await vscode.window.showInputBox({
			title,
			prompt,
			placeHolder: `${OAUTH_REDIRECT_URI}/?code=...`,
			ignoreFocusOut: true,
			validateInput: value => {
				if (!value.trim()) {
					return undefined;
				}
				const parsed = parseCallbackUrl(value, state);
				if (!parsed) {
					return vscode.l10n.t('Paste the full address of the page the browser ended on.');
				}
				if (parsed.error === 'state_mismatch') {
					return vscode.l10n.t('This address is from a different sign-in attempt.');
				}
				return undefined;
			},
		}, token);
		if (value !== undefined) {
			const parsed = parseCallbackUrl(value, state);
			if (parsed) {
				return parsed;
			}
			continue;
		}
		if (token.isCancellationRequested) {
			return undefined;
		}
		const choice = await vscode.window.showQuickPick([pasteChoice, cancelChoice], {
			title,
			placeHolder: vscode.l10n.t('The Databricks sign-in has not finished.'),
			ignoreFocusOut: true,
		}, token);
		if (choice !== pasteChoice) {
			return undefined;
		}
	}
	return undefined;
}

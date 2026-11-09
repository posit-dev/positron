/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { AuthStatus, CopilotLanguageClient } from './client.js';

const GITHUB_PROVIDER_ID = 'github';

/** Settings that choose how the language server is authenticated. */
export const SIGN_IN_METHOD_KEY = 'copilotCompletions.signInMethod';
export const CONFIG_DIRECTORY_KEY = 'copilotCompletions.configDirectory';

/**
 * - `accounts`: use the GitHub session from Positron's Accounts menu.
 * - `languageServer`: let the language server run its own device flow.
 */
export type SignInMethod = 'accounts' | 'languageServer';

/** The configured sign-in method. Read live; never cached. */
export function getSignInMethod(): SignInMethod {
	return vscode.workspace.getConfiguration().get<string>(SIGN_IN_METHOD_KEY) === 'languageServer'
		? 'languageServer'
		: 'accounts';
}

/**
 * The directory the language server keeps `github-copilot/auth.db` in, when
 * overridden. The server ignores relative paths, so they are dropped here.
 */
export function getConfigDirectory(log: vscode.LogOutputChannel): string | undefined {
	const value = vscode.workspace.getConfiguration().get<string>(CONFIG_DIRECTORY_KEY)?.trim();
	if (!value) {
		return undefined;
	}
	if (!path.isAbsolute(value)) {
		log.warn(`Ignoring ${CONFIG_DIRECTORY_KEY} '${value}': it must be an absolute path.`);
		return undefined;
	}
	return value;
}

/**
 * Scope sets a GitHub session from the Accounts menu may have been created
 * with, most minimal first. `getSession` matches scopes exactly, so to reuse
 * an existing session silently we try each known set. The first is the one we
 * request when the user signs in from this extension.
 */
const SCOPE_SETS: readonly (readonly string[])[] = [
	['user:email'],
	['read:user'],
	['read:user', 'user:email', 'repo', 'workflow'],
];

/**
 * Find an existing GitHub session from Positron's authentication service
 * without prompting. In remote SSH this resolves through the local (UI side)
 * GitHub auth provider, so the remote host never runs its own sign-in.
 */
export async function findGitHubSession(): Promise<vscode.AuthenticationSession | undefined> {
	for (const scopes of SCOPE_SETS) {
		const session = await vscode.authentication.getSession(GITHUB_PROVIDER_ID, scopes, { silent: true });
		if (session) {
			return session;
		}
	}
	// Neither silent nor createIfNone: returns undefined without prompting, but
	// adds a "Sign in with GitHub to use ..." entry to the Accounts menu.
	return vscode.authentication.getSession(GITHUB_PROVIDER_ID, SCOPE_SETS[0], {});
}

/** Prompt the user to sign in to GitHub through Positron's Accounts flow. */
export async function signInToGitHub(): Promise<vscode.AuthenticationSession> {
	return vscode.authentication.getSession(GITHUB_PROVIDER_ID, SCOPE_SETS[0], { createIfNone: true });
}

export function isGitHubProvider(id: string): boolean {
	return id === GITHUB_PROVIDER_ID;
}

/**
 * Sign in through the language server's GitHub device flow.
 *
 * Copies the one-time code to the clipboard, asks the user to continue in the
 * browser, then waits for the server to see the device authorized. Returns
 * the resulting status, or undefined if the user cancelled before starting.
 */
export async function signInWithDeviceFlow(
	client: CopilotLanguageClient,
	log: vscode.LogOutputChannel,
): Promise<AuthStatus | undefined> {
	const result = await client.signIn();
	if (result.status === 'AlreadySignedIn') {
		log.info(`Language server is already signed in as ${result.user}.`);
		vscode.window.showInformationMessage(vscode.l10n.t('GitHub Copilot Completions is already signed in as {0}.', result.user));
		return { status: 'OK', user: result.user };
	}

	log.info(`Device flow started; verification URI ${result.verificationUri}, expires in ${result.expiresIn}s.`);
	await vscode.env.clipboard.writeText(result.userCode);
	const proceed = vscode.l10n.t('Continue in Browser');
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t('Sign In to GitHub Copilot Completions'),
		{
			modal: true,
			detail: vscode.l10n.t('Your one-time code is {0}. It has been copied to the clipboard. Paste it on the GitHub page that opens next.', result.userCode),
		},
		proceed,
	);
	if (choice !== proceed) {
		log.info('Device flow cancelled before opening the browser.');
		return undefined;
	}

	const status = await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: vscode.l10n.t('Waiting for GitHub sign-in (code {0})...', result.userCode),
	}, () => client.finishSignIn(result.command));
	log.info(`Device flow finished: ${JSON.stringify(status)}`);
	return status;
}

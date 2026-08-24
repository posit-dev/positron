/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AuthProviderLogger } from './authProviderLogger';
import {
	classifyAwsChainError,
	ExpiredSsoError,
	runSsoLogin,
	SsoLoginError,
} from './credentials/awsSso';

const logger = new AuthProviderLogger('AWS');

export interface AwsSsoRecovery {
	/**
	 * Record a credential-chain failure. `resolveChainCredentials` swallows the
	 * chain's error and `createSession` throws a generic one in its place, so
	 * the real cause has to be kept here for `recover` to classify.
	 */
	noteFailure(err: unknown): void;

	/**
	 * Re-run the SSO login when the failure warrants it. Returns true when the
	 * caller should retry the connect, false when there was nothing to recover
	 * or the user cancelled. Throws a user-facing error when the login was
	 * attempted and failed.
	 */
	recover(err: unknown): Promise<boolean>;
}

export interface AwsSsoRecoveryDeps {
	/** The AWS profile from the provider catalog, when one is configured. */
	getProfile: () => string | undefined;
	/** Runs the login. Injected by tests so no process is spawned. */
	login?: (
		profile: string | undefined,
		token: vscode.CancellationToken
	) => Promise<void>;
}

export function createAwsSsoRecovery(deps: AwsSsoRecoveryDeps): AwsSsoRecovery {
	const login = deps.login ?? runSsoLogin;
	let noted: unknown;
	let inFlight: Promise<boolean> | undefined;

	const attempt = async (expired: ExpiredSsoError): Promise<boolean> => {
		// The note has been consumed. Clear it before the attempt so a cancelled
		// or failed login cannot leave a stale note behind that makes the next
		// unrelated failure look like a lapsed SSO session. A repeat attempt
		// re-resolves the chain, which notes the failure again if it recurs.
		noted = undefined;
		const profile = deps.getProfile() ?? expired.profile;
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t(
						'Signing in to AWS -- approve the request in your browser'
					),
					cancellable: true,
				},
				(_progress, token) => login(profile, token)
			);
			logger.info('SSO login completed; retrying credential resolution');
			return true;
		} catch (err) {
			if (err instanceof SsoLoginError) {
				if (err.reason === 'cancelled') {
					logger.info(`SSO login not completed: ${err.message}`);
					return false;
				}
				if (err.reason === 'cli-missing') {
					throw new Error(vscode.l10n.t(
						'The AWS CLI is required to refresh your AWS SSO session. Install it and try again.'
					));
				}
				throw new Error(vscode.l10n.t(
					'AWS sign-in failed: {0}', err.message
				));
			}
			throw err;
		}
	};

	return {
		noteFailure(err: unknown): void {
			noted = err;
		},

		async recover(err: unknown): Promise<boolean> {
			// A recovery already in flight is the answer for any concurrent
			// caller: join it. Classifying again here would fail, because
			// `attempt` consumes and clears the note synchronously.
			if (inFlight) {
				return inFlight;
			}
			const expired = classifyAwsChainError(err)
				?? classifyAwsChainError(noted);
			if (!expired) {
				return false;
			}
			inFlight = attempt(expired)
				.finally(() => { inFlight = undefined; });
			return inFlight;
		},
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AuthProviderLogger } from './authProviderLogger';
import type { RecoverCallback } from './configDialog';
import {
	classifyAwsChainError,
	ExpiredSsoError,
	runSsoLogin,
	SsoLoginError,
} from './awsSso';

const logger = new AuthProviderLogger('AWS');

export interface CreateAwsSsoRecoveryOptions {
	/** The AWS profile from the provider catalog, when one is configured. */
	getProfile: () => string | undefined;
	/** Runs the login. Injected by tests so no process is spawned. */
	login?: (
		profile: string | undefined,
		token: vscode.CancellationToken
	) => Promise<void>;
}

/**
 * Build the `recover` hook for the AWS provider: it re-runs the SSO login when
 * the failure warrants it, returning true when the caller should retry the
 * connect and false when there was nothing to recover or the user cancelled. It
 * throws a user-facing error when the login was attempted and failed.
 */
export function createAwsSsoRecovery(options: CreateAwsSsoRecoveryOptions): RecoverCallback {
	const login = options.login ?? runSsoLogin;
	let inFlight: Promise<boolean> | undefined;

	const attempt = async (expired: ExpiredSsoError): Promise<boolean> => {
		const profile = options.getProfile() ?? expired.profile;
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t(
						'Signing in to AWS: approve the request in your browser'
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

	return async (err: unknown): Promise<boolean> => {
		const expired = classifyAwsChainError(err);
		if (!expired) {
			return false;
		}
		// A login already in flight is the answer for any concurrent caller
		// with the same diagnosis: join it rather than spawning a second one.
		if (inFlight) {
			return inFlight;
		}
		inFlight = attempt(expired)
			.finally(() => { inFlight = undefined; });
		return inFlight;
	};
}

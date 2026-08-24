/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import type { CancellationToken } from 'vscode';
import { AuthProviderLogger } from '../authProviderLogger';

/**
 * The AWS SDK appends this sentence to every token error that running
 * `aws sso login` would fix, and omits it from failures a login cannot fix
 * (no credentials configured, profile missing from the config file). Matching
 * it is how we tell a lapsed SSO session apart from every other credential
 * failure, without parsing `~/.aws/config` ourselves.
 */
const REFRESH_MARKER = /To refresh this SSO session run 'aws sso login'/i;

/** A credential-chain failure recognized as a lapsed AWS SSO session. */
export interface ExpiredSsoError {
	readonly kind: 'expired-sso';
	/** The profile the SDK named in the error, when it named one. */
	readonly profile?: string;
}

/**
 * Recognize a lapsed SSO session in a credential-chain failure. Returns
 * undefined for anything else, so callers gated on this keep their existing
 * behavior for every unrecognized failure.
 */
export function classifyAwsChainError(err: unknown): ExpiredSsoError | undefined {
	for (const message of errorMessages(err)) {
		if (!REFRESH_MARKER.test(message)) {
			continue;
		}
		const profile = /profile=(\S+)/.exec(message)?.[1];
		return profile ? { kind: 'expired-sso', profile } : { kind: 'expired-sso' };
	}
	return undefined;
}

/**
 * Messages from an error and its `cause` chain, outermost first. The chain
 * matters because the credential chain wraps the token provider's error in a
 * generic one before it reaches us.
 */
function errorMessages(err: unknown): string[] {
	const messages: string[] = [];
	let current: unknown = err;
	for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
		if (typeof current === 'string') {
			messages.push(current);
			break;
		}
		if (!(current instanceof Error)) {
			messages.push(String(current));
			break;
		}
		messages.push(current.message);
		current = (current as { cause?: unknown }).cause;
	}
	return messages;
}

const logger = new AuthProviderLogger('AWS');

/** How long to let the CLI run. Matches the SSO device-code expiry. */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/** Injection point so tests do not spawn a real process. */
export type SpawnFn = typeof spawn;

/** Why an `aws sso login` attempt did not produce credentials. */
export class SsoLoginError extends Error {
	constructor(
		readonly reason: 'cli-missing' | 'login-failed' | 'cancelled',
		message: string,
	) {
		super(message);
		this.name = 'SsoLoginError';
	}
}

/**
 * Run `aws sso login`, resolving when the CLI exits cleanly. The CLI opens the
 * user's browser and polls for approval itself, so there is nothing to drive
 * here beyond watching the process. Output is logged to the AWS channel;
 * failures carry a `reason` the caller turns into a user-facing message.
 */
export function runSsoLogin(
	profile: string | undefined,
	token: CancellationToken,
	spawnFn: SpawnFn = spawn,
): Promise<void> {
	const args = profile
		? ['sso', 'login', '--profile', profile]
		: ['sso', 'login'];
	logger.info(`Running: aws ${args.join(' ')}`);

	return new Promise<void>((resolve, reject) => {
		const child = spawnFn('aws', args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let lastStderrLine = '';
		let settled = false;

		const finish = (err?: SsoLoginError) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			cancelListener.dispose();
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		};

		const abort = (message: string) => {
			child.kill();
			finish(new SsoLoginError('cancelled', message));
		};

		const timer = setTimeout(
			() => abort('aws sso login timed out'),
			LOGIN_TIMEOUT_MS
		);
		const cancelListener = token.onCancellationRequested(
			() => abort('aws sso login cancelled')
		);

		child.stdout?.on('data', (data: unknown) => {
			const text = String(data).trim();
			if (text) {
				logger.info(`aws sso login: ${text}`);
			}
		});
		child.stderr?.on('data', (data: unknown) => {
			const text = String(data).trim();
			if (text) {
				lastStderrLine = text.split('\n').pop() ?? text;
				logger.warn(`aws sso login: ${text}`);
			}
		});
		// Typed as Error to match the ChildProcess overload under
		// strictFunctionTypes; the errno lives behind a cast.
		child.on('error', (err: Error) => {
			const code = (err as NodeJS.ErrnoException).code;
			finish(new SsoLoginError(
				code === 'ENOENT' ? 'cli-missing' : 'login-failed',
				err.message
			));
		});
		child.on('close', (code: number | null) => {
			if (code === 0) {
				finish();
				return;
			}
			finish(new SsoLoginError(
				'login-failed',
				lastStderrLine || `aws sso login exited with code ${code}`
			));
		});
	});
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import type { CancellationToken } from 'vscode';
import { AuthProviderLogger } from './authProviderLogger';

/**
 * Two AWS SDK packages append this sentence to every token error that
 * running `aws sso login` would fix, and omit it from failures a login
 * cannot fix (no credentials configured, profile missing from the config
 * file). They differ in whether `aws sso login` is quoted:
 * `@aws-sdk/token-providers` quotes it (the `[sso-session]` profile shape),
 * while `@aws-sdk/credential-provider-sso` does not (the legacy profile shape
 * with `sso_start_url` etc. directly on the profile, no `[sso-session]`
 * block). The optional quotes match both. Matching this sentence is how we
 * tell a lapsed SSO session apart from every other credential failure,
 * without parsing `~/.aws/config` ourselves.
 */
const REFRESH_MARKER = /To refresh this SSO session run '?aws sso login'?/i;

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

/** One of a child process's output streams. */
interface SsoLoginOutput {
	on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/**
 * The parts of a spawned child process this module uses. Declaring the shape we
 * depend on, rather than aliasing Node's fully overloaded `spawn`, keeps the
 * real `spawn` assignable while letting a test fake satisfy the type directly
 * instead of asserting it through a cast.
 */
interface SsoLoginProcess {
	readonly stdout: SsoLoginOutput | null;
	readonly stderr: SsoLoginOutput | null;
	on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
	on(event: 'close', listener: (code: number | null) => void): unknown;
	kill(): void;
}

/** Injection point so tests do not spawn a real process. */
export type SpawnFn = (
	command: string,
	args: readonly string[],
	options: { stdio: ['ignore', 'pipe', 'pipe'] },
) => SsoLoginProcess;

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
 * Classify a spawn failure. `spawn` reports these two ways -- an `'error'` event,
 * or a synchronous throw, which is how Node refuses to run a `.bat`/`.cmd` shim
 * without a shell (the CVE-2024-27980 mitigation) -- and both have to reach the
 * caller as the same actionable reason.
 */
function toSsoLoginError(err: unknown): SsoLoginError {
	const code = (err as NodeJS.ErrnoException | undefined)?.code;
	// ENOENT: nothing named `aws` on PATH -- note Windows CreateProcess only
	// appends `.exe`, so a shim-only install lands here too. EACCES: found but
	// not executable. EINVAL: the `.bat`/`.cmd` refusal above. All three mean
	// there is no usable CLI to run, not that the login itself failed.
	const reason = code === 'ENOENT' || code === 'EACCES' || code === 'EINVAL'
		? 'cli-missing'
		: 'login-failed';
	return new SsoLoginError(
		reason,
		err instanceof Error ? err.message : String(err)
	);
}

/**
 * Run `aws sso login`, resolving when the CLI exits cleanly. The CLI opens the
 * user's browser and polls for approval itself, so there is nothing to drive
 * here beyond watching the process. Output is logged to the AWS channel;
 * failures carry a `reason` the caller turns into a user-facing message.
 *
 * Never passes `shell: true`: the profile name comes from the provider catalog,
 * so a shell would make it a command-injection vector.
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
		let child: SsoLoginProcess;
		try {
			child = spawnFn('aws', args, { stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (err) {
			// Thrown before any timer or listener exists, so reject directly
			// rather than going through `finish`.
			reject(toSsoLoginError(err));
			return;
		}
		let stderrText = '';
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
			// Accumulate the raw chunk (not the trimmed one) so a line split
			// across two chunks is rejoined correctly; only the logged copy
			// is trimmed.
			const raw = String(data);
			stderrText += raw;
			const text = raw.trim();
			if (text) {
				logger.warn(`aws sso login: ${text}`);
			}
		});
		child.on('error', (err: NodeJS.ErrnoException) => {
			finish(toSsoLoginError(err));
		});
		child.on('close', (code: number | null) => {
			if (code === 0) {
				finish();
				return;
			}
			const lastLine = stderrText.split('\n').map(line => line.trim()).filter(line => line).pop();
			finish(new SsoLoginError(
				'login-failed',
				lastLine || `aws sso login exited with code ${code}`
			));
		});
	});
}

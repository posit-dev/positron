/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { classifyAwsChainError, runSsoLogin, SpawnFn, SsoLoginError } from '../awsSso';

// The sentence the AWS SDK appends to every token error an `aws sso login`
// would fix. Copied verbatim from @aws-sdk/token-providers.
const REFRESH = `To refresh this SSO session run 'aws sso login' with the corresponding profile.`;

// The unquoted twin of REFRESH, copied verbatim from
// @aws-sdk/credential-provider-sso. Legacy profiles (sso_start_url etc.
// directly on the profile, no [sso-session] block) produce this spelling.
const LEGACY_REFRESH = `To refresh this SSO session run aws sso login with the corresponding profile.`;

/** An error wrapping another as its `cause`, the way the chain wraps ours. */
function wrapped(message: string, cause: Error): Error {
	const err = new Error(message);
	(err as { cause?: unknown }).cause = cause;
	return err;
}

suite('classifyAwsChainError', () => {
	test('recognizes the recoverable SSO errors and rejects the rest', () => {
		const results = [
			// Expired cached token, no profile named.
			classifyAwsChainError(new Error(`Token is expired. ${REFRESH}`)),
			// Missing or invalid token, profile named.
			classifyAwsChainError(new Error(
				`The SSO session token associated with profile=default was not found or is invalid. ${REFRESH}`
			)),
			// Non-default profile name.
			classifyAwsChainError(new Error(
				`The SSO session token associated with profile=sso-dev was not found or is invalid. ${REFRESH}`
			)),
			// Wrapped in the generic error the credential chain throws.
			// `new Error(msg, { cause })` is ES2022 and this extension compiles
			// against lib es2020, so attach the cause by assignment.
			classifyAwsChainError(wrapped('No credentials found for AWS.', new Error(`Token is expired. ${REFRESH}`))),
			// Not recoverable by a login: nothing configured at all.
			classifyAwsChainError(new Error('Could not load credentials from any providers')),
			// Not recoverable by a login: the profile does not exist.
			classifyAwsChainError(new Error(`Profile 'dev' could not be found in shared credentials file.`)),
			// Not an error object at all.
			classifyAwsChainError(undefined),
			// Legacy profile shape (no [sso-session] block): invalid session,
			// unquoted refresh sentence from @aws-sdk/credential-provider-sso.
			classifyAwsChainError(new Error(
				`The SSO session associated with this profile is invalid. ${LEGACY_REFRESH}`
			)),
			// Legacy profile shape: expired session, same unquoted sentence.
			classifyAwsChainError(new Error(
				`The SSO session associated with this profile has expired. ${LEGACY_REFRESH}`
			)),
		];

		assert.deepStrictEqual(results, [
			{ kind: 'expired-sso' },
			{ kind: 'expired-sso', profile: 'default' },
			{ kind: 'expired-sso', profile: 'sso-dev' },
			{ kind: 'expired-sso' },
			undefined,
			undefined,
			undefined,
			{ kind: 'expired-sso' },
			{ kind: 'expired-sso' },
		]);
	});
});

/** A stand-in for ChildProcess carrying only what runSsoLogin touches. */
function fakeChild() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: () => void;
		killed: boolean;
	};
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.killed = false;
	child.kill = () => { child.killed = true; };
	return child;
}

suite('runSsoLogin', () => {
	let child: ReturnType<typeof fakeChild>;
	let spawnArgs: { command: string; args: readonly string[] } | undefined;
	let spawnFn: SpawnFn;
	let cancellation: vscode.CancellationTokenSource;

	setup(() => {
		child = fakeChild();
		spawnArgs = undefined;
		spawnFn = (command: string, args: readonly string[]) => {
			spawnArgs = { command, args };
			return child;
		};
		cancellation = new vscode.CancellationTokenSource();
	});

	teardown(() => {
		cancellation.dispose();
	});

	test('passes the profile through and resolves on a clean exit', async () => {
		const pending = runSsoLogin('sso-dev', cancellation.token, spawnFn);
		child.emit('close', 0);

		await pending;

		assert.deepStrictEqual(spawnArgs, {
			command: 'aws',
			args: ['sso', 'login', '--profile', 'sso-dev'],
		});
	});

	test('omits --profile when no profile is configured', async () => {
		const pending = runSsoLogin(undefined, cancellation.token, spawnFn);
		child.emit('close', 0);

		await pending;

		assert.deepStrictEqual(spawnArgs?.args, ['sso', 'login']);
	});

	test('reports the last stderr line when the CLI exits non-zero', async () => {
		const pending = runSsoLogin(undefined, cancellation.token, spawnFn);
		child.stderr.emit('data', 'first problem\nAn error occurred: AccessDenied\n');
		child.emit('close', 1);

		const err = await pending.then(() => undefined, (e: unknown) => e);

		assert.deepStrictEqual(
			[(err as SsoLoginError).reason, (err as SsoLoginError).message],
			['login-failed', 'An error occurred: AccessDenied']
		);
	});

	test('reports the last stderr line even when it is split across chunks', async () => {
		const pending = runSsoLogin(undefined, cancellation.token, spawnFn);
		child.stderr.emit('data', 'first problem\nAn err');
		child.stderr.emit('data', 'or occurred: AccessDenied\n');
		child.emit('close', 1);

		const err = await pending.then(() => undefined, (e: unknown) => e);

		assert.strictEqual((err as SsoLoginError).message, 'An error occurred: AccessDenied');
	});

	test('reports a missing or unusable CLI distinctly, regardless of errno', async () => {
		const results = await Promise.all((['ENOENT', 'EACCES', 'EINVAL'] as const).map(async code => {
			const errnoChild = fakeChild();
			const errnoSpawnFn: SpawnFn = (_command: string, _args: readonly string[]) => errnoChild;
			const pending = runSsoLogin(undefined, cancellation.token, errnoSpawnFn);
			const spawnError: NodeJS.ErrnoException = new Error(`spawn aws ${code}`);
			spawnError.code = code;
			errnoChild.emit('error', spawnError);
			const err = await pending.then(() => undefined, (e: unknown) => e);
			return (err as SsoLoginError).reason;
		}));

		assert.deepStrictEqual(results, ['cli-missing', 'cli-missing', 'cli-missing']);
	});

	test('classifies a synchronous spawn throw the same as an error event', async () => {
		// Node refuses to spawn a .bat/.cmd shim without a shell by throwing
		// rather than emitting 'error', so the classification cannot live only
		// in the event handler.
		const throwingSpawnFn: SpawnFn = () => {
			const spawnError: NodeJS.ErrnoException = new Error('spawn aws EINVAL');
			spawnError.code = 'EINVAL';
			throw spawnError;
		};

		const err = await runSsoLogin('sso-dev', cancellation.token, throwingSpawnFn)
			.then(() => undefined, (e: unknown) => e);

		assert.deepStrictEqual(
			[(err as SsoLoginError).reason, (err as SsoLoginError).name],
			['cli-missing', 'SsoLoginError']
		);
	});

	test('cancellation kills the child and reports cancelled', async () => {
		const pending = runSsoLogin(undefined, cancellation.token, spawnFn);
		cancellation.cancel();

		const err = await pending.then(() => undefined, (e: unknown) => e);

		assert.deepStrictEqual(
			[(err as SsoLoginError).reason, child.killed],
			['cancelled', true]
		);
	});
});

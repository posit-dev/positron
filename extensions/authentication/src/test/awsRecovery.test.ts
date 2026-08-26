/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createAwsSsoRecovery } from '../awsRecovery';
import { SsoLoginError } from '../awsSso';

const REFRESH = `To refresh this SSO session run 'aws sso login' with the corresponding profile.`;

/**
 * An error carrying another as its `cause`, the way `createSession` does --
 * non-enumerable, matching the native `cause` this `lib: es2020` target cannot
 * pass to the `Error` constructor. Classification must not depend on the
 * property being enumerable.
 */
function wrapped(message: string, cause: Error): Error {
	const err = new Error(message);
	Object.defineProperty(err, 'cause', {
		value: cause, writable: true, configurable: true,
	});
	return err;
}

// What AuthProvider.createSession throws: its own actionable message with the
// real chain failure chained beneath it.
const CHAINED = wrapped(
	'No credentials found for AWS.',
	new Error(`Token is expired. ${REFRESH}`)
);

suite('createAwsSsoRecovery', () => {
	test('ignores a failure that no login would fix', async () => {
		let logins = 0;
		const recover = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { logins++; },
		});

		const recovered = await recover(
			wrapped('No credentials found for AWS.', new Error('Could not load credentials from any providers'))
		);

		assert.deepStrictEqual([recovered, logins], [false, 0]);
	});

	test('classifies the cause chained beneath the generic message', async () => {
		const profiles: Array<string | undefined> = [];
		const recover = createAwsSsoRecovery({
			getProfile: () => 'sso-dev',
			login: async (profile) => { profiles.push(profile); },
		});

		const recovered = await recover(CHAINED);

		assert.deepStrictEqual([recovered, profiles], [true, ['sso-dev']]);
	});

	test('runs one login for concurrent recover calls', async () => {
		let logins = 0;
		let release = () => { };
		const gate = new Promise<void>(resolve => { release = resolve; });
		const recover = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { logins++; await gate; },
		});

		const first = recover(CHAINED);
		const second = recover(CHAINED);
		release();
		const [firstResult, secondResult] = await Promise.all([first, second]);

		// `logins` must be read after both settle, not inside Promise.all --
		// the login may not have been called yet when the array is built.
		assert.deepStrictEqual([firstResult, secondResult, logins], [true, true, 1]);
	});

	test('an unrelated failure during a login does not join it', async () => {
		let logins = 0;
		let release = () => { };
		const gate = new Promise<void>(resolve => { release = resolve; });
		const recover = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { logins++; await gate; },
		});

		const sso = recover(CHAINED);
		// Classification happens before the in-flight check, so a failure with no
		// SSO cause is reported as unrecoverable rather than inheriting this
		// login's outcome.
		const unrelated = await recover(new Error('Could not load credentials from any providers'));
		release();

		assert.deepStrictEqual([unrelated, await sso, logins], [false, true, 1]);
	});

	test('cancellation reports no recovery without throwing', async () => {
		const recover = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { throw new SsoLoginError('cancelled', 'cancelled'); },
		});

		assert.strictEqual(await recover(CHAINED), false);
	});

	test('surfaces a missing CLI as an actionable error', async () => {
		const recover = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { throw new SsoLoginError('cli-missing', 'spawn aws ENOENT'); },
		});

		const err = await recover(CHAINED).then(() => undefined, (e: unknown) => e);

		assert.match((err as Error).message, /AWS CLI/);
	});

	test('surfaces a failed login with the CLI reason', async () => {
		const recover = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { throw new SsoLoginError('login-failed', 'AccessDenied'); },
		});

		const err = await recover(CHAINED).then(() => undefined, (e: unknown) => e);

		assert.match((err as Error).message, /AccessDenied/);
	});
});

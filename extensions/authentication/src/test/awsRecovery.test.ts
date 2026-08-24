/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createAwsSsoRecovery } from '../awsRecovery';
import { SsoLoginError } from '../credentials/awsSso';

const REFRESH = `To refresh this SSO session run 'aws sso login' with the corresponding profile.`;
const EXPIRED = new Error(`Token is expired. ${REFRESH}`);
// What AuthProvider.createSession actually throws: the chain swallows the real
// cause, so this generic message is all the recover hook is handed.
const GENERIC = new Error('No credentials found for AWS.');

suite('createAwsSsoRecovery', () => {
	test('ignores a failure that no login would fix', async () => {
		let logins = 0;
		const recovery = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { logins++; },
		});

		const recovered = await recovery.recover(
			new Error('Could not load credentials from any providers')
		);

		assert.deepStrictEqual([recovered, logins], [false, 0]);
	});

	test('classifies the noted failure when handed the generic error', async () => {
		const profiles: Array<string | undefined> = [];
		const recovery = createAwsSsoRecovery({
			getProfile: () => 'sso-dev',
			login: async (profile) => { profiles.push(profile); },
		});

		recovery.noteFailure(EXPIRED);
		const recovered = await recovery.recover(GENERIC);

		assert.deepStrictEqual([recovered, profiles], [true, ['sso-dev']]);
	});

	test('runs one login for concurrent recover calls', async () => {
		let logins = 0;
		let release = () => { };
		const gate = new Promise<void>(resolve => { release = resolve; });
		const recovery = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { logins++; await gate; },
		});
		recovery.noteFailure(EXPIRED);

		const first = recovery.recover(GENERIC);
		const second = recovery.recover(GENERIC);
		release();
		const [firstResult, secondResult] = await Promise.all([first, second]);

		// `logins` must be read after both settle, not inside Promise.all --
		// the login may not have been called yet when the array is built.
		assert.deepStrictEqual([firstResult, secondResult, logins], [true, true, 1]);
	});

	test('cancellation reports no recovery without throwing', async () => {
		const recovery = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { throw new SsoLoginError('cancelled', 'cancelled'); },
		});
		recovery.noteFailure(EXPIRED);

		assert.strictEqual(await recovery.recover(GENERIC), false);
	});

	test('surfaces a missing CLI as an actionable error', async () => {
		const recovery = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { throw new SsoLoginError('cli-missing', 'spawn aws ENOENT'); },
		});
		recovery.noteFailure(EXPIRED);

		const err = await recovery.recover(GENERIC).then(() => undefined, (e: unknown) => e);

		assert.match((err as Error).message, /AWS CLI/);
	});

	test('surfaces a failed login with the CLI reason', async () => {
		const recovery = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { throw new SsoLoginError('login-failed', 'AccessDenied'); },
		});
		recovery.noteFailure(EXPIRED);

		const err = await recovery.recover(GENERIC).then(() => undefined, (e: unknown) => e);

		assert.match((err as Error).message, /AccessDenied/);
	});

	test('a cleared note no longer classifies', async () => {
		let logins = 0;
		const recovery = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { logins++; },
		});

		recovery.noteFailure(EXPIRED);
		recovery.noteFailure(undefined);
		const recovered = await recovery.recover(GENERIC);

		assert.deepStrictEqual([recovered, logins], [false, 0]);
	});

	test('a cancelled attempt leaves no stale note behind', async () => {
		let logins = 0;
		const recovery = createAwsSsoRecovery({
			getProfile: () => undefined,
			login: async () => { logins++; throw new SsoLoginError('cancelled', 'cancelled'); },
		});
		recovery.noteFailure(EXPIRED);
		await recovery.recover(GENERIC);

		// A later failure that does not itself classify must not be treated as
		// a lapsed SSO session on the strength of the consumed note.
		const second = await recovery.recover(GENERIC);

		assert.deepStrictEqual([second, logins], [false, 1]);
	});
});

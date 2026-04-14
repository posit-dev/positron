/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

/**
 * Tests the SSH auth handler pattern used by open-remote-ssh.
 *
 * The auth handler in authResolver.ts is called by the ssh2 library during
 * authentication. It receives (methodsLeft, partialSuccess, callback) and
 * must call the callback with either an auth config object or `false` to
 * signal "no more methods".
 *
 * Previously, when a key was unusable (file missing, unparseable), the handler
 * called `callback(null as any)`. The ssh2 library treats null as an invalid
 * auth attempt and re-invokes the handler via process.nextTick, which can cause
 * a runaway async loop if keys are never depleted.
 *
 * The fix changes the publickey `if` to a `while` loop. Unusable keys are
 * skipped with `continue`, and when all keys are exhausted the loop exits
 * and falls through to other auth methods or callback(false).
 *
 * Run with: npm run test-unit (from extensions/open-remote-ssh)
 */

interface MockKey {
	filename: string;
	fileExists: boolean;
	parseable: boolean;
	isPrivate?: boolean;
	agentSupport?: boolean;
}

// Simulates the OLD (buggy) auth handler pattern with `if` and `callback(null)`
function makeBuggyAuthHandler(keys: MockKey[], sshUser: string) {
	const identityKeys = keys.slice();
	return async (
		methodsLeft: string[] | null,
		_partialSuccess: boolean | null,
		callback: (result: any) => void
	) => {
		if (methodsLeft === null) {
			return callback({ type: 'none', username: sshUser });
		}

		// OLD: `if` block - only tries one key per invocation
		if (methodsLeft.includes('publickey') && identityKeys.length) {
			const identityKey = identityKeys.shift()!;

			if (identityKey.agentSupport) {
				return callback({ type: 'agent', username: sshUser });
			}
			if (identityKey.isPrivate) {
				return callback({ type: 'publickey', username: sshUser, key: 'mock' });
			}
			if (!identityKey.fileExists) {
				// BUG: null is not a valid ssh2 callback value
				return callback(null);
			}
			if (!identityKey.parseable) {
				// BUG: same issue
				return callback(null);
			}

			return callback({ type: 'publickey', username: sshUser, key: 'mock' });
		}

		callback(false);
	};
}

// Simulates the FIXED auth handler pattern with `while` and `continue`
function makeFixedAuthHandler(keys: MockKey[], sshUser: string) {
	const identityKeys = keys.slice();
	return async (
		methodsLeft: string[] | null,
		_partialSuccess: boolean | null,
		callback: (result: any) => void
	) => {
		if (methodsLeft === null) {
			return callback({ type: 'none', username: sshUser });
		}

		// FIXED: `while` loop - tries all keys in one invocation
		while (methodsLeft.includes('publickey') && identityKeys.length) {
			const identityKey = identityKeys.shift()!;

			if (identityKey.agentSupport) {
				return callback({ type: 'agent', username: sshUser });
			}
			if (identityKey.isPrivate) {
				return callback({ type: 'publickey', username: sshUser, key: 'mock' });
			}
			if (!identityKey.fileExists) {
				// FIXED: skip to next key
				continue;
			}
			if (!identityKey.parseable) {
				// FIXED: skip to next key
				continue;
			}

			return callback({ type: 'publickey', username: sshUser, key: 'mock' });
		}

		callback(false);
	};
}

suite('SSH Auth Handler', () => {

	suite('buggy handler (callback(null))', () => {

		test('passes null to callback when key file is missing', async () => {
			const handler = makeBuggyAuthHandler([
				{ filename: 'missing_key', fileExists: false, parseable: false },
			], 'testuser');

			// First call: methodsLeft=null -> none auth
			const results: any[] = [];
			await handler(null, false, (r) => results.push(r));
			assert.strictEqual(results[0]?.type, 'none');

			// Second call: methodsLeft=['publickey'] -> should try key
			results.length = 0;
			await handler(['publickey'], false, (r) => results.push(r));

			// BUG: returns null instead of false
			assert.strictEqual(results[0], null, 'Buggy handler should pass null to callback');
		});

		test('passes null when key is unparseable', async () => {
			const handler = makeBuggyAuthHandler([
				{ filename: 'bad_key', fileExists: true, parseable: false },
			], 'testuser');

			await handler(null, false, () => { });

			const results: any[] = [];
			await handler(['publickey'], false, (r) => results.push(r));

			assert.strictEqual(results[0], null, 'Buggy handler should pass null for unparseable key');
		});

		test('with single missing key, ssh2 would loop because callback(null) re-triggers handler', async () => {
			// Simulate what ssh2 does: call handler, if result is null, call again.
			// With the buggy handler, a single missing key gets shifted on first call,
			// then the second call sees no keys and returns false. But if the handler
			// didn't shift keys (e.g., due to a refactor), it would loop forever.
			const handler = makeBuggyAuthHandler([
				{ filename: 'missing', fileExists: false, parseable: false },
			], 'testuser');

			await handler(null, false, () => { });

			// First publickey attempt: shifts the key, returns null
			let result: any;
			await handler(['publickey'], false, (r) => { result = r; });
			assert.strictEqual(result, null);

			// ssh2 would call handler again because null !== false
			await handler(['publickey'], false, (r) => { result = r; });
			// Now identityKeys is empty, falls through to callback(false)
			assert.strictEqual(result, false);
		});
	});

	suite('fixed handler (while + continue)', () => {

		test('skips missing key and returns false in one call', async () => {
			const handler = makeFixedAuthHandler([
				{ filename: 'missing_key', fileExists: false, parseable: false },
			], 'testuser');

			await handler(null, false, () => { });

			const results: any[] = [];
			await handler(['publickey'], false, (r) => results.push(r));

			// FIXED: returns false (not null) in a single invocation
			assert.strictEqual(results[0], false, 'Fixed handler should return false, not null');
		});

		test('skips multiple bad keys and uses the first good one', async () => {
			const handler = makeFixedAuthHandler([
				{ filename: 'missing_key_1', fileExists: false, parseable: false },
				{ filename: 'unparseable_key', fileExists: true, parseable: false },
				{ filename: 'good_key', fileExists: true, parseable: true },
			], 'testuser');

			await handler(null, false, () => { });

			const results: any[] = [];
			await handler(['publickey'], false, (r) => results.push(r));

			// Should skip the first two and use the third
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0]?.type, 'publickey');
		});

		test('returns false when all keys are unusable', async () => {
			const handler = makeFixedAuthHandler([
				{ filename: 'missing_1', fileExists: false, parseable: false },
				{ filename: 'missing_2', fileExists: false, parseable: false },
				{ filename: 'bad_3', fileExists: true, parseable: false },
			], 'testuser');

			await handler(null, false, () => { });

			const results: any[] = [];
			await handler(['publickey'], false, (r) => results.push(r));

			assert.strictEqual(results[0], false, 'Should signal all methods exhausted');
		});

		test('never passes null to callback', async () => {
			const handler = makeFixedAuthHandler([
				{ filename: 'missing', fileExists: false, parseable: false },
				{ filename: 'bad', fileExists: true, parseable: false },
			], 'testuser');

			const allResults: any[] = [];
			const track = (r: any) => allResults.push(r);

			await handler(null, false, track);
			await handler(['publickey'], false, track);

			const nullResults = allResults.filter((r) => r === null);
			assert.strictEqual(
				nullResults.length, 0,
				`Fixed handler should never pass null to callback, got: ${JSON.stringify(allResults)}`
			);
		});

		test('still works with agent-supported keys', async () => {
			const handler = makeFixedAuthHandler([
				{ filename: 'missing', fileExists: false, parseable: false },
				{ filename: 'agent_key', fileExists: false, parseable: false, agentSupport: true },
			], 'testuser');

			await handler(null, false, () => { });

			const results: any[] = [];
			await handler(['publickey'], false, (r) => results.push(r));

			assert.strictEqual(results[0]?.type, 'agent');
		});

		test('still works with pre-parsed private keys', async () => {
			const handler = makeFixedAuthHandler([
				{ filename: 'missing', fileExists: false, parseable: false },
				{ filename: 'private_key', fileExists: false, parseable: false, isPrivate: true },
			], 'testuser');

			await handler(null, false, () => { });

			const results: any[] = [];
			await handler(['publickey'], false, (r) => results.push(r));

			assert.strictEqual(results[0]?.type, 'publickey');
		});
	});
});

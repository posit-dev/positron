/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isServerIdentityStale } from '../KallichoreAdapterApi';

suite('isServerIdentityStale', () => {
	test('a different live identity is stale', () => {
		// The original server is gone and something else now answers at the same
		// address, so the saved bearer token is stale.
		assert.strictEqual(isServerIdentityStale('server-a', 'server-b'), true);
	});

	test('a matching identity is not stale', () => {
		assert.strictEqual(isServerIdentityStale('server-a', 'server-a'), false);
	});

	test('a missing saved identity is not treated as stale', () => {
		// State saved before the server_id field existed; we cannot conclude the
		// connection is stale, so defer to the other liveness checks.
		assert.strictEqual(isServerIdentityStale(undefined, 'server-b'), false);
	});

	test('a missing live identity is not treated as stale', () => {
		// The live server is too old to report an identity; same deferral.
		assert.strictEqual(isServerIdentityStale('server-a', undefined), false);
	});

	test('both identities missing is not stale', () => {
		assert.strictEqual(isServerIdentityStale(undefined, undefined), false);
	});
});

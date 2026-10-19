/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { AuthRequest } from '../../../platform/remote/common/remoteAgentConnection.js';
import { resolveReconnectionInfo } from '../../node/reconnectionHandshake.js';

const fromUrl = { reconnectionToken: 'from-url', isReconnection: false };

function auth(extra: Partial<AuthRequest>): AuthRequest {
	return { type: 'auth', auth: '00000000000000000000', data: 'x', ...extra };
}

suite('PWB resolveReconnectionInfo', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('prefers the token and flag carried by the auth message', () => {
		const result = resolveReconnectionInfo(auth({ reconnectionToken: 'from-auth', reconnection: true }), fromUrl);
		assert.deepStrictEqual(result, { reconnectionToken: 'from-auth', isReconnection: true });
	});

	test('treats a message token without a reconnection flag as a fresh connection', () => {
		const result = resolveReconnectionInfo(auth({ reconnectionToken: 'from-auth' }), fromUrl);
		assert.deepStrictEqual(result, { reconnectionToken: 'from-auth', isReconnection: false });
	});

	test('falls back to the URL values when the message has no usable token', () => {
		const stale = { reconnectionToken: 'from-url', isReconnection: true };
		assert.strictEqual(resolveReconnectionInfo(auth({}), stale), stale);
		assert.strictEqual(resolveReconnectionInfo(auth({ reconnectionToken: '', reconnection: true }), stale), stale);
		assert.strictEqual(resolveReconnectionInfo(auth({ reconnectionToken: 42 as unknown as string }), stale), stale);
	});
});

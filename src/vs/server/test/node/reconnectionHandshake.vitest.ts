/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AuthRequest } from '../../../platform/remote/common/remoteAgentConnection.js';
import { resolveReconnectionInfo } from '../../node/reconnectionHandshake.js';

const fromUrl = { reconnectionToken: 'from-url', isReconnection: false };

function auth(extra: Partial<AuthRequest>): AuthRequest {
	return { type: 'auth', auth: '00000000000000000000', data: 'x', ...extra };
}

describe('resolveReconnectionInfo', () => {
	it('prefers the token and flag carried by the auth message', () => {
		const result = resolveReconnectionInfo(auth({ reconnectionToken: 'from-auth', reconnection: true }), fromUrl);
		expect(result).toEqual({ reconnectionToken: 'from-auth', isReconnection: true });
	});

	it('treats a message token without a reconnection flag as a fresh connection', () => {
		const result = resolveReconnectionInfo(auth({ reconnectionToken: 'from-auth' }), fromUrl);
		expect(result).toEqual({ reconnectionToken: 'from-auth', isReconnection: false });
	});

	it('falls back to the URL values when the message has no usable token', () => {
		const stale = { reconnectionToken: 'from-url', isReconnection: true };
		expect(resolveReconnectionInfo(auth({}), stale)).toBe(stale);
		expect(resolveReconnectionInfo(auth({ reconnectionToken: '', reconnection: true }), stale)).toBe(stale);
		expect(resolveReconnectionInfo(auth({ reconnectionToken: 42 as unknown as string }), stale)).toBe(stale);
	});
});

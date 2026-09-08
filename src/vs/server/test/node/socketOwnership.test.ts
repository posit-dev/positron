/* eslint-disable header/header */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as net from 'net';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { getListeningPortUid, isProcTcpAvailable, isProxyPortOwnershipEnforced, selectOwnerUid } from '../../node/socketOwnership.js';

// These helpers read /proc/net/tcp, which only exists on Linux.
(process.platform === 'linux' ? suite : suite.skip)('socketOwnership', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('getListeningPortUid returns our uid for a loopback listener and undefined for an unused port', async () => {
		const server = net.createServer();
		try {
			const port = await new Promise<number>((resolve, reject) => {
				server.on('error', reject);
				server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
			});

			assert.deepStrictEqual(
				{
					listenerUid: getListeningPortUid(port),
					unusedPort: getListeningPortUid(0),
				},
				{
					listenerUid: process.getuid!(),
					unusedPort: undefined,
				});
		} finally {
			await new Promise<void>(resolve => server.close(() => resolve()));
		}
	});

	test('getListeningPortUid ignores a listener bound only to a non-loopback address', async () => {
		// A /proxy/<port>/ request always dials http://0.0.0.0:<port>, which Linux's
		// ip_route_connect() rewrites to exactly 127.0.0.1 -- it can never reach a socket bound
		// solely to some other specific address, even if that socket is LISTENing on the same port
		// and even if that address is also loopback (127.0.0.0/8 is loopback, but only 127.0.0.1 is
		// the rewrite target).
		const server = net.createServer();
		try {
			const port = await new Promise<number>((resolve, reject) => {
				server.on('error', reject);
				server.listen(0, '127.0.0.2', () => resolve((server.address() as net.AddressInfo).port));
			});

			assert.strictEqual(getListeningPortUid(port), undefined);
		} finally {
			await new Promise<void>(resolve => server.close(() => resolve()));
		}
	});

	test('selectOwnerUid prefers an exact 127.0.0.1 match over a 0.0.0.0 wildcard match, regardless of entry order', () => {
		// Linux's __inet_lookup_listener() hashes on the destination address first and only falls
		// back to the wildcard/INADDR_ANY bucket if that exact lookup misses -- so if both a wildcard
		// and an exact-loopback listener exist on the same port, the exact-loopback one is who
		// actually receives a /proxy/<port>/ connection. That priority must not depend on which
		// /proc/net/tcp line happens to appear first (i.e. which process started listening first).
		const wildcard = { addressHex: '00000000', uid: 111 }; // 0.0.0.0
		const exactLoopback = { addressHex: '0100007F', uid: 222 }; // 127.0.0.1

		assert.deepStrictEqual(
			{
				wildcardFirst: selectOwnerUid([wildcard, exactLoopback]),
				exactFirst: selectOwnerUid([exactLoopback, wildcard]),
			},
			{
				wildcardFirst: 222,
				exactFirst: 222,
			});
	});

	test('capability probe and enforcement gating', () => {
		assert.deepStrictEqual(
			{
				available: isProcTcpAvailable(),
				enforcedForUser: isProxyPortOwnershipEnforced(process.getuid!()),
				enforcedForRoot: isProxyPortOwnershipEnforced(0),
			},
			{
				available: true,
				enforcedForUser: process.getuid!() !== 0,
				enforcedForRoot: false,
			});
	});
});

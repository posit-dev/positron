/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IPositronIdleTrackingService } from '../../common/positronIdleTracking.js';
import { PositronIdleTrackingChannel, PositronIdleTrackingChannelClient } from '../../common/positronIdleTrackingIpc.js';

suite('Positron - PositronIdleTrackingChannel (server-side)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let channel: PositronIdleTrackingChannel;
	let reportActivityCalls: number[];

	setup(() => {
		reportActivityCalls = [];

		const mockService: IPositronIdleTrackingService = {
			_serviceBrand: undefined,
			reportActivity(timestampMs) {
				reportActivityCalls.push(timestampMs);
			},
			getIdleInfo() {
				throw new Error('not expected in this test');
			},
		};

		channel = new PositronIdleTrackingChannel(mockService);
	});

	test('reportActivity delegates to service', async () => {
		await channel.call(undefined, 'reportActivity', { timestampMs: 12345 });

		assert.strictEqual(reportActivityCalls.length, 1);
		assert.strictEqual(reportActivityCalls[0], 12345);
	});

	test('unknown command throws', async () => {
		await assert.rejects(
			() => channel.call(undefined, 'bogusCommand'),
			/Command not found: bogusCommand/
		);
	});

	test('getIdleInfo is not exposed as an IPC command', async () => {
		await assert.rejects(
			() => channel.call(undefined, 'getIdleInfo'),
			/Command not found: getIdleInfo/
		);
	});

	test('listen throws', () => {
		assert.throws(
			() => channel.listen(undefined, 'someEvent'),
			/Method not implemented/
		);
	});
});

suite('Positron - PositronIdleTrackingChannelClient (client-side)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let client: PositronIdleTrackingChannelClient;
	let callLog: { command: string; arg: any }[];

	setup(() => {
		callLog = [];

		const mockChannel = {
			call<T>(command: string, arg?: any): Promise<T> {
				callLog.push({ command, arg });
				return Promise.resolve(undefined as unknown as T);
			},
			listen(): never {
				throw new Error('not expected');
			},
		};

		client = new PositronIdleTrackingChannelClient(mockChannel);
	});

	test('reportActivity sends correct command and args', async () => {
		await client.reportActivity(99999);

		assert.strictEqual(callLog.length, 1);
		assert.strictEqual(callLog[0].command, 'reportActivity');
		assert.deepStrictEqual(callLog[0].arg, { timestampMs: 99999 });
	});
});

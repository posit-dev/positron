/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { PositronIdleTrackingService } from '../../node/positronIdleTrackingService.js';

suite('Positron - PositronIdleTrackingService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let service: PositronIdleTrackingService;
	let constructionTime: number;

	setup(() => {
		constructionTime = Date.now();
		service = new PositronIdleTrackingService();
	});

	test('initial state has zero clients and falls back to server start time', () => {
		const info = service.getIdleInfo();
		assert.strictEqual(info.connectedClients, 0);
		// lastActivityEpochMs should be approximately the construction time
		assert.ok(info.lastActivityEpochMs >= constructionTime - 1);
		assert.ok(info.lastActivityEpochMs <= Date.now());
	});

	test('reportActivity tracks a single client', () => {
		const now = Date.now();
		service.reportActivity('client-1', now);

		const info = service.getIdleInfo();
		assert.strictEqual(info.connectedClients, 1);
		assert.strictEqual(info.lastActivityEpochMs, now);
		assert.strictEqual(info.secondsIdle, 0);
	});

	test('multiple clients are tracked independently', () => {
		const earlier = Date.now() - 5000;
		const later = Date.now();

		service.reportActivity('client-1', earlier);
		service.reportActivity('client-2', later);

		const info = service.getIdleInfo();
		assert.strictEqual(info.connectedClients, 2);
		// lastActivityEpochMs should reflect the most recent across all clients
		assert.strictEqual(info.lastActivityEpochMs, later);
	});

	test('ignores timestamps that go backward for the same client', () => {
		const later = Date.now();
		const earlier = later - 10000;

		service.reportActivity('client-1', later);
		service.reportActivity('client-1', earlier);

		const info = service.getIdleInfo();
		assert.strictEqual(info.lastActivityEpochMs, later);
	});

	test('accepts timestamps that move forward for the same client', () => {
		const earlier = Date.now() - 5000;
		const later = Date.now();

		service.reportActivity('client-1', earlier);
		service.reportActivity('client-1', later);

		const info = service.getIdleInfo();
		assert.strictEqual(info.lastActivityEpochMs, later);
	});

	test('removeClient decrements connectedClients', () => {
		service.reportActivity('client-1', Date.now());
		service.reportActivity('client-2', Date.now());
		assert.strictEqual(service.getIdleInfo().connectedClients, 2);

		service.removeClient('client-1');
		assert.strictEqual(service.getIdleInfo().connectedClients, 1);
	});

	test('removing all clients falls back to server start time', () => {
		const activityTime = Date.now();
		service.reportActivity('client-1', activityTime);
		service.removeClient('client-1');

		const info = service.getIdleInfo();
		assert.strictEqual(info.connectedClients, 0);
		// After removing all clients, lastActivityEpochMs reverts to server start
		assert.ok(info.lastActivityEpochMs <= activityTime);
		assert.ok(info.lastActivityEpochMs >= constructionTime - 1);
	});

	test('removing a non-existent client is a no-op', () => {
		service.reportActivity('client-1', Date.now());
		service.removeClient('non-existent');

		assert.strictEqual(service.getIdleInfo().connectedClients, 1);
	});

	test('secondsIdle is zero immediately after activity', () => {
		service.reportActivity('client-1', Date.now());

		const info = service.getIdleInfo();
		assert.strictEqual(info.secondsIdle, 0);
	});

	test('secondsIdle is consistent with lastActivityEpochMs', () => {
		// Report activity and verify the relationship between fields
		service.reportActivity('client-1', Date.now());
		const info = service.getIdleInfo();

		const expectedIdle = Math.floor((Date.now() - info.lastActivityEpochMs) / 1000);
		assert.ok(
			Math.abs(info.secondsIdle - expectedIdle) <= 1,
			`secondsIdle (${info.secondsIdle}) should be close to computed value (${expectedIdle})`
		);
	});

	test('ignores duplicate timestamps for the same client', () => {
		const ts = Date.now();
		service.reportActivity('client-1', ts);
		service.reportActivity('client-1', ts); // same timestamp

		const info = service.getIdleInfo();
		assert.strictEqual(info.connectedClients, 1);
		assert.strictEqual(info.lastActivityEpochMs, ts);
	});

	test('secondsIdle is never negative even with future timestamps', () => {
		const futureTime = Date.now() + 60000; // 60 seconds in the future
		service.reportActivity('client-1', futureTime);

		const info = service.getIdleInfo();
		assert.strictEqual(info.secondsIdle, 0);
	});

	test('lastActivityEpochMs reflects only remaining clients after removal', () => {
		// Use timestamps after server start so they override the _serverStartMs floor
		const olderTime = Date.now() + 10000;
		const newerTime = Date.now() + 20000;

		service.reportActivity('client-old', olderTime);
		service.reportActivity('client-new', newerTime);

		// Remove the newer client
		service.removeClient('client-new');

		const info = service.getIdleInfo();
		assert.strictEqual(info.connectedClients, 1);
		assert.strictEqual(info.lastActivityEpochMs, olderTime);
	});
});

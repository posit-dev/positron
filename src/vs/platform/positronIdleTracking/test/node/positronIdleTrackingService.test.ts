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

	test('initial state falls back to construction time', () => {
		const info = service.getIdleInfo();
		assert.ok(info.lastActivityEpochMs >= constructionTime - 1);
		assert.ok(info.lastActivityEpochMs <= Date.now());
	});

	test('reportActivity advances the tracked timestamp', () => {
		const now = Date.now();
		service.reportActivity(now);

		const info = service.getIdleInfo();
		assert.strictEqual(info.lastActivityEpochMs, now);
		assert.strictEqual(info.secondsIdle, 0);
	});

	test('ignores timestamps that go backward', () => {
		const later = Date.now();
		const earlier = later - 10000;

		service.reportActivity(later);
		service.reportActivity(earlier);

		const info = service.getIdleInfo();
		assert.strictEqual(info.lastActivityEpochMs, later);
	});

	test('accepts timestamps that move forward', () => {
		const earlier = Date.now();
		const later = earlier + 5000;

		service.reportActivity(earlier);
		service.reportActivity(later);

		const info = service.getIdleInfo();
		assert.strictEqual(info.lastActivityEpochMs, later);
	});

	test('ignores duplicate timestamps', () => {
		const ts = Date.now();
		service.reportActivity(ts);
		service.reportActivity(ts);

		const info = service.getIdleInfo();
		assert.strictEqual(info.lastActivityEpochMs, ts);
	});

	test('takes the most recent across multiple calls', () => {
		const earlier = Date.now() + 1000;
		const later = Date.now() + 2000;

		// Simulate two clients reporting interleaved
		service.reportActivity(earlier);
		service.reportActivity(later);
		service.reportActivity(earlier); // stale report from "client A" ignored

		const info = service.getIdleInfo();
		assert.strictEqual(info.lastActivityEpochMs, later);
	});

	test('secondsIdle is zero immediately after activity', () => {
		service.reportActivity(Date.now());

		const info = service.getIdleInfo();
		assert.strictEqual(info.secondsIdle, 0);
	});

	test('secondsIdle is consistent with lastActivityEpochMs', () => {
		service.reportActivity(Date.now());
		const info = service.getIdleInfo();

		const expectedIdle = Math.floor((Date.now() - info.lastActivityEpochMs) / 1000);
		assert.ok(
			Math.abs(info.secondsIdle - expectedIdle) <= 1,
			`secondsIdle (${info.secondsIdle}) should be close to computed value (${expectedIdle})`
		);
	});

	test('secondsIdle is never negative with future timestamps', () => {
		const futureTime = Date.now() + 60000;
		service.reportActivity(futureTime);

		const info = service.getIdleInfo();
		assert.strictEqual(info.secondsIdle, 0);
	});
});

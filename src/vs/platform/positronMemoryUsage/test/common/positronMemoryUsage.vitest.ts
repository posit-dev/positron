/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { computeLowMemoryStatus, LowMemoryUnit } from '../../common/positronMemoryUsage.js';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

describe('computeLowMemoryStatus', () => {
	const total = 16 * GB;

	it('returns undefined when free memory is above both thresholds', () => {
		// 50% free, both thresholds configured.
		const status = computeLowMemoryStatus(8 * GB, total, { percent: 5, megabytes: 500 });
		expect(status).toBeUndefined();
	});

	it('reports the percentage unit when the percent threshold is reached', () => {
		// 4% free, below the 5% threshold; no megabyte threshold.
		const status = computeLowMemoryStatus(0.04 * total, total, { percent: 5, megabytes: 0 });
		expect(status).toEqual({ unit: LowMemoryUnit.Percent, threshold: 5, remaining: 4 });
	});

	it('reports the megabyte unit when only the megabyte threshold is reached', () => {
		// 100 MB free: above 5% (which is ~819 MB) is false here, so percent also
		// triggers -- use a high total so percent does not trip but MB does.
		const bigTotal = 100 * GB;
		const status = computeLowMemoryStatus(100 * MB, bigTotal, { percent: 0, megabytes: 200 });
		expect(status).toEqual({ unit: LowMemoryUnit.Megabytes, threshold: 200, remaining: 100 });
	});

	it('reports the percentage when both thresholds are reached', () => {
		// 100 MB free out of 16 GB: well below 5% and below 200 MB; percent wins.
		const status = computeLowMemoryStatus(100 * MB, total, { percent: 5, megabytes: 200 });
		expect(status?.unit).toBe(LowMemoryUnit.Percent);
	});

	it('triggers exactly at the threshold (<=)', () => {
		const status = computeLowMemoryStatus(0.05 * total, total, { percent: 5 });
		expect(status).toEqual({ unit: LowMemoryUnit.Percent, threshold: 5, remaining: 5 });
	});

	it('treats a zero or undefined threshold as disabled', () => {
		expect(computeLowMemoryStatus(1 * MB, total, { percent: 0, megabytes: 0 })).toBeUndefined();
		expect(computeLowMemoryStatus(1 * MB, total, {})).toBeUndefined();
	});

	it('treats zero total memory as not low', () => {
		expect(computeLowMemoryStatus(0, 0, { percent: 5, megabytes: 100 })).toBeUndefined();
	});
});

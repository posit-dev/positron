/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test, vi } from 'vitest';
import { createMetricPayload, PerfMetric } from './api.js';

// createMetricPayload's `ark` parameter defaults to this module's `arkVersion`
// constant, which is a real value whenever the checkout has an ark sidecar
// (see ark-version.ts's checkout fallback) -- including this repo, while these
// tests run. Forced to undefined here so 'omits ark_version when the build
// reported none' exercises the no-ark path regardless of what this checkout
// happens to have installed.
vi.mock('./metric-base.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./metric-base.js')>();
	return { ...actual, arkVersion: undefined };
});

const metric: PerfMetric = {
	feature_area: 'data_explorer',
	action: 'load_data',
	target_type: 'file.parquet',
	duration_ms: 1234,
	context_json: { data_rows: 1000, data_cols: 12 }
};

const contextOf = (payload: { context: string }) => JSON.parse(payload.context);

describe('createMetricPayload', () => {
	// An ark bump moves Performance Trends and nothing on the chart attributes it.
	// Set here rather than at a shortcut's call site because the API promotes this
	// field for every feature area: on `sessions` rows only, the marker would
	// disappear as soon as a reader filtered to another area.
	test('merges the ark version into the serialized context', () => {
		const payload = createMetricPayload(metric, true, '0.1.252+209.885fac4');
		expect(contextOf(payload).ark_version).toBe('0.1.252+209.885fac4');
	});

	test('keeps the context the caller supplied', () => {
		const payload = createMetricPayload(metric, true, '0.1.252+209.885fac4');
		expect(contextOf(payload)).toMatchObject({ data_rows: 1000, data_cols: 12 });
	});

	test('works for a metric that supplied no context at all', () => {
		const payload = createMetricPayload({ ...metric, context_json: undefined }, true, '0.1.252+209.885fac4');
		expect(contextOf(payload)).toEqual({ ark_version: '0.1.252+209.885fac4' });
	});

	// Omitted rather than 'unknown'. The dashboard already skips 'unknown' in
	// CHART_MARKER_SKIP_VALUES, but writing one would still put a literal string
	// into a column the API promotes and a query could group on.
	test('omits ark_version when the build reported none', () => {
		const payload = createMetricPayload(metric, true, undefined);
		expect(contextOf(payload)).not.toHaveProperty('ark_version');
	});

	test('lets an explicit caller-supplied ark_version win', () => {
		const payload = createMetricPayload(
			{ ...metric, context_json: { ark_version: '0.1.100+1.deadbee' } }, true, '0.1.252+209.885fac4');
		expect(contextOf(payload).ark_version).toBe('0.1.100+1.deadbee');
	});

	test('leaves the rest of the payload alone', () => {
		const payload = createMetricPayload(metric, true, '0.1.252+209.885fac4');
		expect(payload.feature_area).toBe('data_explorer');
		expect(payload.action).toBe('load_data');
		expect(payload.duration_ms).toBe(1234);
		expect(payload.runtime_env).toBe('electron');
		expect(payload.status).toBe('success');
	});
});

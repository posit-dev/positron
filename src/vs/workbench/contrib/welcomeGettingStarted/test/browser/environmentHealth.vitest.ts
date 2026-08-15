/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { HEALTH_SOURCES, isEnvironmentHealthResult } from '../../browser/positronWelcomePage/environmentHealth.js';

describe('isEnvironmentHealthResult', () => {
	const item = { id: 'discovery', status: 'pass', summary: 'Positron can discover Python environments' };

	it('accepts a well formed result', () => {
		expect(isEnvironmentHealthResult({ ok: true, items: [item] })).toBe(true);
	});

	it('ignores per-language extras it does not read', () => {
		// Python adds interpreterPath, R adds rBinPath and rHome. Rejecting a
		// payload for carrying them would break on every real result.
		expect(isEnvironmentHealthResult({ ok: true, items: [item], interpreterPath: '/usr/bin/python3' })).toBe(true);
	});

	it('rejects an empty item list', () => {
		// The collapse rule uses items.every(...), which is true for [], so an
		// empty list would render "You have successfully set up Python".
		expect(isEnvironmentHealthResult({ ok: true, items: [] })).toBe(false);
	});

	it.each([
		['not an object', 42],
		['null', null],
		['no items', { ok: true }],
		['items not an array', { ok: true, items: 'nope' }],
		['ok not a boolean', { ok: 'yes', items: [item] }],
		['an item missing summary', { ok: true, items: [{ id: 'discovery', status: 'pass' }] }],
		['an item with an unknown status', { ok: true, items: [{ ...item, status: 'exploded' }] }],
	])('rejects %s', (_label, value) => {
		expect(isEnvironmentHealthResult(value)).toBe(false);
	});
});

describe('HEALTH_SOURCES', () => {
	it('lists python then r, with the ids the tracker calls', () => {
		expect(HEALTH_SOURCES.map(s => [s.language, s.extensionId, s.commandId])).toEqual([
			['python', 'ms-python.python', 'python.getEnvironmentHealth'],
			['r', 'positron.positron-r', 'r.getEnvironmentHealth'],
		]);
	});
});

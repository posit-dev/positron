/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ggsqlHonorsAccessMode } from './ggsqlAccessMode';

describe('ggsqlHonorsAccessMode', () => {
	test.each([
		['0.4.9', false],
		['0.5.1', false],
		['0.5.2', false],
		['0.5.3', true],
		['0.6.0', true],
		['0.6.0-dev.1', true],
		['1.0.0', true],
	])('%s -> %s', (version, expected) => {
		expect(ggsqlHonorsAccessMode(version)).toBe(expected);
	});

	test('an unknown version counts as old', () => {
		expect(ggsqlHonorsAccessMode(undefined)).toBe(false);
		expect(ggsqlHonorsAccessMode('')).toBe(false);
		expect(ggsqlHonorsAccessMode('dev')).toBe(false);
	});
});

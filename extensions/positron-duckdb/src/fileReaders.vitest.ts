/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { findFileReader, parseFileReader } from './fileReaders';

describe('parseFileReader', () => {
	it('fills in the default repository and function', () => {
		expect(parseFileReader('read_stat')).toEqual({ repo: 'community', extension: 'read_stat', fn: 'read_stat' });
	});

	it('reads an explicit repository and function', () => {
		expect(parseFileReader('core/spatial:st_read')).toEqual({ repo: 'core', extension: 'spatial', fn: 'st_read' });
		expect(parseFileReader('community/orc:read_orc')).toEqual({ repo: 'community', extension: 'orc', fn: 'read_orc' });
	});

	it.each([
		'',
		'Read_Stat',
		'nightly/read_stat',
		'https://example.com/read_stat',
		'read_stat:',
		'read_stat; DROP TABLE x',
		`read_stat'`,
		42,
		undefined,
	])('rejects %j', value => {
		expect(parseFileReader(value)).toBeUndefined();
	});
});

describe('findFileReader', () => {
	const readers = { xpt: 'read_stat', shp: 'core/spatial:st_read', dta: '' };

	it('matches extensions with or without the dot, in any case', () => {
		expect(findFileReader(readers, '.XPT')?.extension).toBe('read_stat');
		expect(findFileReader(readers, 'shp')?.fn).toBe('st_read');
	});

	it('returns undefined for unmapped, disabled, or inherited keys', () => {
		expect(findFileReader(readers, '.csv')).toBeUndefined();
		expect(findFileReader(readers, '.dta')).toBeUndefined();
		expect(findFileReader(readers, '.constructor')).toBeUndefined();
	});

	it('returns undefined when the setting is not an object', () => {
		expect(findFileReader(undefined, '.xpt')).toBeUndefined();
		expect(findFileReader('read_stat', '.xpt')).toBeUndefined();
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { deriveVariableName, isValidVariableName } from '../../importDataVariableName.js';

describe('deriveVariableName', () => {
	it('strips the extension', () => {
		expect(deriveVariableName('flights.csv')).toBe('flights');
	});

	it('replaces characters that cannot appear in an identifier', () => {
		expect(deriveVariableName('my data-2020.tsv')).toBe('my_data_2020');
	});

	it('keeps only the final extension', () => {
		expect(deriveVariableName('flights.2020.csv')).toBe('flights_2020');
	});

	it('prefixes a name that would start with a digit', () => {
		expect(deriveVariableName('2020 data.csv')).toBe('_2020_data');
	});

	it('trims leading and trailing underscores left by sanitizing', () => {
		expect(deriveVariableName('--flights--.csv')).toBe('flights');
	});

	it('falls back to a generic name when nothing usable is left', () => {
		expect(deriveVariableName('.csv')).toBe('data');
	});

	it('suffixes a name that would be a Python keyword', () => {
		expect(deriveVariableName('class.csv')).toBe('class_');
	});

	it('leaves a soft keyword alone, because it is a valid identifier', () => {
		expect(deriveVariableName('match.csv')).toBe('match');
	});
});

describe('isValidVariableName', () => {
	it.each([
		['flights', true],
		['_flights', true],
		['flights2', true],
		['2020data', false],
		['my data', false],
		['my-data', false],
		['', false],
		['class', false],
		['match', true],
	])('%s -> %s', (name, expected) => {
		expect(isValidVariableName(name)).toBe(expected);
	});
});

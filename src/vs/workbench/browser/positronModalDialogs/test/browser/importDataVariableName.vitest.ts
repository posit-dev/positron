/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { deriveVariableName } from '../../importDataVariableName.js';

// Representative reserved lists, shaped like the ones the pandas and readr importers register. The
// real lists live in those extensions; these exercise the derivation, not the extensions' data.
const PYTHON_RESERVED = ['class', 'import', 'False', 'in'];
const R_RESERVED = ['if', 'TRUE', 'NA', 'in'];

describe('deriveVariableName', () => {
	it('strips the extension and keeps a clean name', () => {
		expect(deriveVariableName('flights.csv', PYTHON_RESERVED)).toBe('flights');
		expect(deriveVariableName('flights.csv', R_RESERVED)).toBe('flights');
	});

	it('collapses each run of rejected characters into a single underscore', () => {
		expect(deriveVariableName('my data-file.csv', PYTHON_RESERVED)).toBe('my_data_file');
		expect(deriveVariableName('a...b.csv', PYTHON_RESERVED)).toBe('a_b');
	});

	it('keeps digits after the first letter', () => {
		expect(deriveVariableName('census 2020.csv', R_RESERVED)).toBe('census_2020');
	});

	it('sanitizes non-ASCII letters, which the two languages disagree about', () => {
		// 'donn\u00e9es.csv' spelled with an escape so this file stays ASCII.
		expect(deriveVariableName('donn\u00e9es.csv', PYTHON_RESERVED)).toBe('donn_es');
	});

	it('drops everything before the first letter, including a leading digit', () => {
		expect(deriveVariableName('2020 data.csv', PYTHON_RESERVED)).toBe('data');
		expect(deriveVariableName('__flights.csv', PYTHON_RESERVED)).toBe('flights');
	});

	it('falls back to dataset when no letter survives', () => {
		expect(deriveVariableName('2020.csv', R_RESERVED)).toBe('dataset');
		expect(deriveVariableName('20240101.csv', R_RESERVED)).toBe('dataset');
		expect(deriveVariableName('.csv', R_RESERVED)).toBe('dataset');
		expect(deriveVariableName('....csv', R_RESERVED)).toBe('dataset');
	});

	it('suffixes a reserved word rather than prefixing it', () => {
		expect(deriveVariableName('class.csv', PYTHON_RESERVED)).toBe('class_');
		expect(deriveVariableName('if.csv', R_RESERVED)).toBe('if_');
		expect(deriveVariableName('NA.csv', R_RESERVED)).toBe('NA_');
	});

	it('suffixes only where the word is reserved', () => {
		// 'class' is assignable in R and 'NA' is assignable in Python, so each importer's list
		// leaves the other language's keyword alone.
		expect(deriveVariableName('class.csv', R_RESERVED)).toBe('class');
		expect(deriveVariableName('NA.csv', PYTHON_RESERVED)).toBe('NA');
	});

	it('suffixes repeatedly when the suffixed name is itself reserved', () => {
		expect(deriveVariableName('x.csv', ['x', 'x_'])).toBe('x__');
	});

	it('derives a name without reserved words when an importer supplies no list', () => {
		expect(deriveVariableName('flights.csv')).toBe('flights');
		expect(deriveVariableName('class.csv')).toBe('class');
	});

	it('always derives an assignable identifier', () => {
		// The shape every caller depends on, and the reason the dialog does not validate: an ASCII
		// letter, then ASCII letters, digits and underscores, and never a reserved word.
		const fileNames = [
			'flights.csv', '2020 data.csv', 'class.csv', 'if.csv', 'NA.csv', '.csv', '2020.csv',
			'a b c.tsv', 'donn\u00e9es.csv', 'a\u00b2.csv', '---.csv', 'my.data.csv', 'in.csv',
		];
		for (const reserved of [PYTHON_RESERVED, R_RESERVED]) {
			for (const fileName of fileNames) {
				const derived = deriveVariableName(fileName, reserved);
				expect(derived).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
				expect(reserved).not.toContain(derived);
			}
		}
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import { escapeRString, generateReadrImportCode, R_RESERVED_NAMES } from '../data-import';

suite('generateReadrImportCode', () => {
	test('generates a read_csv call with the comment directly above it', () => {
		assert.strictEqual(
			generateReadrImportCode({
				filePath: '/Users/austin/data/flights.csv',
				variableName: 'flights',
				hasHeaderRow: true,
			}),
			[
				'library(readr)',
				'',
				'# Load flights data',
				'flights <- read_csv("/Users/austin/data/flights.csv")',
				'',
			].join('\n')
		);
	});

	test('uses read_tsv for a tab-separated file', () => {
		const code = generateReadrImportCode({ filePath: '/data/flights.tsv', variableName: 'flights' });
		assert.ok(code.includes('flights <- read_tsv("/data/flights.tsv")'));
		assert.ok(!code.includes('read_csv'));
	});

	test('adds col_names = FALSE when the header row is off', () => {
		const code = generateReadrImportCode({ filePath: '/data/flights.csv', variableName: 'flights', hasHeaderRow: false });
		assert.ok(code.includes('read_csv("/data/flights.csv", col_names = FALSE)'));
	});

	test('treats an absent hasHeaderRow as a header row', () => {
		const code = generateReadrImportCode({ filePath: '/data/flights.csv', variableName: 'flights' });
		assert.ok(!code.includes('col_names'));
	});

	test('escapes Windows backslashes and quotes in the path', () => {
		const code = generateReadrImportCode({ filePath: 'C:\\data\\a"b.csv', variableName: 'x' });
		assert.ok(code.includes('read_csv("C:\\\\data\\\\a\\"b.csv")'));
	});
});

suite('escapeRString', () => {
	test('escapes control characters so the literal stays on one line', () => {
		assert.strictEqual(escapeRString('a\nb\tc\u0001d'), 'a\\nb\\tc\\x01d');
	});
});

suite('R_RESERVED_NAMES', () => {
	test('lists the words R will not assign to', () => {
		// Positron suffixes a derived default that collides with one of these, so a missing entry
		// means a file named for it is offered as code that will not run.
		for (const reserved of ['if', 'else', 'repeat', 'while', 'function', 'for', 'next', 'break',
			'in', 'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA', 'NA_integer_', 'NA_real_',
			'NA_complex_', 'NA_character_', '...']) {
			assert.ok(R_RESERVED_NAMES.includes(reserved), `missing ${reserved}`);
		}
	});

	test('leaves T and F out, which are ordinary variables in R', () => {
		assert.ok(!R_RESERVED_NAMES.includes('T'));
		assert.ok(!R_RESERVED_NAMES.includes('F'));
	});
});

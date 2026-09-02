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
				pathLiteral: '"data/flights.csv"',
				variableName: 'flights',
				hasHeaderRow: true,
			}).code,
			[
				'library(readr)',
				'',
				'# Load flights data',
				'flights <- read_csv("data/flights.csv")',
				'',
			].join('\n')
		);
	});

	test('uses read_tsv for a tab-separated file', () => {
		const code = generateReadrImportCode({ pathLiteral: '"data/flights.tsv"', variableName: 'flights' }).code;
		assert.ok(code.includes('flights <- read_tsv("data/flights.tsv")'));
		assert.ok(!code.includes('read_csv'));
	});

	test('adds col_names = FALSE when the header row is off', () => {
		const code = generateReadrImportCode({ pathLiteral: '"data/flights.csv"', variableName: 'flights', hasHeaderRow: false }).code;
		assert.ok(code.includes('read_csv("data/flights.csv", col_names = FALSE)'));
	});

	test('treats an absent hasHeaderRow as a header row', () => {
		const code = generateReadrImportCode({ pathLiteral: '"data/flights.csv"', variableName: 'flights' }).code;
		assert.ok(!code.includes('col_names'));
	});

	test('embeds the pre-formatted path literal verbatim, without re-escaping it', () => {
		// The literal comes from positron.paths.formatPathForCode, already quoted and escaped.
		const code = generateReadrImportCode({ pathLiteral: '"C:/data/a\\"b.csv"', variableName: 'x' }).code;
		assert.ok(code.includes('read_csv("C:/data/a\\"b.csv")'));
	});
});

suite('generateReadrImportCode view translation', () => {
	const base = {
		pathLiteral: '"data/flights.csv"',
		variableName: 'flights',
		hasHeaderRow: true,
	};
	const emptyView = { rowFilters: [], sortKeys: [] };

	test('translates a compare filter and a descending sort with dplyr', () => {
		const result = generateReadrImportCode({
			...base,
			view: {
				...emptyView,
				rowFilters: [{
					columnName: 'carrier', columnType: 'string', condition: 'and' as const,
					filterType: 'compare' as const, op: '=' as const, value: 'UA',
				}],
				sortKeys: [{ columnName: 'dep_delay', ascending: false }],
			},
		});

		assert.deepStrictEqual(result.unsupported, []);
		assert.strictEqual(
			result.code,
			[
				'library(readr)',
				'library(dplyr)',
				'',
				'# Load flights data',
				'flights <- read_csv("data/flights.csv")',
				'',
				'# Filter and sort as shown in the Data Explorer',
				'flights <- flights |>',
				'  filter(carrier == "UA") |>',
				'  arrange(desc(dep_delay))',
				'',
			].join('\n')
		);
	});

	test('joins filters with & and | per each filter\'s condition and translates the type variants', () => {
		const result = generateReadrImportCode({
			...base,
			view: {
				...emptyView,
				rowFilters: [
					{
						columnName: 'dep_delay', columnType: 'integer', condition: 'and' as const,
						filterType: 'between' as const, leftValue: '10', rightValue: '60',
					},
					{
						columnName: 'carrier', columnType: 'string', condition: 'or' as const,
						filterType: 'set_membership' as const, values: ['UA', 'AA'], inclusive: false,
					},
					{
						columnName: 'name', columnType: 'string', condition: 'and' as const,
						filterType: 'search' as const, searchType: 'contains' as const,
						term: 'Mc', caseSensitive: false,
					},
					{
						columnName: 'note', columnType: 'string', condition: 'and' as const,
						filterType: 'not_null' as const,
					},
				],
			},
		});

		assert.deepStrictEqual(result.unsupported, []);
		assert.ok(result.code.includes(
			'filter(between(dep_delay, 10, 60)'
			+ ' | (!is.na(carrier) & !(carrier %in% c("UA", "AA")))'
			+ ' & grepl("mc", tolower(name), fixed = TRUE)'
			+ ' & !is.na(note))'
		));
	});

	test('excludes NA rows from a negated text search, as the backend does', () => {
		const result = generateReadrImportCode({
			...base,
			view: {
				...emptyView,
				rowFilters: [{
					columnName: 'note', columnType: 'string', condition: 'and' as const,
					filterType: 'search' as const, searchType: 'not_contains' as const,
					term: 'delay', caseSensitive: true,
				}],
			},
		});

		assert.deepStrictEqual(result.unsupported, []);
		assert.ok(result.code.includes(
			'filter((!is.na(note) & !grepl("delay", note, fixed = TRUE)))'
		));
	});

	test('backticks a non-syntactic column name', () => {
		const result = generateReadrImportCode({
			...base,
			view: {
				...emptyView,
				sortKeys: [{ columnName: 'dep delay', ascending: true }],
			},
		});

		assert.ok(result.code.includes('arrange(`dep delay`)'));
	});

	test('backticks a dotted name followed by a digit, which R does not accept bare', () => {
		const result = generateReadrImportCode({
			...base,
			view: {
				...emptyView,
				sortKeys: [
					{ columnName: '.2foo', ascending: true },
					{ columnName: '.foo', ascending: true },
				],
			},
		});

		assert.ok(result.code.includes('arrange(`.2foo`, .foo)'));
	});

	test('reports an untypeable value as unsupported', () => {
		const result = generateReadrImportCode({
			...base,
			view: {
				...emptyView,
				rowFilters: [{
					columnName: 'dep_delay', columnType: 'integer', condition: 'and' as const,
					filterType: 'compare' as const, op: '>' as const, value: 'thirty',
				}],
			},
		});

		assert.deepStrictEqual(result.unsupported, ['filter on "dep_delay" (compare)']);
		assert.ok(!result.code.includes('filter('));
	});

	test('reports a compare filter on a non-string, non-numeric, non-boolean column type as unsupported', () => {
		const result = generateReadrImportCode({
			...base,
			view: {
				...emptyView,
				rowFilters: [{
					columnName: 'flight_date', columnType: 'date', condition: 'and' as const,
					filterType: 'compare' as const, op: '>' as const, value: '2024-01-01',
				}],
			},
		});

		assert.deepStrictEqual(result.unsupported, ['filter on "flight_date" (compare)']);
		assert.ok(!result.code.includes('2024-01-01'));
	});

	test('reports the whole view as unsupported when the file has no header row', () => {
		const result = generateReadrImportCode({
			...base,
			hasHeaderRow: false,
			view: {
				...emptyView,
				sortKeys: [{ columnName: 'column0', ascending: true }],
			},
		});

		assert.strictEqual(result.unsupported.length, 1);
		assert.ok(result.unsupported[0].includes('header'));
		assert.ok(!result.code.includes('arrange'));
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

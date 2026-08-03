/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { detectQuoteStyle, quoteIdentifierAs, resolveQuoteStyle } from '../adbcDialect.js';
import { parseQuoteSetting } from '../adbcDriver.js';

suite('ADBC Dialect Tests', () => {
	suite('detectQuoteStyle', () => {
		test('detects the backtick family from the vendor name', () => {
			const vendors: Array<[string, string]> = [
				['Databricks', 'backtick'],
				['Spark SQL', 'backtick'],
				['MySQL', 'backtick'],
				['BigQuery', 'backtick'],
				['Microsoft SQL Server', 'bracket'],
				['PostgreSQL', 'ansi'],
				['SQLite', 'ansi'],
				['Snowflake', 'ansi'],
				['Trino', 'ansi'],
			];
			assert.deepStrictEqual(
				vendors.map(([vendorName]) => [vendorName, detectQuoteStyle({ vendorName })]),
				vendors);
		});

		test('falls back to the configured driver when the driver reports nothing', () => {
			// GetInfo is optional in ADBC, so a short name or manifest path may be all we have.
			assert.deepStrictEqual(
				[
					detectQuoteStyle({ configuredDriver: 'databricks' }),
					detectQuoteStyle({ configuredDriver: '/Users/x/Library/Application Support/ADBC/Drivers/databricks.toml' }),
					detectQuoteStyle({ configuredDriver: 'sqlite' }),
					detectQuoteStyle({}),
				],
				['backtick', 'backtick', 'ansi', 'ansi']);
		});

		test('matches case-insensitively across all hint sources', () => {
			assert.strictEqual(detectQuoteStyle({ driverName: 'ADBC DATABRICKS Driver' }), 'backtick');
		});

		test('defaults to the SQL standard for an unknown engine', () => {
			// Guessing ANSI fails loudly on a backtick engine rather than silently comparing
			// against a string literal, so it is the safer default.
			assert.strictEqual(detectQuoteStyle({ vendorName: 'Some New Warehouse' }), 'ansi');
		});
	});

	suite('quoteIdentifierAs', () => {
		test('quotes and escapes per style', () => {
			const name = 'odd "name` with ]brackets';
			assert.deepStrictEqual(
				{
					ansi: quoteIdentifierAs(name, 'ansi'),
					backtick: quoteIdentifierAs(name, 'backtick'),
					bracket: quoteIdentifierAs(name, 'bracket'),
				},
				{
					ansi: '"odd ""name` with ]brackets"',
					backtick: '`odd "name`` with ]brackets`',
					bracket: '[odd "name` with ]]brackets]',
				});
		});
	});

	suite('resolveQuoteStyle', () => {
		test('an explicit setting overrides detection', () => {
			// The escape hatch for an engine detection has not learned about.
			assert.strictEqual(resolveQuoteStyle('ansi', { vendorName: 'Databricks' }), 'ansi');
			assert.strictEqual(resolveQuoteStyle('backtick', { vendorName: 'PostgreSQL' }), 'backtick');
		});

		test('auto defers to detection', () => {
			assert.strictEqual(resolveQuoteStyle('auto', { vendorName: 'Databricks' }), 'backtick');
		});
	});

	suite('parseQuoteSetting', () => {
		test('accepts the known settings and treats anything else as auto', () => {
			assert.deepStrictEqual(
				['ansi', 'backtick', 'bracket', 'auto', 'nonsense', undefined, 42].map(parseQuoteSetting),
				['ansi', 'backtick', 'bracket', 'auto', 'auto', 'auto', 'auto']);
		});
	});
});

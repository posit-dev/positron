/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Covers positron-data-explorer-formatting, which every Data Explorer driver shares. The tests live
// in this extension's suite because a build-time-only package has no suite of its own, and this one
// already runs in CI (scripts/test-integration.sh).

import * as assert from 'assert';
import { ColumnDisplayType, FormatOptions } from 'positron-data-explorer-protocol';
import { formatDecimal, formatFloat, formatNumericStat, isDecimalLiteral, isIntegerLiteral } from 'positron-data-explorer-formatting';

// The options the Data Explorer actually sends (see languageRuntimeDataExplorerClient.ts): two
// digits for a value at or above 1, four below it, and exponential notation past seven integral
// digits.
const DISPLAY: FormatOptions = {
	large_num_digits: 2,
	small_num_digits: 4,
	max_integral_digits: 7,
	max_value_length: 1000,
	thousands_sep: '',
};

// The same options with room for a wide integral part. The exact digits of a DECIMAL(38,2) are only
// visible when the options allow that many, so this is what the "keeps every digit" cases use.
const WIDE: FormatOptions = { ...DISPLAY, max_integral_digits: 40 };

const SEPARATED: FormatOptions = { ...DISPLAY, thousands_sep: ',' };

suite('Shared Decimal Formatting', () => {

	test('a value wider than a double keeps every digit', () => {
		const values = [
			'123456789012345678901234567890.12',
			'9007199254740993.01',
			'-9007199254740993.01',
			// Rounding carries all the way into the integral part.
			'9007199254740992.999',
		];

		assert.deepStrictEqual(values.map(v => formatDecimal(v, WIDE)), [
			'123456789012345678901234567890.12',
			'9007199254740993.01',
			'-9007199254740993.01',
			'9007199254740993.00',
		]);
		// What the same values used to render as, when they were coerced to a double first: the wide
		// one collapses into exponential notation, and the ones near 2^53 land on the wrong digits.
		assert.deepStrictEqual(values.map(v => formatFloat(Number(v), WIDE)), [
			'1.2345678901234568e+29',
			'9007199254740994.00',
			'-9007199254740994.00',
			'9007199254740992.00',
		]);
	});

	test('rounding at the digit limit goes half away from zero on the exact digits', () => {
		const values = ['1.005', '-1.005', '2.675', '0.00005', '0.000049', '0.999'];

		assert.deepStrictEqual(values.map(v => formatDecimal(v, DISPLAY)),
			['1.01', '-1.01', '2.68', '0.0001', '0.0000', '0.9990']);
		// The double nearest 1.005 and 2.675 is just below the half-way digit, so coercing first
		// rounds them down. This is the difference a financial column notices.
		assert.deepStrictEqual(values.map(v => formatFloat(Number(v), DISPLAY)),
			['1.00', '-1.00', '2.67', '0.0001', '0.0000', '0.9990']);
	});

	test('exponential notation starts past max_integral_digits', () => {
		const values = ['9999999.99', '10000000', '99999999.9', '-12345678.9', '9999999.999'];

		assert.deepStrictEqual(values.map(v => formatDecimal(v, DISPLAY)), [
			'9999999.99',
			'1.00e+7',
			'1.00e+8',
			'-1.23e+7',
			// The notation is chosen from the unrounded magnitude, so a carry out of the fraction
			// widens the result rather than pushing it into exponential form -- matching formatFloat.
			'10000000.00',
		]);
	});

	test('the thousands separator groups positional notation and leaves exponential alone', () => {
		const values = ['1234567.891', '-1234567.891', '12345678.9', '0.5'];

		assert.deepStrictEqual(values.map(v => formatDecimal(v, SEPARATED)),
			['1,234,567.89', '-1,234,567.89', '1.23e+7', '0.5000']);
	});

	test('zero, sub-1 magnitudes and redundant digits render as a double would', () => {
		const values = ['0', '-0.00', '0.5', '-0.00001', '.5', '007.5'];

		assert.deepStrictEqual(values.map(v => formatDecimal(v, DISPLAY)),
			['0.00', '0.00', '0.5000', '-0.0000', '0.5000', '7.50']);
	});

	test('every value a double holds exactly formats identically either way', () => {
		// The exact path is only correct if it is a strict superset of the numeric one, so for values
		// with no representation error the two must agree character for character.
		const values = ['0', '1', '-1.5', '0.25', '-0.25', '0.0000152587890625', '1024.125',
			'9999999', '9999999.25', '10000000', '-10000000', '123456789', '-0.001953125'];

		assert.deepStrictEqual(
			values.map(v => formatDecimal(v, DISPLAY)),
			values.map(v => formatFloat(Number(v), DISPLAY)));
	});

	test('only plain positional notation takes the exact path', () => {
		// Everything else has to keep going through Number: the non-finite numerics Postgres allows,
		// exponent notation, and anything that isn't a number at all.
		const values = ['12.5', '-12', '.5', 'NaN', 'Infinity', '-Infinity', '1e5', '', '12abc', ' 12 ', 12];

		assert.deepStrictEqual(values.map(v => isDecimalLiteral(v)),
			[true, true, true, false, false, false, false, false, false, false, false]);
	});

	test('only a canonical integer literal takes the exact path', () => {
		// A non-canonical digit string must not reach `formatInteger`, which prints its argument
		// verbatim: '007' would display as '007', and a zero-padded literal would be grouped into
		// something like '00,000,000,000,000,001'. Excluding them here sends them through Number,
		// which normalizes them.
		const values = ['0', '42', '-42', '123456789012345678901234567890', '007', '+42', '-007',
			'00000000000000001', '-0', '1.0', '1e5', '', ' 42 ', 42];

		assert.deepStrictEqual(values.map(v => isIntegerLiteral(v)),
			[true, true, true, true, false, false, false, false, false, false, false, false, false, false]);
	});

	test('a summary statistic keeps an exact decimal exact and passes a missing one through', () => {
		assert.deepStrictEqual([
			formatNumericStat(undefined, ColumnDisplayType.Decimal, DISPLAY),
			formatNumericStat(null, ColumnDisplayType.Decimal, DISPLAY),
			formatNumericStat('9007199254740993.01', ColumnDisplayType.Decimal, WIDE),
			formatNumericStat('1.005', ColumnDisplayType.Decimal, DISPLAY),
			// A computed statistic is a double by construction and takes the numeric path.
			formatNumericStat(1.005, ColumnDisplayType.Decimal, DISPLAY),
		], [undefined, undefined, '9007199254740993.01', '1.01', '1.00']);
	});

	test('an integer column\'s statistics format as integers, matching its own min and max', () => {
		// `min_value`/`max_value` are stringified directly by every driver, so a median that went
		// through the float path reported a third format for the same column: min '1', max '5',
		// median '3.00'.
		assert.deepStrictEqual([
			// A bigint must never reach `Number`, which would round it past 2^53.
			formatNumericStat(9007199254740993n, ColumnDisplayType.Integer, SEPARATED),
			// PostgreSQL hands back int8 as an exact string.
			formatNumericStat('9007199254740993', ColumnDisplayType.Integer, SEPARATED),
			formatNumericStat(42n, ColumnDisplayType.Integer, DISPLAY),
			formatNumericStat(3, ColumnDisplayType.Integer, DISPLAY),
		], ['9,007,199,254,740,993', '9,007,199,254,740,993', '42', '3']);
	});

	test('a fractional median of an integer column still renders as a decimal', () => {
		// Several drivers compute the median with `percentile_cont`, which returns a double and
		// yields a half value on an even number of rows. That is not a whole number and must not be
		// printed as one.
		assert.deepStrictEqual([
			formatNumericStat(1.5, ColumnDisplayType.Integer, DISPLAY),
			formatNumericStat(2.5, ColumnDisplayType.Integer, DISPLAY),
		], ['1.50', '2.50']);
	});

	test('a whole-numbered decimal column keeps its fractional digits', () => {
		// A DECIMAL(n,0) median arrives as '42' and looks like an integer, but its column renders
		// cells as '42.00'. Routing on the value's shape rather than the column's display type would
		// disagree with those cells.
		assert.deepStrictEqual([
			formatNumericStat('42', ColumnDisplayType.Decimal, DISPLAY),
			formatNumericStat(42, ColumnDisplayType.Floating, DISPLAY),
		], ['42.00', '42.00']);
	});
});

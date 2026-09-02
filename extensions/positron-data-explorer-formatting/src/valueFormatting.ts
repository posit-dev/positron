/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Value formatting shared by the Data Explorer backend extensions. Every driver renders a cell the
// same way -- the Data Explorer's FormatOptions describe the rendering, not the source database --
// so these helpers live here rather than being copy-pasted into each driver's table view, which is
// how they started out and how they drifted (see #15366).

import { FormatOptions } from 'positron-data-explorer-protocol';

/** Applies a thousands separator to the integer part of an already-formatted number string. */
export function applyThousandsSep(formatted: string, sep: string): string {
	const negative = formatted.startsWith('-');
	const body = negative ? formatted.slice(1) : formatted;
	const [intPart, fracPart] = body.split('.');
	const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
	const result = fracPart === undefined ? grouped : `${grouped}.${fracPart}`;
	return negative ? `-${result}` : result;
}

/** Formats a floating-point value following the Data Explorer FormatOptions. */
export function formatFloat(value: number, opts: FormatOptions): string {
	const sciLimit = Math.pow(10, opts.max_integral_digits);
	let formatted: string;
	const abs = Math.abs(value);
	if (abs !== 0 && abs >= sciLimit) {
		return value.toExponential(opts.large_num_digits);
	} else if (abs !== 0 && abs < 1) {
		formatted = value.toFixed(opts.small_num_digits);
	} else {
		formatted = value.toFixed(opts.large_num_digits);
	}
	return opts.thousands_sep ? applyThousandsSep(formatted, opts.thousands_sep) : formatted;
}

/**
 * Whether a value is an exact integer literal in canonical form: either a bare `0`, or an optionally
 * negated digit run with no leading zero. A DECIMAL(n,0) arrives in this form, and it is only safe to
 * print such a string as-is when it is already exactly how the number should read.
 *
 * The non-canonical shapes are deliberately excluded so they keep going through `Number` and come out
 * normalized rather than printed raw: `formatInteger` only stringifies its argument, so a `'+42'` or
 * a `'007'` reaching it would display verbatim, and a zero-padded literal would even be grouped into
 * something like `00,000,000,000,000,001`. Anything else -- an exponent, a decimal point, stray text
 * -- is excluded for the same reason.
 */
export function isIntegerLiteral(value: unknown): value is string {
	return typeof value === 'string' && /^(0|-?[1-9]\d*)$/.test(value);
}

/**
 * Formats an integer value, optionally with a thousands separator. Accepts an exact digit string
 * alongside number and bigint so a wide DECIMAL(n,0) keeps every digit: the body only stringifies its
 * argument, and `applyThousandsSep` groups the digits textually, so no step here narrows the value to
 * a JS number.
 */
export function formatInteger(value: number | bigint | string, opts: FormatOptions): string {
	const formatted = value.toString();
	return opts.thousands_sep ? applyThousandsSep(formatted, opts.thousands_sep) : formatted;
}

/**
 * Whether a value is an exact decimal literal: an optionally signed run of digits with an optional
 * fractional part. A DECIMAL/NUMERIC arrives in this form from the drivers that preserve precision,
 * and `formatDecimal` can only work on the plain positional notation -- anything else (an exponent,
 * Postgres' 'NaN' and 'Infinity' numerics, stray text) has to go through `Number` and `formatFloat`.
 */
export function isDecimalLiteral(value: unknown): value is string {
	return typeof value === 'string' && /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value);
}

/**
 * Formats an exact decimal literal following the Data Explorer FormatOptions, without ever
 * converting it to a JS number.
 *
 * A DECIMAL/NUMERIC reaches the driver as a digit string precisely because a double cannot hold it:
 * `Number()` loses the whole-number digits past 2^53, and it also shifts the rounding at the digit
 * limit, because the double nearest the literal can fall on the other side of a half-way digit
 * (`Number('1.005').toFixed(2)` is `1.00`, not `1.01`). Every step below is therefore textual: the
 * digits are split, rounded half away from zero, and grouped as strings.
 *
 * The result matches `formatFloat` for any value a double represents exactly, including its choice
 * of notation: exponential at or above 10^max_integral_digits, `small_num_digits` for a magnitude
 * below 1, and `large_num_digits` otherwise. Like `formatFloat`, the notation is chosen from the
 * unrounded magnitude, so a carry out of the rounding widens the result rather than pushing it into
 * exponential form, and exponential results are not given a thousands separator.
 */
export function formatDecimal(value: string, opts: FormatOptions): string {
	const { negative, integral, fraction } = splitDecimalLiteral(value);
	const isZero = !/[1-9]/.test(integral + fraction);
	// A negative zero prints unsigned, matching `(-0).toFixed(2)`, but a value that merely rounds to
	// zero keeps its sign, matching `(-0.00001).toFixed(4)`.
	const sign = negative && !isZero ? '-' : '';

	// `integral` carries no leading zeros, so its digit count is the value's magnitude: the value is
	// at or above 10^max_integral_digits exactly when it has more than that many integral digits.
	if (!isZero && integral.length > opts.max_integral_digits) {
		return sign + toExponentialDigits(integral, fraction, opts.large_num_digits);
	}

	const digits = !isZero && integral === '0' ? opts.small_num_digits : opts.large_num_digits;
	const formatted = sign + toFixedDigits(integral, fraction, digits);
	return opts.thousands_sep ? applyThousandsSep(formatted, opts.thousands_sep) : formatted;
}

/**
 * Formats a raw numeric summary statistic, keeping an exact decimal exact. A statistic read straight
 * out of the data -- a median, a minimum -- is a DECIMAL/NUMERIC digit string when its column is one,
 * and formatting it textually is the difference between reporting the value that is in the table and
 * reporting the nearest double. A statistic that is computed instead (a mean, a standard deviation)
 * is a double by construction and takes the numeric path.
 *
 * A missing statistic passes through as undefined, which is how the protocol represents "there is no
 * value here" (an empty column has no median).
 */
export function formatNumericStat(value: unknown, opts: FormatOptions): string | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}
	return isDecimalLiteral(value) ? formatDecimal(value, opts) : formatFloat(Number(value), opts);
}

/** Truncates a string to the configured maximum formatted length. */
export function truncate(value: string, opts: FormatOptions): string {
	return value.length > opts.max_value_length ? value.slice(0, opts.max_value_length) : value;
}

/**
 * Splits a decimal literal into its sign and its integral and fractional digits. The integral digits
 * are stripped of leading zeros so their count is the value's magnitude, keeping a single `0` when
 * the value is below 1 so there is still an integral part to print.
 */
function splitDecimalLiteral(value: string): { negative: boolean; integral: string; fraction: string } {
	const negative = value.startsWith('-');
	const body = negative || value.startsWith('+') ? value.slice(1) : value;
	const pointIndex = body.indexOf('.');
	const integral = pointIndex < 0 ? body : body.slice(0, pointIndex);
	const fraction = pointIndex < 0 ? '' : body.slice(pointIndex + 1);
	return { negative, integral: integral.replace(/^0+(?=\d)/, '') || '0', fraction };
}

/**
 * Renders digit strings in positional notation with exactly `digits` fractional digits, rounding half
 * away from zero. This is the textual equivalent of `Number.prototype.toFixed`, which rounds the same
 * way for any value a double represents exactly.
 */
function toFixedDigits(integral: string, fraction: string, digits: number): string {
	let intDigits = integral;
	let fracDigits = fraction.slice(0, digits).padEnd(digits, '0');
	if (fraction.length > digits && fraction[digits] >= '5') {
		// Round up by incrementing the digits as one integer, so a carry can ripple out of the
		// fraction and into the integral part (0.999 at two digits becomes 1.00).
		const carried = incrementDigits(intDigits + fracDigits);
		intDigits = carried.slice(0, carried.length - digits);
		fracDigits = carried.slice(carried.length - digits);
	}
	return digits > 0 ? `${intDigits}.${fracDigits}` : intDigits;
}

/**
 * Renders digit strings in exponential notation with exactly `digits` mantissa fraction digits,
 * matching `Number.prototype.toExponential`. Only called for a magnitude at or above
 * 10^max_integral_digits, so the integral part is non-zero and the exponent is positive.
 */
function toExponentialDigits(integral: string, fraction: string, digits: number): string {
	const significant = integral + fraction;
	let exponent = integral.length - 1;
	let mantissa = significant.slice(0, digits + 1).padEnd(digits + 1, '0');
	if (significant.length > digits + 1 && significant[digits + 1] >= '5') {
		mantissa = incrementDigits(mantissa);
		if (mantissa.length > digits + 1) {
			// The carry added a digit (9.99 became 10.00), so renormalize to a single integral digit.
			exponent += 1;
			mantissa = mantissa.slice(0, digits + 1);
		}
	}
	const rendered = digits > 0 ? `${mantissa[0]}.${mantissa.slice(1)}` : mantissa;
	return `${rendered}e+${exponent}`;
}

/** Adds one to a string of digits, growing the string by a digit when the carry runs off the end. */
function incrementDigits(digits: string): string {
	const chars = digits.split('');
	for (let i = chars.length - 1; i >= 0; i--) {
		if (chars[i] === '9') {
			chars[i] = '0';
		} else {
			chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
			return chars.join('');
		}
	}
	return `1${chars.join('')}`;
}

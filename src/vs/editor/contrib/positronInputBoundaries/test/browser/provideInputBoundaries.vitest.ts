/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IInputBoundary } from '../../../../common/languages.js';
import { codeFragmentsFromBoundaries } from '../../browser/provideInputBoundaries.js';

/**
 * Helper to build a boundary with a zero-indexed, end-exclusive line range.
 */
function boundary(start: number, end: number, kind: IInputBoundary['kind']): IInputBoundary {
	return { range: { start, end }, kind };
}

describe('codeFragmentsFromBoundaries', () => {
	it('returns a single complete fragment', () => {
		const code = 'x <- 1';
		const result = codeFragmentsFromBoundaries(code, [boundary(0, 1, 'complete')]);
		expect(result).toEqual({
			fragments: [{ code: 'x <- 1', startLine: 0, endLine: 1 }],
			incomplete: false,
			invalid: false,
		});
	});

	it('returns multiple complete fragments in order with their line ranges', () => {
		const code = 'x <- 1\ny <- 2\nz <- 3';
		const result = codeFragmentsFromBoundaries(code, [
			boundary(0, 1, 'complete'),
			boundary(1, 2, 'complete'),
			boundary(2, 3, 'complete'),
		]);
		expect(result).toEqual({
			fragments: [
				{ code: 'x <- 1', startLine: 0, endLine: 1 },
				{ code: 'y <- 2', startLine: 1, endLine: 2 },
				{ code: 'z <- 3', startLine: 2, endLine: 3 },
			],
			incomplete: false,
			invalid: false,
		});
	});

	it('joins a multi-line complete fragment with newlines and spans its line range', () => {
		const code = 'if (x) {\n  y\n}\nz';
		const result = codeFragmentsFromBoundaries(code, [
			boundary(0, 3, 'complete'),
			boundary(3, 4, 'complete'),
		]);
		expect(result.fragments).toEqual([
			{ code: 'if (x) {\n  y\n}', startLine: 0, endLine: 3 },
			{ code: 'z', startLine: 3, endLine: 4 },
		]);
	});

	it('skips whitespace boundaries but keeps line ranges accurate', () => {
		const code = 'x <- 1\n\ny <- 2';
		const result = codeFragmentsFromBoundaries(code, [
			boundary(0, 1, 'complete'),
			boundary(1, 2, 'whitespace'),
			boundary(2, 3, 'complete'),
		]);
		expect(result.fragments).toEqual([
			{ code: 'x <- 1', startLine: 0, endLine: 1 },
			{ code: 'y <- 2', startLine: 2, endLine: 3 },
		]);
	});

	it('flags an incomplete trailing boundary and does not emit a fragment for it', () => {
		const code = 'x <- 1\nf <- function(';
		const result = codeFragmentsFromBoundaries(code, [
			boundary(0, 1, 'complete'),
			boundary(1, 2, 'incomplete'),
		]);
		expect(result.incomplete).toBe(true);
		expect(result.invalid).toBe(false);
		expect(result.fragments).toEqual([{ code: 'x <- 1', startLine: 0, endLine: 1 }]);
	});

	it('flags an invalid trailing boundary', () => {
		const code = 'x <- 1\n)(';
		const result = codeFragmentsFromBoundaries(code, [
			boundary(0, 1, 'complete'),
			boundary(1, 2, 'invalid'),
		]);
		expect(result.invalid).toBe(true);
		expect(result.incomplete).toBe(false);
		expect(result.fragments).toEqual([{ code: 'x <- 1', startLine: 0, endLine: 1 }]);
	});

	it('returns no fragments for all-whitespace input', () => {
		const code = '\n\n';
		const result = codeFragmentsFromBoundaries(code, [boundary(0, 3, 'whitespace')]);
		expect(result).toEqual({ fragments: [], incomplete: false, invalid: false });
	});

	it('throws on non-contiguous ranges', () => {
		const code = 'x <- 1\ny <- 2';
		expect(() => codeFragmentsFromBoundaries(code, [
			boundary(0, 1, 'complete'),
			// Gap: starts at 2 instead of 1.
			boundary(2, 2, 'complete'),
		])).toThrow();
	});

	it('throws when the ranges do not cover the whole code', () => {
		const code = 'x <- 1\ny <- 2';
		expect(() => codeFragmentsFromBoundaries(code, [
			// Only covers the first line.
			boundary(0, 1, 'complete'),
		])).toThrow();
	});

	it('throws when a range extends past the last line', () => {
		const code = 'x <- 1';
		expect(() => codeFragmentsFromBoundaries(code, [boundary(0, 2, 'complete')])).toThrow();
	});

	it('throws on an unknown boundary kind', () => {
		const code = 'x <- 1';
		expect(() => codeFragmentsFromBoundaries(code, [
			boundary(0, 1, 'bogus' as IInputBoundary['kind']),
		])).toThrow();
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { maxDragSize, parsePlotDimension, resizeFromDrag } from '../../browser/modalDialogs/plotSizeLimits.js';

describe('plotSizeLimits', () => {
	describe('parsePlotDimension', () => {
		it('rejects empty and non-numeric text as empty', () => {
			expect(parsePlotDimension('')).toEqual({ error: 'empty' });
			expect(parsePlotDimension('   ')).toEqual({ error: 'empty' });
			expect(parsePlotDimension('abc')).toEqual({ error: 'empty' });
		});

		it('rejects sizes outside 100 to 10000 px', () => {
			expect(parsePlotDimension('99').error).toBe('tooSmall');
			expect(parsePlotDimension('10001').error).toBe('tooLarge');
		});

		it('accepts the limits themselves', () => {
			expect(parsePlotDimension('100')).toEqual({ value: 100 });
			expect(parsePlotDimension('10000')).toEqual({ value: 10000 });
		});

		it('rejects sizes above a lower maximum', () => {
			expect(parsePlotDimension('5000', 5000)).toEqual({ value: 5000 });
			expect(parsePlotDimension('5001', 5000).error).toBe('tooLarge');
		});

		it('floors decimals to whole pixels', () => {
			expect(parsePlotDimension(' 640.9 ')).toEqual({ value: 640 });
		});
	});

	describe('maxDragSize', () => {
		it('leaves a margin around the container', () => {
			expect(maxDragSize({ width: 1200, height: 900 })).toEqual({ width: 1100, height: 700 });
		});

		it('is never above the maximum', () => {
			expect(maxDragSize({ width: 20000, height: 20000 }, 5000)).toEqual({ width: 5000, height: 5000 });
		});

		it('is never below the minimum size', () => {
			expect(maxDragSize({ width: 150, height: 150 })).toEqual({ width: 100, height: 100 });
		});
	});

	describe('resizeFromDrag', () => {
		const max = { width: 1100, height: 700 };

		it('adds the deltas without a ratio', () => {
			expect(resizeFromDrag({ width: 400, height: 200 }, 100, 30, undefined, max)).toEqual({ width: 500, height: 230 });
		});

		it('links the other side to the larger relative change', () => {
			expect(resizeFromDrag({ width: 400, height: 200 }, 100, 0, 2, max)).toEqual({ width: 500, height: 250 });
			expect(resizeFromDrag({ width: 400, height: 200 }, 10, 100, 2, max)).toEqual({ width: 600, height: 300 });
		});

		it('keeps the ratio when clamped at the maximum', () => {
			expect(resizeFromDrag({ width: 400, height: 200 }, 5000, 0, 2, max)).toEqual({ width: 1100, height: 550 });
			expect(resizeFromDrag({ width: 400, height: 400 }, 0, 5000, 1, max)).toEqual({ width: 700, height: 700 });
		});

		it('never goes below 100 px per side', () => {
			expect(resizeFromDrag({ width: 400, height: 200 }, -1000, 0, 2, max)).toEqual({ width: 200, height: 100 });
			expect(resizeFromDrag({ width: 400, height: 200 }, -1000, -1000, undefined, max)).toEqual({ width: 100, height: 100 });
		});
	});
});

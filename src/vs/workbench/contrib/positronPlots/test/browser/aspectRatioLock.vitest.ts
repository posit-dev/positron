/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlotUnit } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { intrinsicSizeInPixels, linkedHeight, linkedWidth, ratioOf } from '../../browser/modalDialogs/aspectRatioLock.js';

describe('aspectRatioLock', () => {
	describe('ratioOf', () => {
		it('is width divided by height', () => {
			expect(ratioOf(1200, 800)).toBe(1.5);
		});

		it('is undefined unless both dimensions are positive and finite', () => {
			expect([ratioOf(0, 800), ratioOf(NaN, 800), ratioOf(1200, -1), ratioOf(1200, Infinity)])
				.toEqual([undefined, undefined, undefined, undefined]);
		});
	});

	describe('linkedHeight', () => {
		it('derives the height that keeps the ratio', () => {
			expect(linkedHeight(900, 1.5)).toBe(600);
		});

		it('rounds to the nearest pixel', () => {
			expect(linkedHeight(1001, 3)).toBe(334);
		});

		it('never returns less than 1', () => {
			expect(linkedHeight(1, 1.4)).toBe(1);
		});
	});

	describe('linkedWidth', () => {
		it('derives the width that keeps the ratio', () => {
			expect(linkedWidth(400, 1.5)).toBe(600);
		});

		it('never returns less than 1', () => {
			expect(linkedWidth(1, 0.1)).toBe(1);
		});
	});

	describe('intrinsicSizeInPixels', () => {
		it('converts inches at the given DPI, rounded to whole pixels', () => {
			expect(intrinsicSizeInPixels({ width: 6.4, height: 4.75, unit: PlotUnit.Inches, source: 'Matplotlib' }, 100))
				.toEqual({ width: 640, height: 475 });
		});

		it('keeps pixels as they are', () => {
			expect(intrinsicSizeInPixels({ width: 640, height: 480, unit: PlotUnit.Pixels, source: 'Test' }, 100))
				.toEqual({ width: 640, height: 480 });
		});
	});
});

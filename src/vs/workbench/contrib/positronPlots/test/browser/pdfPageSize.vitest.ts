/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlotUnit } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PDF_PRESETS, orient, orientationOf, plotPaneInches, presetPortraitSize, resolvePdfSize } from '../../browser/modalDialogs/pdfPageSize.js';

describe('pdfPageSize', () => {
	const pane: IPlotSize = { width: 672, height: 480 };

	describe('PDF_PRESETS', () => {
		it('lists the presets in spec order', () => {
			expect(PDF_PRESETS).toMatchInlineSnapshot(`
				[
				  "plotPane",
				  "letter",
				  "legal",
				  "a4",
				  "a5",
				  "a6",
				  "4x6",
				  "5x7",
				  "6x8",
				  "custom",
				]
			`);
		});
	});

	describe('presetPortraitSize', () => {
		it('gives the named presets in portrait inches', () => {
			expect(PDF_PRESETS.filter(p => p !== 'plotPane' && p !== 'custom').map(p => [p, presetPortraitSize(p)]))
				.toMatchInlineSnapshot(`
					[
					  [
					    "letter",
					    {
					      "height": 11,
					      "width": 8.5,
					    },
					  ],
					  [
					    "legal",
					    {
					      "height": 14,
					      "width": 8.5,
					    },
					  ],
					  [
					    "a4",
					    {
					      "height": 11.69,
					      "width": 8.27,
					    },
					  ],
					  [
					    "a5",
					    {
					      "height": 8.27,
					      "width": 5.83,
					    },
					  ],
					  [
					    "a6",
					    {
					      "height": 5.83,
					      "width": 4.13,
					    },
					  ],
					  [
					    "4x6",
					    {
					      "height": 6,
					      "width": 4,
					    },
					  ],
					  [
					    "5x7",
					    {
					      "height": 7,
					      "width": 5,
					    },
					  ],
					  [
					    "6x8",
					    {
					      "height": 8,
					      "width": 6,
					    },
					  ],
					]
				`);
		});
	});

	describe('orient', () => {
		it('makes a landscape size wide', () => {
			expect(orient({ width: 8.5, height: 11 }, 'landscape')).toEqual({ width: 11, height: 8.5 });
		});

		it('makes a portrait size tall', () => {
			expect(orient({ width: 11, height: 8.5 }, 'portrait')).toEqual({ width: 8.5, height: 11 });
		});

		it('leaves a square size unchanged', () => {
			expect(orient({ width: 5, height: 5 }, 'landscape')).toEqual({ width: 5, height: 5 });
		});
	});

	describe('orientationOf', () => {
		it('is landscape when wider than tall and portrait when taller', () => {
			expect([orientationOf(11, 8.5, 'portrait'), orientationOf(8.5, 11, 'landscape')])
				.toEqual(['landscape', 'portrait']);
		});

		it('uses the fallback when width equals height', () => {
			expect([orientationOf(5, 5, 'portrait'), orientationOf(5, 5, 'landscape')])
				.toEqual(['portrait', 'landscape']);
		});
	});

	describe('plotPaneInches', () => {
		it('converts the pane pixels at 96 per inch, rounded to two decimals', () => {
			expect(plotPaneInches(pane, undefined)).toEqual({ width: 7, height: 5 });
		});

		it('uses inches from the intrinsic size as they are', () => {
			expect(plotPaneInches(undefined, { width: 6.3, height: 4.7, unit: PlotUnit.Inches, source: 'Test' }))
				.toEqual({ width: 6.3, height: 4.7 });
		});

		it('converts intrinsic pixels at 96 per inch', () => {
			expect(plotPaneInches(undefined, { width: 960, height: 480, unit: PlotUnit.Pixels, source: 'Test' }))
				.toEqual({ width: 10, height: 5 });
		});

		it('falls back to 7 x 5 inches with no size', () => {
			expect(plotPaneInches(undefined, undefined)).toEqual({ width: 7, height: 5 });
		});
	});

	describe('resolvePdfSize', () => {
		it('uses the pane size for the Plot Pane preset in the chosen orientation', () => {
			expect(resolvePdfSize({ preset: 'plotPane', orientation: 'portrait' }, { width: 7, height: 5 }))
				.toEqual({ width: 5, height: 7 });
		});

		it('uses the custom width and height as given', () => {
			expect(resolvePdfSize({ preset: 'custom', orientation: 'landscape', width: 3.5, height: 2.5 }, { width: 7, height: 5 }))
				.toEqual({ width: 3.5, height: 2.5 });
		});
	});
});

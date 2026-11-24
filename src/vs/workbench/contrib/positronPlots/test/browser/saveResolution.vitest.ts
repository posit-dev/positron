/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlotRenderFormat } from '../../../../services/positronPlots/common/positronPlots.js';
import { defaultSaveResolution, isRasterFormat, normalizeSaveResolutions } from '../../browser/modalDialogs/saveResolution.js';

describe('normalizeSaveResolutions', () => {
	it.each([
		['missing', undefined],
		['not an array', 'abc'],
		['empty', []],
		['all invalid', [0, 50]],
	])('uses the default list when the setting is %s', (_label, value) => {
		expect(normalizeSaveResolutions(value)).toEqual([1, 2, 3]);
	});

	it('sorts and drops duplicates', () => {
		expect(normalizeSaveResolutions([4, 1, 2, 2])).toEqual([1, 2, 4]);
	});

	it('drops values that are not positive numbers of at most 10', () => {
		expect(normalizeSaveResolutions([0, -1, NaN, 50, '2', 1.5, 10])).toEqual([1.5, 10]);
	});
});

describe('defaultSaveResolution', () => {
	const list = [1, 2, 3, 4];

	it.each([
		[1, 1],
		[1.25, 2],
		[2, 2],
		[5, 4],
	])('picks the smallest entry at least the screen density %s', (devicePixelRatio, expected) => {
		expect(defaultSaveResolution(list, devicePixelRatio)).toBe(expected);
	});

	it('prefers the remembered resolution', () => {
		expect(defaultSaveResolution(list, 2, 3)).toBe(3);
	});

	it('ignores a remembered resolution that is no longer listed', () => {
		expect(defaultSaveResolution(list, 2, 6)).toBe(2);
	});
});

describe('isRasterFormat', () => {
	it('is true only for PNG, JPEG, and TIFF', () => {
		expect(new Set(Object.values(PlotRenderFormat).filter(isRasterFormat))).toEqual(
			new Set([PlotRenderFormat.Png, PlotRenderFormat.Jpeg, PlotRenderFormat.Tiff])
		);
	});
});

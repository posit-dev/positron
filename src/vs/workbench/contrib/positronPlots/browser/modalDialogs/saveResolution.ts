/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlotRenderFormat } from '../../../../services/positronPlots/common/positronPlots.js';

/** The setting listing the resolution multipliers offered when saving a raster plot. */
export const SaveResolutionsConfigKey = 'plots.saveResolutions';

/** The resolution multipliers offered when the setting is missing or has no valid entries. */
export const DEFAULT_SAVE_RESOLUTIONS: readonly number[] = [1, 2, 3, 4];

/** The largest resolution multiplier the setting accepts. */
export const MAX_SAVE_RESOLUTION = 10;

/**
 * Turns the setting's value into the list of resolutions to offer.
 * @param value The raw setting value.
 * @returns The valid entries (finite, greater than 0, at most 10), sorted and without duplicates,
 * or the default list if there are none.
 */
export function normalizeSaveResolutions(value: unknown): number[] {
	const valid = Array.isArray(value)
		? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_SAVE_RESOLUTION)
		: [];
	const resolutions = [...new Set(valid)].sort((a, b) => a - b);
	return resolutions.length > 0 ? resolutions : [...DEFAULT_SAVE_RESOLUTIONS];
}

/**
 * Picks the resolution the Save Plot dialog starts with.
 * @param resolutions The resolutions offered, sorted ascending.
 * @param devicePixelRatio The screen's pixel density.
 * @param remembered The resolution of the last save, if any.
 * @returns The remembered resolution if it is offered; otherwise the smallest offered resolution at
 * least the screen's density, so a save is never less sharp than the Plots pane; otherwise the largest.
 */
export function defaultSaveResolution(resolutions: readonly number[], devicePixelRatio: number, remembered?: number): number {
	if (remembered !== undefined && resolutions.includes(remembered)) {
		return remembered;
	}
	return resolutions.find(r => r >= devicePixelRatio) ?? resolutions[resolutions.length - 1];
}

/**
 * Whether a format is a raster image, whose pixel count the resolution scales.
 * Vector formats (SVG, PDF) are always rendered at a resolution of 1.
 */
export function isRasterFormat(format: PlotRenderFormat): boolean {
	return format === PlotRenderFormat.Png || format === PlotRenderFormat.Jpeg || format === PlotRenderFormat.Tiff;
}

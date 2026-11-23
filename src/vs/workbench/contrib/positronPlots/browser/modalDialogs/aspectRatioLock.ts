/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IntrinsicSize, PlotUnit } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';

/**
 * Gets a plot's intrinsic size in pixels.
 * @param size The intrinsic size.
 * @param dpi The pixels per inch to convert a size in inches at.
 * @returns The size, rounded to whole pixels.
 */
export function intrinsicSizeInPixels(size: IntrinsicSize, dpi: number): IPlotSize {
	const scale = size.unit === PlotUnit.Inches ? dpi : 1;
	return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

/**
 * Gets the aspect ratio (width divided by height) of a size.
 * @param width The width.
 * @param height The height.
 * @returns The ratio, or undefined unless both dimensions are positive and finite.
 */
export function ratioOf(width: number, height: number): number | undefined {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return undefined;
	}
	return width / height;
}

/**
 * Gets the height that keeps the given aspect ratio for a width.
 * @param width The width.
 * @param ratio The aspect ratio (width divided by height).
 * @param decimals The number of decimal places to round to. Defaults to whole pixels.
 * @returns The height, rounded to the given decimals and at least one unit of that precision.
 */
export function linkedHeight(width: number, ratio: number, decimals = 0): number {
	return roundAtLeastOneUnit(width / ratio, decimals);
}

/**
 * Gets the width that keeps the given aspect ratio for a height.
 * @param height The height.
 * @param ratio The aspect ratio (width divided by height).
 * @param decimals The number of decimal places to round to. Defaults to whole pixels.
 * @returns The width, rounded to the given decimals and at least one unit of that precision.
 */
export function linkedWidth(height: number, ratio: number, decimals = 0): number {
	return roundAtLeastOneUnit(height * ratio, decimals);
}

/**
 * Rounds a value to a number of decimal places, but never below one unit of that precision.
 * @param value The value to round.
 * @param decimals The number of decimal places.
 * @returns The rounded value, at least 10^-decimals.
 */
function roundAtLeastOneUnit(value: number, decimals: number): number {
	const scale = 10 ** decimals;
	return Math.max(1 / scale, Math.round(value * scale) / scale);
}

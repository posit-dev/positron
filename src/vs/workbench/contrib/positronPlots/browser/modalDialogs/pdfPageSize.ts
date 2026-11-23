/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IntrinsicSize, PlotUnit } from '../../../../services/languageRuntime/common/positronPlotComm.js';
import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';

/**
 * The page size presets offered when saving a plot as a PDF.
 */
export type PdfPreset = 'plotPane' | 'letter' | 'legal' | 'a4' | 'a5' | 'a6' | '4x6' | '5x7' | '6x8' | 'custom';

/**
 * The orientation of a PDF page.
 */
export type PdfOrientation = 'landscape' | 'portrait';

/**
 * The page size chosen for a PDF.
 */
export interface PdfSizeChoice {
	/**
	 * The preset the size comes from.
	 */
	preset: PdfPreset;

	/**
	 * The orientation of the page.
	 */
	orientation: PdfOrientation;

	/**
	 * The width in inches. Only used by the custom preset.
	 */
	width?: number;

	/**
	 * The height in inches. Only used by the custom preset.
	 */
	height?: number;
}

/**
 * The presets in the order they are offered.
 */
export const PDF_PRESETS: readonly PdfPreset[] = ['plotPane', 'letter', 'legal', 'a4', 'a5', 'a6', '4x6', '5x7', '6x8', 'custom'];

type NamedPreset = Exclude<PdfPreset, 'plotPane' | 'custom'>;

const PORTRAIT_PRESET_SIZES: Record<NamedPreset, IPlotSize> = {
	letter: { width: 8.5, height: 11 },
	legal: { width: 8.5, height: 14 },
	a4: { width: 8.27, height: 11.69 },
	a5: { width: 5.83, height: 8.27 },
	a6: { width: 4.13, height: 5.83 },
	'4x6': { width: 4, height: 6 },
	'5x7': { width: 5, height: 7 },
	'6x8': { width: 6, height: 8 },
};

/**
 * Pixels per inch used to convert plot pixel sizes to inches.
 */
const PIXELS_PER_INCH = 96;

/**
 * The size used when no plot size is known, in inches.
 */
const FALLBACK_PANE_INCHES: IPlotSize = { width: 7, height: 5 };

/**
 * Gets the portrait size of a named preset.
 * @param preset The named preset.
 * @returns The width and height in inches, with the height greater than the width.
 */
export function presetPortraitSize(preset: NamedPreset): IPlotSize {
	return { ...PORTRAIT_PRESET_SIZES[preset] };
}

/**
 * Gets a size in the requested orientation.
 * @param size The size in inches.
 * @param orientation The orientation to return the size in.
 * @returns The size, with its width and height swapped if needed to match the orientation.
 */
export function orient(size: IPlotSize, orientation: PdfOrientation): IPlotSize {
	const isLandscape = size.width >= size.height;
	const wantsLandscape = orientation === 'landscape';
	return isLandscape === wantsLandscape
		? { width: size.width, height: size.height }
		: { width: size.height, height: size.width };
}

/**
 * Gets the orientation of a size.
 * @param width The width.
 * @param height The height.
 * @param fallback The orientation to use when the width and height are equal.
 * @returns Landscape when wider than tall, portrait when taller than wide, otherwise the fallback.
 */
export function orientationOf(width: number, height: number, fallback: PdfOrientation): PdfOrientation {
	if (width > height) {
		return 'landscape';
	}
	if (height > width) {
		return 'portrait';
	}
	return fallback;
}

/**
 * Rounds a size in inches to two decimal places.
 * @param value The value in inches.
 * @returns The value rounded to two decimal places.
 */
export function roundInches(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Gets the size of the Plot Pane preset in inches.
 * @param paneSize The Plot Pane size in pixels, if known.
 * @param intrinsic The plot's intrinsic size, if known.
 * @returns The pane size in inches, or the intrinsic size in inches, or the intrinsic size
 * in pixels converted to inches, or 7 x 5 inches when none of these is known.
 */
export function plotPaneInches(paneSize: IPlotSize | undefined, intrinsic: IntrinsicSize | undefined): IPlotSize {
	if (paneSize) {
		return {
			width: roundInches(paneSize.width / PIXELS_PER_INCH),
			height: roundInches(paneSize.height / PIXELS_PER_INCH),
		};
	}
	if (intrinsic?.unit === PlotUnit.Inches) {
		return { width: intrinsic.width, height: intrinsic.height };
	}
	if (intrinsic) {
		return {
			width: roundInches(intrinsic.width / PIXELS_PER_INCH),
			height: roundInches(intrinsic.height / PIXELS_PER_INCH),
		};
	}
	return { ...FALLBACK_PANE_INCHES };
}

/**
 * Resolves a PDF page choice to its size in inches.
 * @param choice The chosen preset, orientation and, for custom, width and height.
 * @param paneInches The Plot Pane size in inches, used by the Plot Pane preset and as the
 * custom fallback.
 * @returns The page size in inches. Presets are oriented as chosen; custom sizes are used as given.
 */
export function resolvePdfSize(choice: PdfSizeChoice, paneInches: IPlotSize): IPlotSize {
	switch (choice.preset) {
		case 'plotPane':
			return orient(paneInches, choice.orientation);
		case 'custom':
			return {
				width: choice.width ?? paneInches.width,
				height: choice.height ?? paneInches.height,
			};
		default:
			return orient(presetPortraitSize(choice.preset), choice.orientation);
	}
}

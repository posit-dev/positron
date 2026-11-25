/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPlotSize } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { linkedHeight } from './aspectRatioLock.js';

/** The smallest plot size, in pixels, for each side. */
export const MIN_PLOT_SIZE = 100;

/** The largest plot size, in pixels, for each side. */
export const MAX_PLOT_SIZE = 10000;

/** How long to wait after the last typed change before committing a size. */
export const TYPED_SIZE_DELAY_MS = 300;

/** Why a typed plot dimension is not valid. */
export type PlotSizeError = 'empty' | 'tooSmall' | 'tooLarge';

/**
 * Parses a typed plot dimension.
 * @param text The text in a size box.
 * @param max The largest valid value.
 * @returns The value in whole pixels, or undefined for empty or non-numeric text. The error is
 * set when the text is not a valid size; an out of range value is still returned.
 */
export function parsePlotDimension(text: string, max = MAX_PLOT_SIZE): { value?: number; error?: PlotSizeError } {
	const trimmed = text.trim();
	const parsed = Number(trimmed);
	if (trimmed === '' || !Number.isFinite(parsed)) {
		return { error: 'empty' };
	}
	const value = Math.floor(parsed);
	if (value < MIN_PLOT_SIZE) {
		return { value, error: 'tooSmall' };
	}
	if (value > max) {
		return { value, error: 'tooLarge' };
	}
	return { value };
}

/**
 * Gets the largest size a drag can reach, which leaves room for the dialog around the plot.
 * @param container The size of the window or element the dialog is in.
 * @param max The largest plot size.
 * @returns The largest size, within the plot size limits.
 */
export function maxDragSize(container: { width: number; height: number }, max = MAX_PLOT_SIZE): IPlotSize {
	const clamp = (value: number) => Math.min(max, Math.max(MIN_PLOT_SIZE, value));
	return { width: clamp(container.width - 100), height: clamp(container.height - 200) };
}

/**
 * Gets the size after a drag.
 * @param start The size when the drag started.
 * @param dx The horizontal pointer movement.
 * @param dy The vertical pointer movement.
 * @param ratio The aspect ratio (width / height) to keep, or undefined to resize freely.
 * @param max The largest size the drag can reach.
 * @returns The new size, in whole pixels, between the minimum size and max.
 */
export function resizeFromDrag(start: IPlotSize, dx: number, dy: number, ratio: number | undefined, max: IPlotSize): IPlotSize {
	const clampWidth = (value: number) => Math.min(max.width, Math.max(MIN_PLOT_SIZE, Math.round(value)));
	const clampHeight = (value: number) => Math.min(max.height, Math.max(MIN_PLOT_SIZE, Math.round(value)));

	let width = start.width + dx;
	let height = start.height + dy;
	if (ratio === undefined) {
		return { width: clampWidth(width), height: clampHeight(height) };
	}

	// Follow the side that changed more, relative to its size.
	if (Math.abs(dx / start.width) >= Math.abs(dy / start.height)) {
		height = width / ratio;
	} else {
		width = height * ratio;
	}

	// Each clamp re-links the other side; a ratio too extreme for the limits is clamped last.
	if (width > max.width) { width = max.width; height = width / ratio; }
	if (height > max.height) { height = max.height; width = height * ratio; }
	if (width < MIN_PLOT_SIZE) { width = MIN_PLOT_SIZE; height = width / ratio; }
	if (height < MIN_PLOT_SIZE) { height = MIN_PLOT_SIZE; width = height * ratio; }
	width = Math.round(width);
	return { width: clampWidth(width), height: clampHeight(linkedHeight(width, ratio)) };
}

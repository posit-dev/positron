/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';

/**
 * This class implements a plot sizing policy that sizes the plot to a fixed
 * aspect ratio. It isn't directly exposed to the user, but is used as a base
 * class for a handful of other policies (landscape, portrait, square, etc.)
 */
export class SizingPolicyFixedAspectRatio {

	constructor(public readonly aspectRatio: number) { }

	private static minimumPlotSize = 400;

	/**
	 * Computes the size of the plot in pixels, given the size of the viewport in pixels.
	 *
	 * @param viewportSize The size of the viewport in pixels.
	 * @returns The size of the plot in pixels.
	 */
	public getPlotSize(viewportSize: IPlotSize): IPlotSize {
		let plotWidth = Math.max(viewportSize.width, SizingPolicyFixedAspectRatio.minimumPlotSize);
		let plotHeight = Math.max(viewportSize.height, SizingPolicyFixedAspectRatio.minimumPlotSize);
		if (plotWidth / plotHeight > this.aspectRatio) {
			plotWidth = plotHeight * this.aspectRatio;
		} else {
			plotHeight = plotWidth / this.aspectRatio;
		}
		return { width: plotWidth, height: plotHeight };
	}
}

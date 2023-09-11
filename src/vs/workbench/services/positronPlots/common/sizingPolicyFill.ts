/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy, IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';

/**
 * The simplest plot sizing policy. The plot is sized to fill the viewport exactly, no
 * matter what size it is.
 */
export class PlotSizingPolicyFill implements IPositronPlotSizingPolicy {
	public readonly id = 'fill';
	public readonly name = nls.localize('plotSizingPolicy.fillViewport', "Fill");

	/**
	 * Computes the size of the plot in pixels, given the size of the viewport in pixels.
	 *
	 * @param viewportSize The size of the viewport in pixels.
	 * @returns The size of the plot in pixels.
	 */
	public getPlotSize(viewportSize: IPlotSize): IPlotSize {
		return viewportSize;
	}
}

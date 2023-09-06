/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPlotSize, IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';

export class PlotSizingPolicyAuto implements IPositronPlotSizingPolicy {
	public readonly id = 'auto';
	public readonly name = 'Auto';

	private static goldenRatio = 1.61803398875;

	private static minimumPlotSize = 400;

	public getPlotSize(viewportSize: IPlotSize): IPlotSize {
		// Start with the assumption that the plot will fill the viewport.
		const plotSize = viewportSize;

		// Compute the aspect ratio of the viewport.
		const aspectRatio = viewportSize.width > viewportSize.height ?
			viewportSize.width / viewportSize.height :
			viewportSize.height / viewportSize.width;

		// If the viewport is very tall or very wide, then use the golden ratio to determine the
		// plot size.
		if (aspectRatio > PlotSizingPolicyAuto.goldenRatio) {
			if (viewportSize.width > viewportSize.height) {
				plotSize.width = viewportSize.height * PlotSizingPolicyAuto.goldenRatio;
			} else {
				plotSize.height = viewportSize.width * PlotSizingPolicyAuto.goldenRatio;
			}
		}

		// If the longest edge of the plot is less than the minimum plot size, then increase the
		// plot size to the minimum.
		if (plotSize.width > plotSize.height) {
			if (plotSize.width < PlotSizingPolicyAuto.minimumPlotSize) {
				plotSize.width = PlotSizingPolicyAuto.minimumPlotSize;
				plotSize.height = plotSize.width / PlotSizingPolicyAuto.goldenRatio;
			}
		} else if (plotSize.height < PlotSizingPolicyAuto.minimumPlotSize) {
			if (plotSize.height < PlotSizingPolicyAuto.minimumPlotSize) {
				plotSize.height = PlotSizingPolicyAuto.minimumPlotSize;
				plotSize.width = plotSize.height / PlotSizingPolicyAuto.goldenRatio;
			}
		}

		return plotSize;
	}
}

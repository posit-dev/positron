/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';

export class SizingPolicyFixedAspectRatio {

	constructor(public readonly aspectRatio: number) { }

	private static minimumPlotSize = 400;

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

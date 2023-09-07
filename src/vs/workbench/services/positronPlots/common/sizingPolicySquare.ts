/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPlotSize, IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';

export class PlotSizingPolicySquare implements IPositronPlotSizingPolicy {
	public readonly id = 'square';
	public readonly name = nls.localize('plotSizingPolicy.square', "Square");

	private static minimumPlotSize = 400;

	public getPlotSize(viewportSize: IPlotSize): IPlotSize {
		const minSize = Math.min(viewportSize.width, viewportSize.height);
		const size = Math.max(minSize, PlotSizingPolicySquare.minimumPlotSize);
		return { width: size, height: size };
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy, IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';

export class PlotSizingPolicyFill implements IPositronPlotSizingPolicy {
	public readonly id = 'fill';
	public readonly name = nls.localize('plotSizingPolicy.fillViewport', "Fill");

	public getPlotSize(viewportSize: IPlotSize): IPlotSize {
		return viewportSize;
	}
}

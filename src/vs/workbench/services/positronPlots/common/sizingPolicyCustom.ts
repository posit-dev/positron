/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPlotSize, IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';

/**
 * The custom sizing policy. The plot is given a fixed size, specified by the
 * user, in pixels. The viewport size is ignored.
 */
export class PlotSizingPolicyCustom implements IPositronPlotSizingPolicy {
	public static ID = 'custom';

	public readonly id = PlotSizingPolicyCustom.ID;
	public readonly name: string;

	constructor(public readonly size: IPlotSize) {
		this.name = nls.localize('plotSizingPolicy.Custom', "{0}×{1} (custom)", size.width, size.height);
	}

	public getPlotSize(viewportSize: IPlotSize): IPlotSize {
		return this.size;
	}
}

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
	public readonly id = 'custom';
	public readonly name: string;

	constructor(public readonly size: IPlotSize) {
		this.name = nls.localize('plotSizingPolicy.Custom', "Custom {0}×{1}", size.width, size.height);
	}

	public getPlotSize(viewportSize: IPlotSize): IPlotSize {
		return this.size;
	}
}

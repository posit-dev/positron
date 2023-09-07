/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';
import { SizingPolicyFixedAspectRatio } from 'vs/workbench/services/positronPlots/common/sizingPolicyFixedAspectRatio';

/**
 * This class implements a plot sizing policy that sizes the plot to a fixed 4:3
 * (landscape) aspect ratio.
 */
export class PlotSizingPolicyLandscape
	extends SizingPolicyFixedAspectRatio
	implements IPositronPlotSizingPolicy {

	constructor() {
		super(4 / 3);
	}

	public readonly id = 'landscape';
	public readonly name = nls.localize('plotSizingPolicy.landscape', "Landscape");
}

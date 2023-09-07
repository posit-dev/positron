/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';
import { SizingPolicyFixedAspectRatio } from 'vs/workbench/services/positronPlots/common/sizingPolicyFixedAspectRatio';

/**
 * This class implements a plot sizing policy that sizes the plot to a fixed 1:1
 * (square) aspect ratio.
 */
export class PlotSizingPolicySquare
	extends SizingPolicyFixedAspectRatio
	implements IPositronPlotSizingPolicy {

	constructor() {
		super(1);
	}

	public readonly id = 'square';
	public readonly name = nls.localize('plotSizingPolicy.square', "Square");
}

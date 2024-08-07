/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy, IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';

/**
 * TODO:
 * The simplest plot sizing policy. The plot is sized to fill the viewport exactly, no
 * matter what size it is.
 */
export class PlotSizingPolicyIntrinsic implements IPositronPlotSizingPolicy {
	public readonly id = 'intrinsic';
	// TODO: Make this a getter, make intrinsicSize of type IntrinsicSize and make getPlotSize set the name?
	public name = nls.localize('plotSizingPolicy.intrinsic', "Intrinsic");

	public getPlotSize(viewportSize: IPlotSize, intrinsicSize?: IPlotSize): IPlotSize | undefined {
		return intrinsicSize;
	}
}

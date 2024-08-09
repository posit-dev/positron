/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy, IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

/**
 * The simplest plot sizing policy. The plot is sized to fill the viewport exactly, no
 * matter what size it is.
 */
export class PlotSizingPolicyFill implements IPositronPlotSizingPolicy {
	public readonly id = 'fill';
	private readonly _name = nls.localize('plotSizingPolicy.fillViewport', "Fill");

	public getName(plot: PlotClientInstance): string {
		return this._name;
	}

	/**
	 * Computes the size of the plot in pixels, given the size of the viewport in pixels.
	 *
	 * @param viewportSize The size of the viewport in pixels.
	 * @returns The size of the plot in pixels.
	 */
	public getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined {
		return viewportSize;
	}
}

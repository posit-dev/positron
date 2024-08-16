/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';
import { SizingPolicyFixedAspectRatio } from 'vs/workbench/services/positronPlots/common/sizingPolicyFixedAspectRatio';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

/**
 * This class implements a plot sizing policy that sizes the plot to a fixed 3:4
 * (portrait) aspect ratio.
 */
export class PlotSizingPolicyPortrait
	extends SizingPolicyFixedAspectRatio
	implements IPositronPlotSizingPolicy {

	constructor() {
		super(3 / 4);
	}

	public readonly id = 'portrait';
	private readonly _name = nls.localize('plotSizingPolicy.portrait', "Portrait");

	public getName(plot: PlotClientInstance) {
		return this._name;
	}
}

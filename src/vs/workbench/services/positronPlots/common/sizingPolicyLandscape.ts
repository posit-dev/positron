/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy } from './sizingPolicy.js';
import * as nls from '../../../../nls.js';
import { SizingPolicyFixedAspectRatio } from './sizingPolicyFixedAspectRatio.js';
import { PlotClientInstance } from '../../languageRuntime/common/languageRuntimePlotClient.js';

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
	private readonly _name = nls.localize('plotSizingPolicy.landscape', "Landscape");

	public getName(plot: PlotClientInstance) {
		return this._name;
	}
}

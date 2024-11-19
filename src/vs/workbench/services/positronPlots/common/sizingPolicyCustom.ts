/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPlotSize, IPositronPlotSizingPolicy } from './sizingPolicy.js';
import * as nls from '../../../../nls.js';
import { PlotClientInstance } from '../../languageRuntime/common/languageRuntimePlotClient.js';

/**
 * The custom sizing policy. The plot is given a fixed size, specified by the
 * user, in pixels. The viewport size is ignored.
 */
export class PlotSizingPolicyCustom implements IPositronPlotSizingPolicy {
	public static ID = 'custom';

	public readonly id = PlotSizingPolicyCustom.ID;
	private readonly _name: string;

	constructor(public readonly size: IPlotSize) {
		this._name = nls.localize('plotSizingPolicy.Custom', "{0}×{1} (custom)", size.width, size.height);
	}

	public getName(plot: PlotClientInstance): string {
		return this._name;
	}

	public getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined {
		return this.size;
	}
}

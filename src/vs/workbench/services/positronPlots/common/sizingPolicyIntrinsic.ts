/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy, IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';
import { PlotUnit } from 'vs/workbench/services/languageRuntime/common/positronPlotComm';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

/**
 * This sizing policy does not provide a size for the plot; the language runtime will use the
 * intrinsic size of the plot, if it is known.
 */
export class PlotSizingPolicyIntrinsic implements IPositronPlotSizingPolicy {
	public readonly id = 'intrinsic';

	private readonly _name = nls.localize('plotSizingPolicy.intrinsic.defaultName', "Intrinsic");

	public getName(plot: PlotClientInstance) {
		const intrinsicSize = plot.intrinsicSize;

		if (!intrinsicSize) {
			return this._name;
		}

		// Determine the user-facing unit of measurement.
		let unit = '';
		switch (intrinsicSize.unit) {
			case PlotUnit.Inches:
				unit = nls.localize('plotSizingPolicy.intrinsic.unit.inches', 'in');
				break;
			case PlotUnit.Pixels:
				unit = nls.localize('plotSizingPolicy.intrinsic.unit.pixels', 'px');
				break;
		}

		return nls.localize(
			'plotSizingPolicy.intrinsic.name',
			"{0} ({1}{3}×{2}{3})",
			intrinsicSize.source,
			intrinsicSize.width,
			intrinsicSize.height,
			unit
		);
	}

	public getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined {
		// Don't specify a size; the language runtime will use the intrinsic size of the plot.
		return undefined;
	}
}

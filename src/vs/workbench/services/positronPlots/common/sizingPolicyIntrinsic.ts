/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPositronPlotSizingPolicy, IPlotSize } from 'vs/workbench/services/positronPlots/common/sizingPolicy';
import * as nls from 'vs/nls';
import { IntrinsicSize, PlotUnit } from 'vs/workbench/services/languageRuntime/common/positronPlotComm';
import { Emitter } from 'vs/base/common/event';

const _defaultName = nls.localize('plotSizingPolicy.intrinsic', "Intrinsic");

/**
 * This sizing policy does not provide a size for the plot; the language runtime will use the
 * intrinsic size of the plot, if it is known.
 */
export class PlotSizingPolicyIntrinsic implements IPositronPlotSizingPolicy {
	public readonly id = 'intrinsic';

	private _intrinsicSize?: IntrinsicSize;

	private readonly _didUpdateNameEmitter = new Emitter<string>();
	onDidUpdateName = this._didUpdateNameEmitter.event;

	public getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined {
		// Don't specify a size; the language runtime will use the intrinsic size of the plot.
		return undefined;
	}

	public get name(): string {
		if (!this._intrinsicSize) {
			return _defaultName;
		}

		// Determine the user-facing unit of measurement.
		let unit = '';
		switch (this._intrinsicSize.unit) {
			case PlotUnit.Inches:
				unit = 'in';
				break;
			case PlotUnit.Pixels:
				unit = 'px';
				break;
		}

		return `${this._intrinsicSize.source} (${this._intrinsicSize.width}${unit}×${this._intrinsicSize.height}${unit})`;
	}

	/**
	 * Set the intrinsic size of the current active plot.
	 *
	 * @param intrinsicSize The intrinsic size of the plot, if known.
	 */
	public setIntrinsicSize(intrinsicSize: IntrinsicSize | undefined): void {
		this._intrinsicSize = intrinsicSize;
		this._didUpdateNameEmitter.fire(this.name);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';

/**
 * Represents the size of a plot in pixels.
 */
export interface IPlotSize {
	height: number;
	width: number;
}

/**
 * Defines the expected interface for a Positron dynamic plot sizing policy.
 */
export interface IPositronPlotSizingPolicy {
	/** Unique ID for this sizing policy */
	id: string;

	/** The user-facing name of the sizing policy (shown in menus, etc.) */
	getName(plot: PlotClientInstance): string;

	/**
	 * Use the sizing policy to determine the size of the plot in pixels given the size of the
	 * viewport in pixels.
	 *
	 * @param viewportSize The size of the viewport in pixels
	 */
	getPlotSize(viewportSize: IPlotSize): IPlotSize | undefined;
}

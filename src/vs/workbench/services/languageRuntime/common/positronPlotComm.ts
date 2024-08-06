/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from plot.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm, PositronCommOptions } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

/**
 * The intrinsic size of the plot if known
 */
export interface IntrinsicSizeResult {
	/**
	 * The intrinsic size of a plot
	 */
	size?: IntrinsicSize;

}

/**
 * The intrinsic size of a plot
 */
export interface IntrinsicSize {
	/**
	 * The intrinsic width of the plot
	 */
	width: number;

	/**
	 * The intrinsic height of the plot
	 */
	height: number;

	/**
	 * The unit of measurement of the plot's dimensions
	 */
	unit: PlotUnit;

	/**
	 * The source of the intrinsic size e.g. 'Matplotlib'
	 */
	source: string;

}

/**
 * A rendered plot
 */
export interface PlotResult {
	/**
	 * The plot data, as a base64-encoded string
	 */
	data: string;

	/**
	 * The MIME type of the plot data
	 */
	mime_type: string;

}

/**
 * The size of a plot
 */
export interface PlotSize {
	/**
	 * The plot's height, in pixels
	 */
	height: number;

	/**
	 * The plot's width, in pixels
	 */
	width: number;

}

/**
 * Possible values for Format in Render
 */
export enum RenderFormat {
	Png = 'png',
	Jpeg = 'jpeg',
	Svg = 'svg',
	Pdf = 'pdf'
}

/**
 * Possible values for PlotUnit
 */
export enum PlotUnit {
	Pixels = 'pixels',
	Inches = 'inches'
}

/**
 * Event: Notification that a plot has been updated on the backend.
 */
export interface UpdateEvent {
}

/**
 * Event: Show a plot.
 */
export interface ShowEvent {
}

export enum PlotFrontendEvent {
	Update = 'update',
	Show = 'show'
}

export enum PlotBackendRequest {
	GetIntrinsicSize = 'get_intrinsic_size',
	Render = 'render'
}

export class PositronPlotComm extends PositronBaseComm {
	constructor(
		instance: IRuntimeClientInstance<any, any>,
		options?: PositronCommOptions<PlotBackendRequest>,
	) {
		super(instance, options);
		this.onDidUpdate = super.createEventEmitter('update', []);
		this.onDidShow = super.createEventEmitter('show', []);
	}

	/**
	 * Get the intrinsic size of a plot if known
	 *
	 * The intrinsic size of a plot is the size that the plot would be
	 * rendered at if no size constraints were applied by Positron.
	 *
	 *
	 * @returns The intrinsic size of the plot if known
	 */
	getIntrinsicSize(): Promise<IntrinsicSizeResult> {
		return super.performRpc('get_intrinsic_size', [], []);
	}

	/**
	 * Render a plot
	 *
	 * Requests a plot to be rendered. TODO: intrinsic size stuff. The plot
	 * data is returned in a base64-encoded string.
	 *
	 * @param size The requested size of the plot. If not provided, the
	 * intrinsic size of the plot will be used.
	 * @param pixelRatio The pixel ratio of the display device
	 * @param format The requested plot format
	 *
	 * @returns A rendered plot
	 */
	render(size: PlotSize | undefined, pixelRatio: number, format: RenderFormat | undefined): Promise<PlotResult> {
		return super.performRpc('render', ['size', 'pixel_ratio', 'format'], [size, pixelRatio, format]);
	}


	/**
	 * Notification that a plot has been updated on the backend.
	 */
	onDidUpdate: Event<UpdateEvent>;
	/**
	 * Show a plot.
	 */
	onDidShow: Event<ShowEvent>;
}


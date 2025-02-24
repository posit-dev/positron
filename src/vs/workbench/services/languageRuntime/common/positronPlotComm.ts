/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from plot.json; do not edit.
//

import { Event } from '../../../../base/common/event.js';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm.js';
import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';

/**
 * The intrinsic size of a plot, if known
 */
export interface IntrinsicSize {
	/**
	 * The width of the plot
	 */
	width: number;

	/**
	 * The height of the plot
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
	Pdf = 'pdf',
	Tiff = 'tiff'
}

/**
 * Possible values for PlotUnit
 */
export enum PlotUnit {
	Pixels = 'pixels',
	Inches = 'inches'
}

/**
 * Parameters for the Render method.
 */
export interface RenderParams {
	/**
	 * The requested size of the plot. If not provided, the plot will be
	 * rendered at its intrinsic size.
	 */
	size?: PlotSize;

	/**
	 * The pixel ratio of the display device
	 */
	pixel_ratio: number;

	/**
	 * The requested plot format
	 */
	format: RenderFormat;
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
	 * Get the intrinsic size of a plot, if known.
	 *
	 * The intrinsic size of a plot is the size at which a plot would be if
	 * no size constraints were applied by Positron.
	 *
	 *
	 * @returns The intrinsic size of a plot, if known
	 */
	getIntrinsicSize(): Promise<IntrinsicSize | undefined> {
		return super.performRpc('get_intrinsic_size', [], []);
	}

	/**
	 * Render a plot
	 *
	 * Requests a plot to be rendered. The plot data is returned in a
	 * base64-encoded string.
	 *
	 * @param size The requested size of the plot. If not provided, the plot
	 * will be rendered at its intrinsic size.
	 * @param pixelRatio The pixel ratio of the display device
	 * @param format The requested plot format
	 *
	 * @returns A rendered plot
	 */
	render(size: PlotSize | undefined, pixelRatio: number, format: RenderFormat): Promise<PlotResult> {
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


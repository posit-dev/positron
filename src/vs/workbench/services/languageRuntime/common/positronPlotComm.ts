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
 * Possible values for Format in Render
 */
export enum RenderFormat {
	Png = 'png',
	Jpeg = 'jpeg',
	Svg = 'svg',
	Pdf = 'pdf'
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
	 * Render a plot
	 *
	 * Requests a plot to be rendered at a given height and width. The plot
	 * data is returned in a base64-encoded string.
	 *
	 * @param height The requested plot height, in pixels
	 * @param width The requested plot width, in pixels
	 * @param pixelRatio The pixel ratio of the display device
	 * @param format The requested plot format
	 *
	 * @returns A rendered plot
	 */
	render(height: number, width: number, pixelRatio: number, format: RenderFormat): Promise<PlotResult> {
		return super.performRpc('render', ['height', 'width', 'pixel_ratio', 'format'], [height, width, pixelRatio, format]);
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


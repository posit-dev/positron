/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from plot.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
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
 * Event: Notification that a plot has been updated on the backend.
 */
export interface UpdateEvent {
}

export enum PlotFrontendEvent {
	Update = 'update'
}

export class PositronPlotComm extends PositronBaseComm {
	constructor(instance: IRuntimeClientInstance<any, any>) {
		super(instance);
		this.onDidUpdate = super.createEventEmitter('update', []);
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
	 *
	 * @returns A rendered plot
	 */
	render(height: number, width: number, pixelRatio: number): Promise<PlotResult> {
		return super.performRpc('render', ['height', 'width', 'pixel_ratio'], [height, width, pixelRatio]);
	}

	/**
	 * Save a plot
	 *
	 * Requests a plot to be saved to a file.
	 *
	 * @param path The path to save the plot to
	 * @param height The requested plot height, in pixels
	 * @param width The requested plot width, in pixels
	 * @param pixelRatio The pixel ratio of the display device
	 * @param format The format to save the plot in
	 *
	 * @returns The path to the saved plot
	*/
	// save(path: string, height: number, width: number, pixelRatio: number, format: string): Promise<string> {
	// 	return super.performRpc('save', ['path', 'height', 'width', 'pixel_ratio', 'format'], [path, height, width, pixelRatio, format]);
	// }
	save(path: string, height: number, width: number): Promise<string> {
		return super.performRpc('save', ['path', 'height', 'width'], [path, height, width]);
	}


	/**
	 * Notification that a plot has been updated on the backend.
	 */
	onDidUpdate: Event<UpdateEvent>;
}


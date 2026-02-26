/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
 * The plot's metadata
 */
export interface PlotMetadata {
	/**
	 * A unique, human-readable name for the plot
	 */
	name: string;

	/**
	 * The kind of plot e.g. 'Matplotlib', 'ggplot2', etc.
	 */
	kind: string;

	/**
	 * The ID of the code fragment that produced the plot
	 */
	execution_id: string;

	/**
	 * The code fragment that produced the plot
	 */
	code: string;

	/**
	 * The origin of the plot, if known
	 */
	origin?: PlotOrigin;

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

	/**
	 * The settings used to render the plot
	 */
	settings?: PlotRenderSettings;

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
 * The origin (source) of a plot
 */
export interface PlotOrigin {
	/**
	 * The URI of the document containing the code that produced the plot, if
	 * available
	 */
	uri: string;

	/**
	 * The range within the document at uri that produced the plot, if
	 * available
	 */
	range?: PlotRange;

}

/**
 * The range of a plot within a document
 */
export interface PlotRange {
	/**
	 * The line number on which the plot starts (0-indexed)
	 */
	start_line: number;

	/**
	 * The character number on which the plot starts (0-indexed)
	 */
	start_character: number;

	/**
	 * The line number on which the plot ends (0-indexed)
	 */
	end_line: number;

	/**
	 * The character number on which the plot ends (0-indexed)
	 */
	end_character: number;

}

/**
 * The settings used to render the plot
 */
export interface PlotRenderSettings {
	/**
	 * Plot size to render the plot to
	 */
	size: PlotSize;

	/**
	 * The pixel ratio of the display device
	 */
	pixel_ratio: number;

	/**
	 * Format in which to render the plot
	 */
	format: PlotRenderFormat;

}

/**
 * Possible values for PlotUnit
 */
export enum PlotUnit {
	Pixels = 'pixels',
	Inches = 'inches'
}

/**
 * Possible values for PlotRenderFormat
 */
export enum PlotRenderFormat {
	Png = 'png',
	Jpeg = 'jpeg',
	Svg = 'svg',
	Pdf = 'pdf',
	Tiff = 'tiff'
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
	format: PlotRenderFormat;
}

/**
 * Parameters for the Update method.
 */
export interface UpdateParams {
	/**
	 * Optional pre-rendering data for immediate display
	 */
	pre_render?: PlotResult;
}

/**
 * Event: Notification that a plot has been updated on the backend.
 */
export interface UpdateEvent {
	/**
	 * Optional pre-rendering data for immediate display
	 */
	pre_render?: PlotResult;

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
	GetMetadata = 'get_metadata',
	Render = 'render'
}

export class PositronPlotComm extends PositronBaseComm {
	constructor(
		instance: IRuntimeClientInstance<any, any>,
		options?: PositronCommOptions<PlotBackendRequest>,
	) {
		super(instance, options);
		this.onDidUpdate = super.createEventEmitter('update', ['pre_render']);
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
	 * Get metadata for the plot
	 *
	 * Get metadata for the plot
	 *
	 *
	 * @returns The plot's metadata
	 */
	getMetadata(): Promise<PlotMetadata> {
		return super.performRpc('get_metadata', [], []);
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
	render(size: PlotSize | undefined, pixelRatio: number, format: PlotRenderFormat): Promise<PlotResult> {
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


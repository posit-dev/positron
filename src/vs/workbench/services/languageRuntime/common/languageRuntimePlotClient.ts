/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * The possible types of messages that can be sent to the language runtime as
 * requests to the plot backend.
 */
export enum PlotClientMessageTypeInput {
	/** A request to render the plot at a specific size */
	Render = 'render',
}


/**
 * The possible types of messages that can be sent from the plot backend.
 */
export enum PlotClientMessageTypeOutput {
	/** Rendered plot output */
	Image = 'image',
}

/**
 * A message used to send data to the language runtime plot client.
 */
export interface IPlotClientMessageInput {
	msg_type: PlotClientMessageTypeInput;
}

/**
 * A message used to request that a plot render at a specific size.
 */
export interface IPlotClientMessageRender extends IPlotClientMessageInput {
	/** The plot height, in pixels */
	height: number;

	/** The plot width, in pixels */
	width: number;
}

/**
 * A message used to receive data from the language runtime plot client.
 */
export interface IPlotClientMessageOutput {
	msg_type: PlotClientMessageTypeOutput;
}

/**
 * A message used to receive rendered plot output.
 */
export interface IPlotClientMessageImage extends IPlotClientMessageOutput {
	/**
	 * The data for the plot image, as a base64-encoded string. We need to send
	 * the plot data as a string because the underlying image file exists only
	 * on the machine running the language runtime process.
	 */
	data: string;
}

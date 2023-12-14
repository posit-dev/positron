/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import path = require('path');
import fs = require('fs');
import * as vscode from 'vscode';

/**
 * The request from the front end to render the plot at a specific size.
 */
interface IPlotRenderRequest {
	height: number;
	width: number;
	pixel_ratio: number;
}

/**
 * A ZedPLOT instance; simulates a real plot instance by responding to render
 * requests and delivering an SVG image at the requested size.
 */
export class ZedPlot {
	/**
	 * Emitter that handles outgoing messages to the front end
	 */
	private readonly _onDidEmitData = new vscode.EventEmitter<object>();
	onDidEmitData: vscode.Event<object> = this._onDidEmitData.event;

	public readonly id: string;

	constructor(private readonly context: vscode.ExtensionContext,
		private readonly letter: string) {
		this.id = randomUUID();
	}

	/**
	 * Handle message from the front end.
	 *
	 * @param message The message to handle
	 */
	public handleMessage(message: any): void {
		switch (message.method) {
			case 'render':
				this.emitImage(message.params as IPlotRenderRequest);
				break;
			default:
				console.error(`ZedPlot ${this.id} got unknown message type: ${message.msg_type}`);
				break;
		}
	}

	/**
	 * Handles a request to render the plot at a specific size.
	 *
	 * @param request The request to render the plot at a specific size
	 */
	public emitImage(request: IPlotRenderRequest): void {
		// Read the plot data from the file in the extension's resources folder.
		const plotSvgPath = path.join(this.context.extensionPath, 'resources', 'zed-plot.svg');
		const plotSvg = fs.readFileSync(plotSvgPath);

		// The plot data is a template, so we need to replace the width and height
		// with the requested values. This makes the final SVG show the user the plot
		// rendered at the size they requested.
		const plotSvgContents = plotSvg.toString();
		const finalSvg = plotSvgContents
			.replace('$title', this.letter)
			.replace('$width', request.width.toString())
			.replace('$height', request.height.toString());

		// Encode the data to base64.
		const plotSvgBase64 = Buffer.from(finalSvg).toString('base64');

		// Emit to the front end.
		this._onDidEmitData.fire({
			jsonrpc: '2.0',
			result: {
				data: plotSvgBase64,
				mime_type: 'image/svg+xml',
			}
		});
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { uuid } from '@jupyter-widgets/base';
import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { Widget } from '@lumino/widgets';
import { OutputItem, RendererContext } from 'vscode-notebook-renderer';
import { Messaging } from './messaging';
import { IGetPreferredRendererResultToWebview } from '../../../../src/vs/workbench/services/languageRuntime/common/positronIPyWidgetsWebviewMessages';

export class PositronRenderer extends Widget implements IRenderMime.IRenderer {
	private readonly _mimeType: string;

	constructor(
		options: IRenderMime.IRendererOptions,
		private readonly _messaging: Messaging,
		private readonly _context: RendererContext<any>,
	) {
		super();

		this._mimeType = options.mimeType;
	}

	public async renderModel(model: IRenderMime.IMimeModel): Promise<void> {
		// TODO: Try catch and handle like Jupyter Lab?
		//       console.log('Error displaying widget');
		//       console.log(err);
		//       this.node.textContent = 'Error displaying widget';
		//       this.addClass('jupyter-widgets');

		// Request the renderer ID for the preferred mime type.
		const msgId = uuid();
		this._messaging.postMessage({ type: 'get_preferred_renderer', msg_id: msgId, mime_type: this._mimeType });

		// Wait for the response from the main thread.
		const rendererId = await new Promise<IGetPreferredRendererResultToWebview['renderer_id']>((resolve, reject) => {
			setTimeout(() => reject(new Error('Timeout waiting for renderer ID')), 5000);
			const disposable = this._messaging.onDidReceiveMessage((message) => {
				if (message.type === 'get_preferred_renderer_result' && message.parent_id === msgId) {
					disposable.dispose();
					resolve(message.renderer_id);
				}
			});
		});

		if (!rendererId) {
			throw new Error(`No preferred renderer for mime type: ${this._mimeType}`);
		}

		// Get the VSCode renderer.
		const renderer = await this._context.getRenderer(rendererId);
		if (!renderer) {
			throw new Error(`Renderer not found: ${rendererId}`);
		}

		console.log('PositronRenderer.renderModel', rendererId, this._mimeType, model.data[this._mimeType]);
		const source = model.data[this._mimeType] as any;
		const sourceString = typeof source === 'string' ? source : JSON.stringify(source);
		const sourceBytes = new TextEncoder().encode(sourceString);

		// Convert Jupyter mime types to VSCode mime types, if needed.
		let vscodeMimeType = this._mimeType;
		switch (vscodeMimeType) {
			case 'application/vnd.jupyter.stdout':
				vscodeMimeType = 'application/vnd.code.notebook.stdout';
				break;
			case 'application/vnd.jupyter.stderr':
				vscodeMimeType = 'application/vnd.code.notebook.stderr';
				break;
		}

		const outputItem = {
			// TODO: Do we need the actual message ID? How can we get that?
			id: uuid(),
			mime: vscodeMimeType,
			data() {
				return sourceBytes;
			},
			text() {
				return sourceString;
			},
			json() {
				return source;
			},
			blob() {
				return new Blob([sourceBytes], { type: this.mime });
			},
			// TODO: Do we need the actual message metadata? How can we get that?
			metadata: {},
		} as OutputItem;

		// TODO: Link to this renderer's controller?
		const controller = new AbortController();

		await renderer.renderOutputItem(outputItem, this.node, controller.signal);
	}
}

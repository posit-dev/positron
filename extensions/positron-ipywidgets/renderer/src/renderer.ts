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

/**
 * A Jupyter widget renderer that delegates rendering to a VSCode notebook renderer.
 * This is required by output widgets which intercept outputs.
 */
export class PositronRenderer extends Widget implements IRenderMime.IRenderer {
	/** The preferred mime type, determined by the render mime registry. */
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
		// Get the VSCode mime type.
		const vscodeMimeType = jupyterToVscodeMimeType(this._mimeType);

		// Request the renderer ID for the preferred mime type.
		const msgId = uuid();
		this._messaging.postMessage({ type: 'get_preferred_renderer', msg_id: msgId, mime_type: vscodeMimeType });

		// Wait for the response from the main thread.
		const rendererId = await new Promise<IGetPreferredRendererResultToWebview['renderer_id']>((resolve, reject) => {
			const timeout = setTimeout(() => {
				disposable.dispose();
				reject(new Error('Timeout waiting for renderer ID'));
			}, 5000);
			const disposable = this._messaging.onDidReceiveMessage((message) => {
				if (message.type === 'get_preferred_renderer_result' && message.parent_id === msgId) {
					clearTimeout(timeout);
					disposable.dispose();
					resolve(message.renderer_id);
				}
			});
		});

		if (!rendererId) {
			throw new Error(`No renderer found for mime type: ${vscodeMimeType}`);
		}

		// Get the VSCode renderer.
		const renderer = await this._context.getRenderer(rendererId);
		if (!renderer) {
			throw new Error(`Renderer not found: ${rendererId}`);
		}

		// Render the model using the VSCode renderer, stubbing as needed.
		const sourceJson = model.data[this._mimeType];
		const outputItem = {
			id: uuid(),
			mime: vscodeMimeType,
			data() {
				return new TextEncoder().encode(this.text());
			},
			text() {
				return typeof sourceJson === 'string' ? sourceJson : JSON.stringify(sourceJson);
			},
			json() {
				return sourceJson;
			},
			blob() {
				return new Blob([this.data()], { type: this.mime });
			},
			metadata: {},
		} as OutputItem;
		const controller = new AbortController();
		await renderer.renderOutputItem(outputItem, this.node, controller.signal);
	}
}

/** Map from Jupyter to VSCode mime types, for types that differ. */
function jupyterToVscodeMimeType(mimeType: string): string {
	switch (mimeType) {
		case 'application/vnd.jupyter.stdout':
			return 'application/vnd.code.notebook.stdout';
		case 'application/vnd.jupyter.stderr':
			return 'application/vnd.code.notebook.stderr';
		default:
			return mimeType;
	}
}

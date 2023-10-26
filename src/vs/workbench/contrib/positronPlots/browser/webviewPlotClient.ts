/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, encodeBase64 } from 'vs/base/common/buffer';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IPositronPlotMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';

/**
 * A Positron plot instance that is backed by a webview.
 */
export class WebviewPlotClient extends Disposable implements IPositronPlotClient {

	public readonly metadata: IPositronPlotMetadata;

	private _thumbnail: VSBuffer | undefined;

	private _onDidRenderThumbnail: Emitter<string>;

	private _claimed: boolean = false;

	constructor(public readonly webview: INotebookOutputWebview,
		message: ILanguageRuntimeMessageOutput,
		code?: string) {
		super();

		// Create the metadata for the plot.
		this.metadata = {
			id: message.id,
			parent_id: message.parent_id,
			created: Date.parse(message.when),
			runtime_id: webview.runtimeId,
			code: code ? code : '',
		};

		this._register(this.webview.onDidRender(e => {
			setTimeout(() => {
				if (this._claimed) {
					this.renderThumbnail();
				}
			}, 500);
		}));

		this._onDidRenderThumbnail = new Emitter<string>();
		this.onDidRenderThumbnail = this._onDidRenderThumbnail.event;
	}

	get id(): string {
		return this.metadata.id;
	}

	get thumbnailUri(): string | undefined {
		if (this._thumbnail) {
			return this.asDataUri(this._thumbnail);
		}
		return undefined;
	}

	public claim(claimant: any) {
		this.webview.webview.claim(claimant, undefined);
		this._claimed = true;
	}

	public layoutWebviewOverElement(ele: HTMLElement) {
		this.webview.webview.layoutWebviewOverElement(ele);
	}

	public release(claimant: any) {
		this.webview.webview.release(claimant);
		this._claimed = false;
	}

	public renderThumbnail() {
		this.webview.webview.captureContentsAsPng().then(data => {
			if (data) {
				this._thumbnail = data;
				this._onDidRenderThumbnail.fire(this.asDataUri(data));
			}
		});
	}

	private asDataUri(buffer: VSBuffer) {
		return `data:image/png;base64,${encodeBase64(buffer)}`;
	}

	public readonly onDidRenderThumbnail: Event<string>;

	override dispose(): void {
		super.dispose();
	}
}

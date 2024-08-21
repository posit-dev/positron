/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, VSBuffer } from 'vs/base/common/buffer';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { getExtensionForMimeType } from 'vs/base/common/mime';
import { localize } from 'vs/nls';
import { joinPath } from 'vs/base/common/resources';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { INotebookWebviewMessage } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { FromWebviewMessage, IClickedDataUrlMessage } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewMessages';
import { IScopedRendererMessaging } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IOverlayWebview, IWebviewElement } from 'vs/workbench/contrib/webview/browser/webview';

interface NotebookOutputWebviewOptions<WType extends IOverlayWebview | IWebviewElement = IOverlayWebview> {
	readonly id: string;
	readonly sessionId: string;
	readonly webview: WType;
	rendererMessaging?: IScopedRendererMessaging;
}


/**
 * A notebook output webview wraps a webview that contains rendered HTML content
 * from notebooks (including raw HTML or the Notebook Renderer API).
 */
export class NotebookOutputWebview<WType extends IOverlayWebview | IWebviewElement = IOverlayWebview> extends Disposable implements INotebookOutputWebview<WType> {

	private readonly _onDidRender = new Emitter<void>;
	private readonly _onDidReceiveMessage = new Emitter<INotebookWebviewMessage>();
	readonly id: string;
	readonly sessionId: string;
	readonly webview: WType;

	/**
	 * Create a new notebook output webview.
	 *
	 * @param id A unique ID for this webview; typically the ID of the message
	 *   that created it.
	 * @param sessionId The ID of the runtime that owns this webview.
	 * @param webview The underlying webview.
	 * @param rendererMessaging Optional scoped messaging instance for communicating between a
	 *   runtime and the renderer.
	 */
	constructor(
		{
			id,
			sessionId,
			webview,
			rendererMessaging
		}: NotebookOutputWebviewOptions<WType>,
		@IFileDialogService private _fileDialogService: IFileDialogService,
		@IFileService private _fileService: IFileService,
		@IWorkspaceContextService private _workspaceContextService: IWorkspaceContextService,
		@ILogService private _logService: ILogService,
		@INotificationService private _notificationService: INotificationService,
	) {
		super();

		// Ensure that the underlying webview is disposed when notebook output webview is disposed.
		this._register(webview);

		this.id = id;
		this.sessionId = sessionId;
		this.webview = webview;
		this.onDidRender = this._onDidRender.event;
		this._register(this._onDidRender);
		this._register(this._onDidReceiveMessage);

		if (rendererMessaging) {
			this._register(rendererMessaging);
			rendererMessaging.receiveMessageHandler = async (rendererId, message) => {
				this.webview.postMessage({
					__vscode_notebook_message: true,
					type: 'customRendererMessage',
					rendererId,
					message,
				});

				return true;
			};
		}

		this._register(webview.onMessage(e => {
			const data: FromWebviewMessage | { readonly __vscode_notebook_message: undefined } = e.message;

			if (!data.__vscode_notebook_message) {
				return;
			}

			switch (data.type) {
				case 'customRendererMessage':
					rendererMessaging?.postMessage(data.rendererId, data.message);
					break;
				case 'positronRenderComplete':
					this._onDidRender.fire();
					break;
				case 'clicked-data-url':
					this._downloadData(data);
					break;
			}

		}));
	}

	onDidRender: Event<void>;

	private async _downloadData(payload: IClickedDataUrlMessage): Promise<void> {
		try {

			if (typeof payload.data !== 'string') {
				return;
			}

			const [splitStart, splitData] = payload.data.split(';base64,');
			if (!splitData || !splitStart) {
				return;
			}

			const defaultDir = this._workspaceContextService.getWorkspace().folders[0]?.uri ?? await this._fileDialogService.defaultFilePath();
			let defaultName: string;
			if (payload.downloadName) {
				defaultName = payload.downloadName;
			} else {
				const mimeType = splitStart.replace(/^data:/, '');
				const candidateExtension = mimeType && getExtensionForMimeType(mimeType);
				defaultName = candidateExtension ? `download${candidateExtension}` : 'download';
			}

			const defaultUri = joinPath(defaultDir, defaultName);
			const newFileUri = await this._fileDialogService.showSaveDialog({
				defaultUri
			});
			if (!newFileUri) {
				return;
			}

			let buff: VSBuffer;
			try {
				buff = decodeBase64(splitData);
			} catch (e) {
				throw new Error(localize("base64DecodeError", "Failed to decode base64 data: {0}", e.message));
			}

			await this._fileService.writeFile(newFileUri, buff);
		} catch (error) {
			this._logService.error('Failed to download file', error);
			this._notificationService.error(
				localize('failedToDownloadFile', 'Failed to download file: {}', error.message)
			);
		}
	}
}

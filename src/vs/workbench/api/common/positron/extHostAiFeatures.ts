/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type * as positron from 'positron';

import { Disposable } from '../extHostTypes.js';
import * as extHostProtocol from './extHost.positron.protocol.js';
import * as extHostTypes from '../extHostTypes.js';
import * as typeConvert from '../extHostTypeConverters.js';

class ChatResponse implements positron.ai.ChatResponse {
	private _isClosed: boolean;

	constructor(
		private readonly _proxy: extHostProtocol.MainThreadAiFeaturesShape,
		private readonly _id: string,
	) {
		this._isClosed = false;
	}

	write(content: string | vscode.MarkdownString): void {
		if (this._isClosed) {
			throw new Error('Response stream is closed');
		}

		const part = new extHostTypes.ChatResponseMarkdownPart(content);
		const dto = typeConvert.ChatResponseMarkdownPart.from(part);
		this._proxy.$taskResponse(this._id, dto);
	}

	writeTextEdit(uri: vscode.Uri, edits: vscode.TextEdit | vscode.TextEdit[]): void {
		if (this._isClosed) {
			throw new Error('Response stream is closed');
		}

		const part = new extHostTypes.ChatResponseTextEditPart(uri, edits);
		const dto = typeConvert.ChatResponseTextEditPart.from(part);
		this._proxy.$taskResponse(this._id, dto);
	}

	close(): void {
		this._isClosed = true;
	}
}

export class ExtHostAiFeatures implements extHostProtocol.ExtHostAiFeaturesShape {

	private readonly _proxy: extHostProtocol.MainThreadAiFeaturesShape;
	private readonly _registeredAssistants = new Map<string, positron.ai.Assistant>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
		// Trigger creation of proxy to main thread
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadAiFeatures);
	}

	registerAssistant(extension: vscode.Extension<any>, assistant: positron.ai.Assistant): Disposable {
		// Unique ID for each extension-assistant combination
		const id = `${extension.id}-${assistant.identifier}`;
		this._registeredAssistants.set(id, assistant);
		this._proxy.$registerAssistant(id, assistant.name);

		return new Disposable(() => {
			this._proxy.$unregisterAssistant(id);
			this._registeredAssistants.delete(id);
		});
	}

	async $provideChatResponse(assistantId: string, request: positron.ai.ChatRequest, taskId: string,
		token: vscode.CancellationToken): Promise<void> {

		const assistant = this._registeredAssistants.get(assistantId);
		if (!assistant) {
			throw new Error('Assistant not found.');
		}

		const response = new ChatResponse(this._proxy, taskId);

		try {
			const loc = request.location;
			switch (loc) {
				case 'panel':
					await assistant.chatResponseProvider(request, response, token);
					break;
				case 'terminal':
					await assistant.terminalResponseProvider(request, response, token);
					break;
				case 'editor':
					await assistant.editorResponseProvider(request, response, token);
					break;
				default:
					throw new Error(`Unsupported location \`${loc}\` in chat request.`);
			}
		} finally {
			response.close();
		}
	}
}

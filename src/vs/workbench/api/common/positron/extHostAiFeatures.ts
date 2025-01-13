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
import { ExtHostDocuments } from '../extHostDocuments.js';
import { revive } from '../../../../base/common/marshalling.js';
import { IPositronChatContext } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { ChatAgentLocation, IChatAgentRequest, IChatAgentResult } from '../../../contrib/chat/common/chatAgents.js';
import { CommandsConverter, ExtHostCommands } from '../extHostCommands.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Dto } from '../../../services/extensions/common/proxyIdentifier.js';
import { IChatAgentHistoryEntryDto } from '../extHost.protocol.js';
import { ExtHostLanguageModels } from '../extHostLanguageModels.js';
import { IChatMessage } from '../../../contrib/chat/common/languageModels.js';
import { SerializedError } from '../../../../base/common/errors.js';

class ChatResponse {
	private _isClosed: boolean;

	constructor(
		private readonly _proxy: extHostProtocol.MainThreadAiFeaturesShape,
		private readonly _id: string,
		private readonly _commandsConverter: CommandsConverter,
		private readonly _disposables: DisposableStore,
	) {
		this._isClosed = false;
	}

	markdown(content: string | vscode.MarkdownString): void {
		if (this._isClosed) {
			throw new Error('Response stream is closed');
		}

		const part = new extHostTypes.ChatResponseMarkdownPart(content);
		const dto = typeConvert.ChatResponseMarkdownPart.from(part);
		this._proxy.$chatTaskResponse(this._id, dto);
	}

	textEdit(uri: vscode.Uri, edits: vscode.TextEdit | vscode.TextEdit[]): void {
		if (this._isClosed) {
			throw new Error('Response stream is closed');
		}

		const part = new extHostTypes.ChatResponseTextEditPart(uri, edits);
		const dto = typeConvert.ChatResponseTextEditPart.from(part);
		this._proxy.$chatTaskResponse(this._id, dto);
	}

	button(command: vscode.Command) {
		if (this._isClosed) {
			throw new Error('Response stream is closed');
		}

		const part = new extHostTypes.ChatResponseCommandButtonPart(command);
		const dto = typeConvert.ChatResponseCommandButtonPart.from(part, this._commandsConverter, this._disposables);
		this._proxy.$chatTaskResponse(this._id, dto);
	}

	// TODO: Implment more vscode.ChatResponseStream methods.

	close(): void {
		this._isClosed = true;
	}
}

export class ExtHostAiFeatures implements extHostProtocol.ExtHostAiFeaturesShape {

	private readonly _proxy: extHostProtocol.MainThreadAiFeaturesShape;
	private readonly _registeredLanguageModels = new Map<string, {
		provider: positron.ai.LanguageModelChatProvider;
		extension: IExtensionDescription;
	}>();
	private readonly _registeredChatParticipants = new Map<string, positron.ai.ChatParticipant>();
	private readonly _disposables: DisposableStore = new DisposableStore();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _languageModels: ExtHostLanguageModels,
		private readonly _documents: ExtHostDocuments,
		private readonly _commands: ExtHostCommands,
	) {
		// Trigger creation of proxy to main thread
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadAiFeatures);
	}

	registerChatParticipant(extension: IExtensionDescription, participant: positron.ai.ChatParticipant): Disposable {
		this._registeredChatParticipants.set(participant.id, participant);
		this._proxy.$registerChatParticipant(extension, {
			...participant,
			locations: participant.locations.map((v) => typeConvert.ChatLocation.from(v)),
		});
		return new Disposable(() => {
			this._proxy.$unregisterChatParticipant(participant.id);
			this._registeredLanguageModels.delete(participant.id);
		});
	}

	registerLanguageModel(extension: IExtensionDescription, model: positron.ai.LanguageModelChatProvider): Disposable {
		this._registeredLanguageModels.set(model.identifier, { provider: model, extension });
		this._proxy.$registerLanguageModel(model.identifier, extension, model.name);

		return new Disposable(() => {
			this._proxy.$unregisterLanguageModel(model.identifier);
			this._registeredLanguageModels.delete(model.identifier);
		});
	}

	async sendChatRequest(
		id: string,
		messages: vscode.LanguageModelChatMessage[],
		options: { [key: string]: any },
		response: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<void> {
		const model = this._registeredLanguageModels.get(id);

		if (!model) {
			throw new Error('Requested language model not found.');
		}

		return model.provider.provideChatResponse(messages, options, response, token);
	}

	private async buildChatParticipantRequest(request: Dto<IChatAgentRequest>): Promise<vscode.ChatRequest> {
		const _request = revive<IChatAgentRequest>(request);

		// Convert additional provided location data for use in extension
		let location2: vscode.ChatRequestEditorData | vscode.ChatRequestNotebookData | undefined;
		if (_request.locationData?.type === ChatAgentLocation.Editor) {
			const document = this._documents.getDocument(_request.locationData.document);
			location2 = new extHostTypes.ChatRequestEditorData(
				document,
				typeConvert.Selection.to(_request.locationData.selection),
				typeConvert.Range.to(_request.locationData.wholeRange)
			);
		} else if (_request.locationData?.type === ChatAgentLocation.Notebook) {
			const cell = this._documents.getDocument(_request.locationData.sessionInputUri);
			location2 = new extHostTypes.ChatRequestNotebookData(cell);
		}

		// Get the language model used for this request
		let model: vscode.LanguageModelChat | undefined;
		if (request.userSelectedModelId && this._registeredLanguageModels.has(request.userSelectedModelId)) {
			const { extension } = this._registeredLanguageModels.get(request.userSelectedModelId)!;
			model = await this._languageModels.getLanguageModelByIdentifier(extension, request.userSelectedModelId);
		} else if (this._registeredLanguageModels.size > 0) {
			const firstModel = this._registeredLanguageModels.values().next().value!;
			model = await this._languageModels.getLanguageModelByIdentifier(firstModel.extension, firstModel.provider.identifier);
		}

		if (!model) {
			throw new Error('No language model available.');
		}

		return typeConvert.ChatAgentRequest.to(_request, location2, model);
	}

	private buildChatParticipantHistory(history: IChatAgentHistoryEntryDto[]): (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] {
		const res: (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] = [];

		for (const entry of history) {
			const result = typeConvert.ChatAgentResult.to(entry.result);

			const vars = entry.request.variables.variables.filter(v => !v.isTool).map(typeConvert.ChatPromptReference.to);
			const tools = entry.request.variables.variables.filter(v => v.isTool).map(typeConvert.ChatLanguageModelToolReference.to);
			const turn = new extHostTypes.ChatRequestTurn(entry.request.message, entry.request.command, vars, entry.request.agentId, tools);
			res.push(turn);

			const parts = entry.response.map(r => typeConvert.ChatResponsePart.toContent(r, this._commands.converter)).filter((e) => !!e);
			res.push(new extHostTypes.ChatResponseTurn(parts, result, entry.request.agentId, entry.request.command));
		}

		return res;
	}

	async $provideResponse(request: Dto<IChatAgentRequest>, history: IChatAgentHistoryEntryDto[], context: IPositronChatContext, taskId: string, token: vscode.CancellationToken): Promise<IChatAgentResult> {
		// Select the requested chat participant
		const participant = this._registeredChatParticipants.get(request.agentId);
		if (!participant) {
			throw new Error('Requested chat participant not found.');
		}

		// Build chat response object
		const response = new ChatResponse(this._proxy, taskId, this._commands.converter, this._disposables) as ChatResponse & vscode.ChatResponseStream; // TODO: remove type assertion

		// Build chat request object
		const _request = await this.buildChatParticipantRequest(request);

		// Build chat context object
		const _context = {
			history: this.buildChatParticipantHistory(history),
			positron: { context },
		};

		try {
			// Invoke the registered chat participant
			return await participant.requestHandler(_request, _context, response, token) ?? {};
		} finally {
			response.close();
		}
	}

	async $provideTokenCount(id: string, message: string | IChatMessage, token: vscode.CancellationToken): Promise<number> {
		const model = this._registeredLanguageModels.get(id);
		if (!model) {
			throw new Error('Requested language model not found.');
		}

		const _message = typeof message === 'string'
			? message
			: typeConvert.LanguageModelChatMessage.to(message);

		return await model.provider.provideTokenCount(_message, token);
	}

	async $provideLanguageModelResponse(id: string, taskId: string, messages: IChatMessage[], from: ExtensionIdentifier, options: { [name: string]: any }, token: vscode.CancellationToken): Promise<any> {
		const model = this._registeredLanguageModels.get(id);
		if (!model) {
			throw new Error('Requested language model not found.');
		}

		const _messages = messages.map((message) => typeConvert.LanguageModelChatMessage.to(message));

		const promise = model.provider.provideLanguageModelResponse(_messages, options, from.value, {
			report: (content) => this._proxy.$languageModelTaskResponse(taskId, {
				index: 0,
				part: { type: 'text', value: content.part },
			}),
		}, token);

		promise.then((res) => {
			this._proxy.$languageModelTaskResolve(taskId, res);
		}, err => {
			const { name, message } = err as Error;
			const error: SerializedError = {
				name,
				message,
				stack: err.stacktrace || err.stack,
				$isError: true,
				noTelemetry: true,
			};
			this._proxy.$languageModelTaskResolve(taskId, undefined, error);
		});
	}

	async getCurrentPlotUri(): Promise<string | undefined> {
		return this._proxy.$getCurrentPlotUri();
	}
}

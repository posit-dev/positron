/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type * as positron from 'positron';

import { Disposable } from '../extHostTypes.js';
import * as extHostProtocol from './extHost.positron.protocol.js';
import * as typeConvert from '../extHostTypeConverters.js';
import { ExtHostCommands } from '../extHostCommands.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { isToolInvocationContext, IToolInvocationContext } from '../../../contrib/chat/common/languageModelToolsService.js';
import { IChatRequestData, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { ChatAgentLocation } from '../../../contrib/chat/common/chatAgents.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export class ExtHostAiFeatures implements extHostProtocol.ExtHostAiFeaturesShape {

	private readonly _proxy: extHostProtocol.MainThreadAiFeaturesShape;
	private readonly _disposables: DisposableStore = new DisposableStore();
	private readonly _languageModelRequestRegistry = new Map<string, (config: IPositronLanguageModelConfig, action: string) => Thenable<void>>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _commands: ExtHostCommands,
	) {
		// Trigger creation of proxy to main thread
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadAiFeatures);
	}

	async registerChatAgent(extension: IExtensionDescription, agentData: positron.ai.ChatAgentData): Promise<Disposable> {
		await this._proxy.$registerChatAgent({
			...agentData,
			extensionId: extension.identifier,
			extensionPublisherId: extension.publisher,
			extensionDisplayName: extension.displayName ?? extension.publisher,
			locations: agentData.locations.map((v) => ChatAgentLocation.fromRaw(v)),
		});

		return new Disposable(() => {
			this._proxy.$unregisterChatAgent(agentData.id);
		});
	}

	async showLanguageModelConfig(sources: positron.ai.LanguageModelSource[], onAction: (config: positron.ai.LanguageModelConfig, action: string) => Thenable<void>): Promise<void> {
		const id = generateUuid();
		this._languageModelRequestRegistry.set(id, onAction);

		try {
			await this._proxy.$languageModelConfig(id, sources);
		} catch (err) {
			throw err;
		}
	}

	async getCurrentPlotUri(): Promise<string | undefined> {
		return this._proxy.$getCurrentPlotUri();
	}

	async getPositronChatContext(request: vscode.ChatRequest): Promise<IPositronChatContext> {
		const agentRequest: IChatRequestData = {
			location: typeConvert.ChatLocation.from(request.location),
		};
		return this._proxy.$getPositronChatContext(agentRequest);
	}

	responseProgress(context: IToolInvocationContext, part: vscode.ChatResponsePart | vscode.ChatResponseTextEditPart | vscode.ChatResponseConfirmationPart): void {
		if (!isToolInvocationContext(context)) {
			throw new Error('Invalid tool invocation token');
		}

		const dto = typeConvert.ChatResponsePart.from(part, this._commands.converter, this._disposables);
		this._proxy.$responseProgress(context.sessionId, dto);
	}

	async $responseLanguageModelConfig(id: string, config: IPositronLanguageModelConfig, action: string): Promise<void> {
		const onAction = this._languageModelRequestRegistry.get(id);
		if (!onAction) {
			throw new Error('No matching language model configuration request found');
		}
		return onAction(config, action);
	}

	$onCompleteLanguageModelConfig(id: string): void {
		this._languageModelRequestRegistry.delete(id);
	}

	async getSupportedProviders(): Promise<string[]> {
		return this._proxy.$getSupportedProviders();
	}

	addLanguageModelConfig(source: IPositronLanguageModelSource): void {
		this._proxy.$addLanguageModelConfig(source);
	}

	removeLanguageModelConfig(source: IPositronLanguageModelSource): void {
		this._proxy.$removeLanguageModelConfig(source);
	}
}

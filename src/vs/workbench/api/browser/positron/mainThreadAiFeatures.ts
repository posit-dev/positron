/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { IChatAgentData, IChatAgentService } from '../../../contrib/chat/common/chatAgents.js';
import { ChatModel } from '../../../contrib/chat/common/chatModel.js';
import { IChatProgress, IChatService } from '../../../contrib/chat/common/chatService.js';
import { IChatRequestData, IPositronAssistantService, IPositronChatContext, IPositronLanguageModelSource } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IChatProgressDto } from '../../common/extHost.protocol.js';
import { ExtHostAiFeaturesShape, ExtHostPositronContext, MainPositronContext, MainThreadAiFeaturesShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAiFeatures)
export class MainThreadAiFeatures extends Disposable implements MainThreadAiFeaturesShape {

	private readonly _proxy: ExtHostAiFeaturesShape;
	private readonly _registrations = this._register(new DisposableMap<string>());

	constructor(
		extHostContext: IExtHostContext,
		@IPositronAssistantService private readonly _positronAssistantService: IPositronAssistantService,
		@IChatService private readonly _chatService: IChatService,
		@IChatAgentService private readonly _chatAgentService: IChatAgentService
	) {
		super();
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostAiFeatures);
	}

	/**
	 * Register chat agent data from the extension host.
	 */
	async $registerChatAgent(agentData: IChatAgentData): Promise<void> {
		const agent = this._register(this._chatAgentService.registerAgent(agentData.id, agentData));
		this._registrations.set(agentData.id, agent);
	}

	/*
	 * Deregister a chat agent.
	 */
	$unregisterChatAgent(id: string): void {
		this._registrations.deleteAndDispose(id);
	}

	/*
	 * Show a modal dialog for language model configuration. Return a promise resolving to the
	 * configuration saved by the user.
	 */
	$languageModelConfig(id: string, sources: IPositronLanguageModelSource[]): Thenable<void> {
		return new Promise((resolve, reject) => {
			this._positronAssistantService.showLanguageModelModalDialog(
				sources,
				async (config, action) => {
					await this._proxy.$responseLanguageModelConfig(id, config, action);
					resolve();
				},
				() => reject('User cancelled language model configuration.'),
				() => this._proxy.$onCompleteLanguageModelConfig(id),
			);
		});
	}

	/**
	 * Respond to a request from the extension host to send the current plot data.
	 */
	async $getCurrentPlotUri(): Promise<string | undefined> {
		return this._positronAssistantService.getCurrentPlotUri();
	}

	/**
	 * Respond to a request from the extension host to send a progress part to the chat response.
	 */
	$responseProgress(sessionId: string, content: IChatProgressDto): void {
		const progress = revive(content) as IChatProgress;
		const model = this._chatService.getSession(sessionId) as ChatModel;
		if (!model) {
			throw new Error('Chat session not found.');
		}

		const request = model.getRequests().at(-1)!;
		model.acceptResponseProgress(request, progress);
	}

	/**
	 * Get Positron global context information to be included with every request.
	 */
	async $getPositronChatContext(request: IChatRequestData): Promise<IPositronChatContext> {
		return this._positronAssistantService.getPositronChatContext(request);
	}

	/**
	 * Get Positron's supported providers.
	 */
	async $getSupportedProviders(): Promise<string[]> {
		return this._positronAssistantService.getSupportedProviders();
	}

	$addLanguageModelConfig(source: IPositronLanguageModelSource): void {
		source.signedIn = true;
		this._positronAssistantService.addLanguageModelConfig(source);
	}

	$removeLanguageModelConfig(source: IPositronLanguageModelSource): void {
		source.signedIn = false;
		this._positronAssistantService.removeLanguageModelConfig(source);
	}
}

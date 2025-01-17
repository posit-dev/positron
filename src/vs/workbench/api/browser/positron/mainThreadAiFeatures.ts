/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { IChatAgentData, IChatAgentService } from '../../../contrib/chat/common/chatAgents.js';
import { ChatModel } from '../../../contrib/chat/common/chatModel.js';
import { IChatProgress, IChatService } from '../../../contrib/chat/common/chatService.js';
import { IChatRequestData, IPositronAssistantService, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IChatProgressDto } from '../../common/extHost.protocol.js';
import { MainPositronContext, MainThreadAiFeaturesShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAiFeatures)
export class MainThreadAiFeatures extends Disposable implements MainThreadAiFeaturesShape {

	private readonly _registrations = this._register(new DisposableMap<string>());

	constructor(
		extHostContext: IExtHostContext,
		@IPositronAssistantService private readonly _positronAssistantService: IPositronAssistantService,
		@IChatService private readonly _chatService: IChatService,
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
	) {
		super();
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
	$languageModelConfig(sources: IPositronLanguageModelSource[]): Promise<IPositronLanguageModelConfig | undefined> {
		return this._positronAssistantService.showLanguageModelModalDialog(sources);
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
}

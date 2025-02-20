/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IsDevelopmentContext } from '../../../../platform/contextkey/common/contextkeys.js';
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
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
	) {
		super();
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostAiFeatures);
	}

	/**
	 * Register chat agent data from the extension host.
	 */
	async $registerChatAgent(agentData: IChatAgentData): Promise<void> {
		// Only register chat agents in development mode, hiding the Chat panel in release builds
		const isDevelopment = IsDevelopmentContext.getValue(this._contextKeyService);
		if (isDevelopment) {
			const agent = this._register(this._chatAgentService.registerAgent(agentData.id, agentData));
			this._registrations.set(agentData.id, agent);
		}
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
				async (config) => {
					await this._proxy.$responseLanguageModelConfig(id, config);
					resolve();
				},
				() => reject('User cancelled language model configuration.'),
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
}

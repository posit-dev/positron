/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { IChatAgentService } from '../../../contrib/chat/common/chatAgents.js';
import { ChatModel } from '../../../contrib/chat/common/chatModel.js';
import { IChatFollowup, IChatProgress, IChatService } from '../../../contrib/chat/common/chatService.js';
import { IPositronAssistantService, IPositronChatParticipant, IPositronChatTask, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IChatProgressDto } from '../../common/extHost.protocol.js';
import { ExtHostAiFeaturesShape, ExtHostPositronContext, MainPositronContext, MainThreadAiFeaturesShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAiFeatures)
export class MainThreadAiFeatures extends Disposable implements MainThreadAiFeaturesShape {

	private readonly _proxy: ExtHostAiFeaturesShape;
	private readonly _registrations = this._register(new DisposableMap<string>());
	private readonly _chatTasks = new Map<string, IPositronChatTask>();

	constructor(
		extHostContext: IExtHostContext,
		@IPositronAssistantService private readonly _positronAssistantService: IPositronAssistantService,
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
		@IChatService private readonly _chatService: IChatService,
	) {
		super();
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostAiFeatures);
	}

	/**
	 * Register a chat participant from the extension host.
	 */
	$registerChatParticipant(extension: IExtensionDescription, participant: IPositronChatParticipant): void {
		const agent = this._register(
			this._chatAgentService.registerAgent(participant.id, {
				id: participant.id,
				name: participant.name,
				fullName: participant.fullName,
				isDefault: participant.isDefault,
				locations: participant.locations,
				metadata: revive(participant.metadata),
				extensionId: extension.identifier,
				extensionPublisherId: extension.publisher,
				extensionDisplayName: extension.displayName ?? extension.name,
				isDynamic: true,
				slashCommands: participant.commands ?? [],
				disambiguation: [],
			})
		);

		const agentImpl = this._register(
			this._chatAgentService.registerAgentImplementation(participant.id, {
				invoke: async (request, progress, history, token) => {
					const taskId = generateUuid();
					this._chatTasks.set(taskId, { handler: progress });
					try {
						const context = this._positronAssistantService.buildChatContext(request);
						return await this._proxy.$provideResponse(extension, request, history, context, taskId, token);
					} finally {
						this._chatTasks.delete(taskId);
					}
				},
				provideFollowups: async (request, result, history, token): Promise<IChatFollowup[]> => {
					const context = this._positronAssistantService.buildChatContext(request);
					return await this._proxy.$provideFollowups(request, result, history, context, token);
				},
				provideWelcomeMessage: (token) => {
					return this._proxy.$provideWelcomeMessage(participant.id, token);
				},
			})
		);

		const store = new DisposableStore();
		store.add(agent);
		store.add(agentImpl);
		this._registrations.set(participant.id, store);
	}

	/*
	 * Deregister a chat participant.
	 */
	$unregisterChatParticipant(id: string): void {
		this._registrations.deleteAndDispose(id);
	}

	/*
	 * Respond from the extension host to a chat response task with some streaming content.
	 */
	$chatTaskResponse(id: string, content: IChatProgressDto) {
		const task = this._chatTasks.get(id);
		const revivedContent = revive(content) as IChatProgress;
		if (!task) {
			throw new Error('Chat response task not found.');
		}
		task.handler(revivedContent);
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
}

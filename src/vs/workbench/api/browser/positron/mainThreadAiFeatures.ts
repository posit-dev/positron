/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { IChatAgentService } from '../../../contrib/chat/common/chatAgents.js';
import { IChatProgress } from '../../../contrib/chat/common/chatService.js';
import { ILanguageModelChatResponse, ILanguageModelsService } from '../../../contrib/chat/common/languageModels.js';
import { IPositronChatTask, IPositronAssistantService, IPositronChatParticipant } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IChatProgressDto } from '../../common/extHost.protocol.js';
import { ExtHostAiFeaturesShape, ExtHostPositronContext, MainPositronContext, MainThreadAiFeaturesShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAiFeatures)
export class MainThreadAiFeatures extends Disposable implements MainThreadAiFeaturesShape {

	private readonly _proxy: ExtHostAiFeaturesShape;
	private readonly _registrations = this._register(new DisposableMap<string>());
	private readonly _tasks = new Map<string, IPositronChatTask>();

	constructor(
		extHostContext: IExtHostContext,
		@IPositronAssistantService private readonly _positronAssistantService: IPositronAssistantService,
		@IChatAgentService private readonly _chatAgentService: IChatAgentService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
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
				slashCommands: [],
				disambiguation: [],
			})
		);

		const agentImpl = this._register(
			this._chatAgentService.registerAgentImplementation(participant.id, {
				invoke: async (request, progress, history, token) => {
					const taskId = generateUuid();
					this._tasks.set(taskId, { progress });
					try {
						const context = this._positronAssistantService.buildChatContext(request);
						return await this._proxy.$provideResponse(request, history, context, taskId, token);
					} finally {
						this._tasks.delete(taskId);
					}
				},
			})
		);

		const store = new DisposableStore();
		store.add(agent);
		store.add(agentImpl);
		this._registrations.set(participant.id, store);
	}

	/**
	 * Register a language model from the extension host.
	 */
	$registerLanguageModel(id: string, extension: IExtensionDescription, name: string): void {
		// We need at least one default and one non-default model for the dropdown to appear.
		const isFirst = this._languageModelsService.getLanguageModelIds().length === 0;

		// Register with the language model service so that our provider appears in the selector UI
		const model = this._languageModelsService.registerLanguageModelChat(id, {
			metadata: {
				name,
				id,
				isDefault: isFirst,
				extension: extension.identifier,
				vendor: extension.publisher,
				family: extension.publisher,
				version: extension.version,
				maxInputTokens: 0,
				maxOutputTokens: 4096,
				isUserSelectable: true,
			},
			/*
			 * Right now we don't need to implement these methods since we use our own custom chat
			 * participants that talk to the LLM models via a new Positron Assistant API, rather
			 * than through the existing Language Model API. In the future we'll need to implement
			 * these if we want to support extensions that use the Language Model API directly.
			 */
			sendChatRequest: function (): Promise<ILanguageModelChatResponse> {
				throw new Error('Method not implemented.');
			},
			provideTokenCount: function (): Promise<number> {
				throw new Error('Method not implemented.');
			}
		});
		const store = new DisposableStore();
		store.add(model);
		this._registrations.set(id, store);
	}

	/*
	 * Deregister a language model.
	 */
	$unregisterLanguageModel(id: string): void {
		this._registrations.deleteAndDispose(id);
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
		const task = this._tasks.get(id);
		const revivedContent = revive(content) as IChatProgress;
		if (!task) {
			throw new Error('Chat response task not found.');
		}
		task.progress(revivedContent);
	}

	/**
	 * Respond to a request from the extension host to send the current plot data.
	 */
	async $getCurrentPlotUri(): Promise<string | undefined> {
		return this._positronAssistantService.getCurrentPlotUri();
	}
}

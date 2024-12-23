/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ChatAgentLocation, IChatAgentService } from '../../../contrib/chat/common/chatAgents.js';
import { IChatProgress } from '../../../contrib/chat/common/chatService.js';
import { ILanguageModelChatResponse, ILanguageModelsService } from '../../../contrib/chat/common/languageModels.js';
import { IPositronAssistantChatTask, IPositronAssistantProvider, IPositronAssistantService } from '../../../contrib/positronAssistant/browser/interfaces/positronAssistantService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IChatProgressDto } from '../../common/extHost.protocol.js';
import { ExtHostAiFeaturesShape, ExtHostPositronContext, MainPositronContext, MainThreadAiFeaturesShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAiFeatures)
export class MainThreadAiFeatures extends Disposable implements MainThreadAiFeaturesShape {

	private readonly _proxy: ExtHostAiFeaturesShape;
	private readonly _registrations = this._register(new DisposableMap<string>());
	private readonly _tasks = new Map<string, IPositronAssistantChatTask>();
	private _agentRegistered = false;

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
	 * Register our own custom default agent with the built-in IChatAgentService.
	 */
	registerPositronAssistantAgent(): void {
		if (this._agentRegistered) {
			return;
		}

		this._register(
			this._chatAgentService.registerAgent('positron-assistant', {
				id: 'positron-assistant',
				name: 'Positron Assistant',
				extensionDisplayName: 'Positron Assistant',
				extensionId: new ExtensionIdentifier('positron-assistant'),
				extensionPublisherId: '',
				isDefault: true,
				isDynamic: true,
				metadata: {
					themeIcon: { id: 'robot' },
					supportIssueReporting: false,
				},
				slashCommands: [],
				locations: [ChatAgentLocation.Terminal, ChatAgentLocation.Editor, ChatAgentLocation.Notebook, ChatAgentLocation.Panel],
				disambiguation: [],
			})
		);

		this._register(
			this._chatAgentService.registerAgentImplementation(
				'positron-assistant',
				{
					invoke: async (request, progress, history, token) => {
						return this._positronAssistantService.provideResponse(request, progress, history, token);
					}
				}
			)
		);

		this._agentRegistered = true;
	}

	/**
	 * Register a Positron Assistant from the extension host.
	 */
	$registerAssistant(id: string, name: string): void {
		// Set this as the default if there are no other assistants registered yet
		const isDefault = this._positronAssistantService.registeredProviders.size === 0;

		// Register with the language model service so that our provider appears in the selector UI
		const model = this._languageModelsService.registerLanguageModelChat(id, {
			metadata: {
				name,
				id,
				isDefault,
				extension: new ExtensionIdentifier('positron-assistant'),
				vendor: 'positron',
				version: '0.0.0',
				family: 'positron',
				maxInputTokens: 0,
				maxOutputTokens: 4096,
				isUserSelectable: true,
			},
			// We don't need to implement these methods since we have our own custom chat agent
			sendChatRequest: function (): Promise<ILanguageModelChatResponse> {
				throw new Error('Function not implemented.');
			},
			provideTokenCount: function (): Promise<number> {
				throw new Error('Function not implemented.');
			}
		});

		// Register the assistant with the Positron Assistant Service
		const provider: IPositronAssistantProvider = {
			name,
			provideChatResponse: async (request, handler, token) => {
				const taskId = generateUuid();
				this._tasks.set(taskId, { handler });
				try {
					return await this._proxy.$provideChatResponse(id, request, taskId, token);
				} finally {
					this._tasks.delete(taskId);
				}
			},
		};
		const assistant = this._positronAssistantService.registerAssistant(id, provider);

		const store = new DisposableStore();
		store.add(model);
		store.add(assistant);
		this._registrations.set(id, store);

		this.registerPositronAssistantAgent();
	}

	/*
	 * Deregister an assistant.
	 */
	$unregisterAssistant(id: string): void {
		this._registrations.deleteAndDispose(id);
	}

	/*
	 * Respond from the extension host to a chat response task with some streaming content.
	 */
	$taskResponse(id: string, content: IChatProgressDto) {
		const task = this._tasks.get(id);
		const revivedContent = revive(content) as IChatProgress;
		if (!task) {
			throw new Error('Chat response task not found.');
		}
		task.handler(revivedContent);
	}
}

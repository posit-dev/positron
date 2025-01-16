/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableSource, DeferredPromise } from '../../../../base/common/async.js';
import { SerializedError } from '../../../../base/common/errors.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { revive } from '../../../../base/common/marshalling.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { IChatAgentService } from '../../../contrib/chat/common/chatAgents.js';
import { IChatFollowup, IChatProgress } from '../../../contrib/chat/common/chatService.js';
import { IChatResponseFragment, ILanguageModelChatResponse, ILanguageModelsService } from '../../../contrib/chat/common/languageModels.js';
import { IPositronAssistantService, IPositronChatParticipant, IPositronLanguageModelTask, IPositronChatTask, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../../../contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IChatProgressDto } from '../../common/extHost.protocol.js';
import { ExtHostAiFeaturesShape, ExtHostPositronContext, MainPositronContext, MainThreadAiFeaturesShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadAiFeatures)
export class MainThreadAiFeatures extends Disposable implements MainThreadAiFeaturesShape {

	private readonly _proxy: ExtHostAiFeaturesShape;
	private readonly _registrations = this._register(new DisposableMap<string>());
	private readonly _chatTasks = new Map<string, IPositronChatTask>();
	private readonly _languageModelTasks = new Map<string, IPositronLanguageModelTask>();

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
						return await this._proxy.$provideResponse(request, history, context, taskId, token);
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

	/**
	 * Register a language model from the extension host.
	 */
	$registerLanguageModel(id: string, extension: IExtensionDescription, name: string): void {
		// We need at least one default and one non-default model for the dropdown to appear.
		// For now, just set the first language model as default.
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
				maxOutputTokens: 0,
				isUserSelectable: true,
			},
			/*
			 * We use our own custom chat participants that talk to the LLM models via a Positron
			 * Assistant API, rather than through the existing Language Model API. However,
			 * implementing these methods allows extension to use the Language Model API directly.
			 */
			sendChatRequest: async (messages, from, options, token): Promise<ILanguageModelChatResponse> => {
				const defer = new DeferredPromise<any>();
				const stream = new AsyncIterableSource<IChatResponseFragment>();

				const taskId = generateUuid();
				this._languageModelTasks.set(taskId, { defer, stream });

				try {
					this._proxy.$provideLanguageModelResponse(id, taskId, messages, from, options, token);
					return {
						result: defer.p,
						stream: stream.asyncIterable
					};
				} finally {
					this._chatTasks.delete(taskId);
				}
			},
			provideTokenCount: (message, token): Promise<number> => {
				return this._proxy.$provideTokenCount(id, message, token);
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
		const task = this._chatTasks.get(id);
		const revivedContent = revive(content) as IChatProgress;
		if (!task) {
			throw new Error('Chat response task not found.');
		}
		task.handler(revivedContent);
	}

	/*
	 * Respond from the extension host to a language model task with some streaming content.
	 */
	$languageModelTaskResponse(id: string, content: IChatResponseFragment) {
		const task = this._languageModelTasks.get(id);
		if (!task) {
			throw new Error('Language model response task not found.');
		}
		task.stream.emitOne(content);
	}

	/*
	 * Respond from the extension host to a language model task with the resolved result.
	 */
	$languageModelTaskResolve(id: string, result: any, error?: SerializedError) {
		const task = this._languageModelTasks.get(id);
		if (!task) {
			throw new Error('Language model response task not found.');
		}

		if (error) {
			task.stream.reject(error);
			task.defer.error(error);
		} else {
			task.stream.resolve();
			task.defer.complete(result);
		}
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
}

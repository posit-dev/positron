/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { IDisposable, Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { PositronVariablesInstance } from '../../../services/positronVariables/common/positronVariablesInstance.js';
import { IChatAgentHistoryEntry, IChatAgentRequest, IChatAgentResult } from '../../chat/common/chatAgents.js';
import { IChatProgress } from '../../chat/common/chatService.js';
import { IPositronAssistantChatMessage, IPositronAssistantChatRequest, IPositronAssistantProvider, IPositronAssistantService } from './interfaces/positronAssistantService.js';

/**
 * PositronAssistantService class.
 */
class PositronAssistantService extends Disposable implements IPositronAssistantService {
	declare readonly _serviceBrand: undefined;

	//#region Constructor

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IPositronConsoleService private readonly _consoleService: IPositronConsoleService,
		@IPositronVariablesService private readonly _variableService: IPositronVariablesService,
		@IPositronPlotsService private readonly _plotService: IPositronPlotsService,
	) {
		super();
	}

	initialize(): void { }

	//#endregion
	//#region Assistant Providers

	private readonly _providers = new Map<string, IPositronAssistantProvider>();

	// Event emitters
	private readonly _onDidRegisterAssistantEmitter = this._register(new Emitter<string>);
	readonly onDidRegisterAssistant = this._onDidRegisterAssistantEmitter.event;

	registerAssistant(id: string, provider: IPositronAssistantProvider): IDisposable {
		// Register and signal that the set of assistants has changed.
		this._providers.set(id, provider);
		this._onDidRegisterAssistantEmitter.fire(provider.name);
		this._logService.debug(`Assistant "${provider.name}" with identifier \`${id}\` registered.`);

		// Remove assistant when disposed
		return toDisposable(() => {
			this._logService.debug(`Assistant with identifier ${id} disposed.`);
			this._providers.delete(id);
		});
	}

	get registeredProviders() {
		return this._providers;
	}

	//#endregion
	//#region Context

	buildChatContext(request: IChatAgentRequest) {
		const inst = this._variableService.activePositronVariablesInstance as PositronVariablesInstance;
		const plot = this._plotService.positronPlotInstances.find(plot => plot.id === this._plotService.selectedPlotId);
		const isPlotVisible = !!(plot instanceof PlotClientInstance && plot.lastRender);

		return {
			value: {
				console: {
					language: this._consoleService.activePositronConsoleInstance?.session.runtimeMetadata.languageName ?? '',
					version: this._consoleService.activePositronConsoleInstance?.session.runtimeMetadata.languageVersion ?? '',
				},
				variables: inst.variableItems.map((item) => {
					return {
						name: item.displayName,
						value: item.displayValue,
						type: item.displayType,
					};
				}),
			},
			additional: {
				plotUri: isPlotVisible ? plot.lastRender.uri : undefined,
			}
		};
	}

	//#endregion
	//#region History

	private lowerChatAgentResponse(response: IChatAgentHistoryEntry['response']): string {
		return response.reduce((acc, cur) => {
			switch (cur.kind) {
				case 'markdownContent':
					return acc + cur.content.value;
				case 'textEditGroup':
					return acc + `\n\nSuggested text edits: ${JSON.stringify(cur.edits)}\n\n`;
				default:
					throw new Error('Unsupported response kind when lowering chat agent response');
			}
		}, '');
	}

	// Take chat history as provided by the Chat Agent and lower it to positron assistant messages.
	private lowerChatAgentHistory(history: IChatAgentHistoryEntry[]): IPositronAssistantChatMessage[] {
		return history
			.map((entry) => {
				const messages: IPositronAssistantChatMessage[] = [];

				// Add initial user request message.
				if (entry.request.message) {
					messages.push({ role: 'user' as const, content: entry.request.message });
				}

				// Lower response content to string, then add as an assistant message if non-empty.
				const assistantResponse = {
					role: 'assistant' as const,
					content: this.lowerChatAgentResponse(entry.response),
				};
				if (assistantResponse.content) {
					messages.push(assistantResponse);
				}

				// If there was an error response, add it as an assistant message.
				if (entry.result.errorDetails) {
					messages.push({
						role: 'assistant' as const,
						content: `ERROR MESSAGE: "${entry.result.errorDetails.message}"`
					});
				}

				return messages;
			})
			.reduce((prev, cur) => [...prev, ...cur], []);
	}

	//#endregion
	//#region Chat Response

	async provideResponse(request: IChatAgentRequest, progress: (part: IChatProgress) => void,
		history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		if (!request.userSelectedModelId) {
			throw new Error('Can\'t provide chat response: No assistant selected');
		}
		const provider = this.registeredProviders.get(request.userSelectedModelId);
		if (!provider) {
			throw new Error('Can\'t provide chat response: Assistant provider not registered');
		}

		const _request: IPositronAssistantChatRequest = {
			...request,
			history: this.lowerChatAgentHistory(history),
			context: this.buildChatContext(request),
		};

		await provider.provideChatResponse(_request, progress, token);
		return {};
	}

	//#endregion
}

// Register the Positron assistant service.
registerSingleton(
	IPositronAssistantService,
	PositronAssistantService,
	InstantiationType.Delayed
);

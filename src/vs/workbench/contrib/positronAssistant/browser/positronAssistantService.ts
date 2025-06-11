/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { PositronVariablesInstance } from '../../../services/positronVariables/common/positronVariablesInstance.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IChatRequestData, IPositronAssistantService, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { showLanguageModelModalDialog } from './languageModelModalDialog.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Emitter } from '../../../../base/common/event.js';
import { ExecutionEntryType, IExecutionHistoryService } from '../../../services/positronHistory/common/executionHistoryService.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';

/**
 * PositronAssistantService class.
 */
export class PositronAssistantService extends Disposable implements IPositronAssistantService {
	declare readonly _serviceBrand: undefined;

	// Tracks the models that have been added and signed in
	private _languageModelRegistry = new Set<string>();

	// event emmitter for language model configuration
	private _onLanguageModelConfigEmitter = new Emitter<IPositronLanguageModelSource>();
	readonly onChangeLanguageModelConfig = this._onLanguageModelConfigEmitter.event;

	//#region Constructor

	constructor(
		@IPositronVariablesService private readonly _variableService: IPositronVariablesService,
		@IPositronPlotsService private readonly _plotService: IPositronPlotsService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExecutionHistoryService private readonly _historyService: IExecutionHistoryService,
		@IPositronModalDialogsService private readonly _positronModalDialogsService: IPositronModalDialogsService,
	) {
		super();
	}

	initialize(): void { }

	//#endregion
	//#region Context and Tools

	getPositronChatContext(request: IChatRequestData): IPositronChatContext {
		const variablesInstance = this._variableService.activePositronVariablesInstance as PositronVariablesInstance | undefined;
		const activeSession = variablesInstance && this.summarizeSession(variablesInstance.session);
		const context: IPositronChatContext = {
			activeSession,
			plots: {
				hasPlots: this.getCurrentPlotUri() !== undefined,
			},
			variables: variablesInstance?.variableItems.map((item) => {
				return item.variable;
			}) ?? [],
		};

		if (request.location === 'terminal') {
			context.shell = this._terminalService.activeInstance?.shellType;
		}

		return context;
	}

	/**
	 * Summarizes a given session as context for a language model.
	 *
	 * @param session The session to summarize
	 * @returns The summarized session context
	 */
	private summarizeSession(session: ILanguageRuntimeSession): IPositronChatContext['activeSession'] {
		const executions = this.summarizeExecutionHistory(session.metadata.sessionId);
		const sessionContext: IPositronChatContext['activeSession'] = {
			identifier: session.metadata.sessionId,
			language: session.runtimeMetadata.languageName,
			version: session.runtimeMetadata.languageVersion,
			mode: session.metadata.sessionMode,
			executions,
		};
		if (session.metadata.notebookUri) {
			sessionContext.notebookUri = session.metadata.notebookUri.toJSON();
		}
		return sessionContext;
	}

	/**
	 * Summarizes the execution history for a given session. This is used to
	 * provide context to the language model.
	 *
	 * Execution history can grow unbounded, and models have a limited context
	 * window, so we need to summarize the history. To do this, we start with
	 * the newest entries and work backwards, adding entries until we reach a
	 * maximum size. Some larger entries may be truncated so that there's still
	 * a reasonable amount of history to work with and a single entry doesn't
	 * take up too much space.
	 *
	 * @param sessionId The ID of the session to summarize
	 * @returns Up to 8KB of the most recent execution history entries
	 */
	summarizeExecutionHistory(sessionId: string) {
		const history = this._historyService.getExecutionEntries(sessionId);
		const summarized = [];
		let currentCost = 0;
		const maxCost = 8192; // 8KB. Should this be configurable?
		for (let i = history.length - 1; i >= 0; i--) {
			const entry = history[i];
			// Filter out non-execution entries
			if (entry.outputType !== ExecutionEntryType.Execution) {
				continue;
			}

			// Compute the cost of the entry
			let cost = entry.input.length + entry.output.length;
			if (entry.error) {
				cost += JSON.stringify(entry.error).length;
			}

			// If this would exceed the max cost, try truncating the input and/or output
			if (currentCost + cost > maxCost) {
				const truncatedInput = entry.input.length > 500 ?
					entry.input.slice(0, 500) + '... (truncated)' :
					entry.input;
				const truncatedOutput = entry.output.length > 500 ?
					entry.output.slice(0, 500) + '... (truncated)' :
					entry.output;
				let truncatedCost = truncatedInput.length + truncatedOutput.length;
				if (entry.error) {
					// Errors are not truncated, but their size is added to the cost
					truncatedCost += JSON.stringify(entry.error).length;
				}
				if (currentCost + truncatedCost > maxCost) {
					// If truncating the input and output still exceeds the max cost, break
					break;
				} else {
					// Otherwise, use the truncated input and output
					summarized.push({
						input: truncatedInput,
						output: truncatedOutput,
						error: entry.error,
					});
					currentCost += truncatedCost;
					continue;
				}
			}

			// Add the entry to the summarized list and absorb the cost
			currentCost += cost;
			summarized.push({
				input: entry.input,
				output: entry.output,
				error: entry.error,
			});
		}

		// Reverse the order to maintain the original order
		summarized.reverse();
		return summarized;
	}

	getCurrentPlotUri(): string | undefined {
		const plot = this._plotService.positronPlotInstances.find(plot => plot.id === this._plotService.selectedPlotId);
		const isPlotVisible = !!(plot instanceof PlotClientInstance && plot.lastRender);
		return isPlotVisible ? plot.lastRender.uri : undefined;
	}

	addLanguageModelConfig(source: IPositronLanguageModelSource): void {
		this._languageModelRegistry.add(source.provider.id);

		this._onLanguageModelConfigEmitter.fire(source);
	}

	removeLanguageModelConfig(source: IPositronLanguageModelSource): void {
		this._languageModelRegistry.delete(source.provider.id);

		this._onLanguageModelConfigEmitter.fire(source);
	}

	//#endregion
	//#region Language Model UI

	showLanguageModelModalDialog(
		sources: IPositronLanguageModelSource[],
		onAction: (config: IPositronLanguageModelConfig, action: string) => Promise<void>,
		onCancel: () => void,
		onClose: () => void,
	): void {
		showLanguageModelModalDialog(this._keybindingService, this._layoutService, this._configurationService, this, this._positronModalDialogsService, sources, onAction, onCancel, onClose);
	}

	getSupportedProviders(): string[] {
		const providers = ['anthropic', 'copilot'];
		const useTestModels = this._configurationService.getValue<boolean>('positron.assistant.testModels');

		if (useTestModels) {
			providers.push('bedrock', 'error', 'echo', 'google');
		}
		return providers;
	}

	//#endregion
}

// Register the Positron assistant service.
registerSingleton(
	IPositronAssistantService,
	PositronAssistantService,
	InstantiationType.Delayed
);

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IChatRequestRuntimeSessionEntry } from '../../common/chatModel.js';
import { IChatWidgetService } from '../chat.js';
import { IRuntimeSessionService, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { PositronVariablesInstance } from '../../../../services/positronVariables/common/positronVariablesInstance.js';
import { ExecutionEntryType, IExecutionHistoryService } from '../../../../services/positronHistory/common/executionHistoryService.js';

export class ChatRuntimeSessionContextContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chat.runtimeSessionContext';

	constructor(
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IPositronVariablesService private readonly positronVariablesService: IPositronVariablesService,
		@IExecutionHistoryService private readonly executionHistoryService: IExecutionHistoryService,
	) {
		super();

		this.updateRuntimeContext().then(() => {
			// No-op, just to ensure the context is updated on startup
		}).finally(() => {
			// Register for changes to the runtime session service
			this._register(this.runtimeSessionService.onDidChangeForegroundSession(() => this.updateRuntimeContext()));
		});

		this._register(this.chatWidgetService.onDidAddWidget(async (widget) => {
			await this.updateRuntimeContext();
		}));
	}

	private async updateRuntimeContext(): Promise<void> {
		const session = this.runtimeSessionService.foregroundSession;
		const widgets = [...this.chatWidgetService.getAllWidgets()];
		for (const widget of widgets) {
			if (!widget.input.runtimeContext) {
				continue;
			}
			widget.input.runtimeContext.setServices(
				this.positronVariablesService,
				this.executionHistoryService
			);
			widget.input.runtimeContext.setValue(session);
		}
	}
}

export class ChatRuntimeSessionContext extends Disposable {
	get id() {
		return 'positron.implicit.runtimeSession';
	}

	get name(): string {
		if (this.value) {
			return this.value.getLabel();
		} else {
			return 'runtimeSession';
		}
	}

	get modelDescription(): string {
		if (this.value) {
			return `User's active runtime session`;
		}
		return '';
	}

	private _onDidChangeValue = this._register(new Emitter<void>());
	readonly onDidChangeValue = this._onDidChangeValue.event;

	private _value: ILanguageRuntimeSession | undefined;
	get value() {
		return this._value;
	}

	private _enabled = true;
	get enabled() {
		return this._enabled;
	}

	set enabled(value: boolean) {
		this._enabled = value;
		this._onDidChangeValue.fire();
	}

	private _positronVariablesService?: IPositronVariablesService;
	private _executionHistoryService?: IExecutionHistoryService;

	constructor() {
		super();
	}

	setServices(
		positronVariablesService: IPositronVariablesService,
		executionHistoryService: IExecutionHistoryService
	): void {
		this._positronVariablesService = positronVariablesService;
		this._executionHistoryService = executionHistoryService;
	}

	setValue(value: ILanguageRuntimeSession | undefined): void {
		this._value = value;
		this._onDidChangeValue.fire();
	}

	private summarizeSession(session: ILanguageRuntimeSession) {
		if (!this._executionHistoryService) {
			return undefined;
		}

		const executions = this.summarizeExecutionHistory(session.metadata.sessionId);
		const sessionContext: any = {
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
	private summarizeExecutionHistory(sessionId: string) {
		if (!this._executionHistoryService) {
			return [];
		}

		const history = this._executionHistoryService.getExecutionEntries(sessionId);
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

	public async toBaseEntries(): Promise<IChatRequestRuntimeSessionEntry[]> {
		if (!this.value) {
			return [];
		}

		const activeSession = this.summarizeSession(this.value);
		const variablesInstance = this._positronVariablesService?.positronVariablesInstances.find(
			instance => instance.session.sessionId === this.value!.metadata.sessionId
		) as PositronVariablesInstance | undefined;
		const variables = variablesInstance?.variableItems.map((item) => item.variable) ?? [];

		return [
			{
				kind: 'runtimeSession',
				id: this.id,
				name: this.name,
				value: {
					activeSession,
					variables
				}
			}
		];
	}
}

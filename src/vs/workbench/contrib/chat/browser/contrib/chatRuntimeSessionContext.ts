/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IChatService } from '../../common/chatService.js';
import { IChatWidget, IChatWidgetService } from '../chat.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { NotebookEditorInput } from '../../../notebook/common/notebookEditorInput.js';
import { PositronNotebookEditorInput } from '../../../positronNotebook/browser/PositronNotebookEditorInput.js';
import { IRuntimeSessionService, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { PositronVariablesInstance } from '../../../../services/positronVariables/common/positronVariablesInstance.js';
import { ExecutionEntryType, IExecutionHistoryService } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IChatRequestRuntimeSessionEntry } from '../../common/chatVariableEntries.js';
import { IChatContextPicker, IChatContextPickerItem, IChatContextPickerPickItem, IChatContextPickService } from '../chatContextPickService.js';
import { localize } from '../../../../../nls.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';

/**
 * A single summarized entry in the execution history provided to the chat model.
 */
export interface IHistorySummaryEntry {
	/** The input code for the execution */
	input: string;

	/** The result of the execution */
	output: string;

	/** The error, if any, that occurred during the execution. Can be text or structured object */
	error?: unknown;
}

/**
 * The runtime session context for the chat model. Typically one of these will
 * be attached implicitly, but users can attach additional runtime session
 * contexts explicitly.
 */
export interface IChatRuntimeSessionContext {
	/** The unique identifier for the runtime session (sessionId, e.g. 'python-12345678') */
	identifier: string;

	/** The language name of the runtime session (e.g. 'Python') */
	language: string;

	/** The language identifier of the runtime session (e.g. 'python') */
	languageId: string;

	/** The version of the language runtime (e.g. '3.10.4') */
	version: string;

	/** The mode of the runtime session (e.g. 'console') */
	mode: LanguageRuntimeSessionMode;

	/** The notebook URI, if applicable */
	notebookUri?: string;

	/** The summarized execution history for the session */
	executions: Array<IHistorySummaryEntry>;
}

/**
 * Budgets for truncating entry content
 */
interface EntryTruncationBudgets {
	/** The budget for the input code */
	inputBudget: number;
	/** The budget for the output code */
	outputBudget: number;
	/** The budget for the error content */
	errorBudget: number;
}

/**
 * The result of truncating an execution history entry to fit within budget constraints.
 */
interface EntryTruncationResult {
	/** The truncated input code */
	truncatedInput: string;
	/** The truncated output code */
	truncatedOutput: string;
	/** The truncated error content */
	truncatedErrorContent?: string;
	/** The cost of the truncated entry */
	cost: number;
}

class RuntimeSessionContextValuePick implements IChatContextPickerItem {

	readonly type = 'pickerPick';
	readonly label: string = localize('chatContext.tools', 'Interpreter Sessions...');
	readonly icon: ThemeIcon = Codicon.positronNewConsole;
	readonly ordinal = -500;

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IPositronVariablesService private readonly _positronVariablesService: IPositronVariablesService,
		@IExecutionHistoryService private readonly _executionHistoryService: IExecutionHistoryService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) { }

	toPickItem(session: ILanguageRuntimeSession): IChatContextPickerPickItem {
		return {
			label: session.getLabel(),
			iconClass: session.metadata.sessionMode === LanguageRuntimeSessionMode.Console ?
				ThemeIcon.asClassName(Codicon.positronNewConsole) :
				ThemeIcon.asClassName(Codicon.notebook),
			description: '',
			disabled: false,
			asAttachment: () => {
				// Create a temporary context object to generate the attachment
				const tempContext = new ChatRuntimeSessionContext();
				tempContext.setValue(session);
				tempContext.setServices(
					this._positronVariablesService,
					this._executionHistoryService,
					this._configurationService
				);

				try {
					const entries = tempContext.toBaseEntries();
					return entries[0]; // Return the first (and only) entry
				} finally {
					tempContext.dispose(); // Clean up the temporary context
				}
			}
		};
	}

	asPicker(_widget: IChatWidget): IChatContextPicker {
		const picks: (IQuickPickSeparator | IChatContextPickerPickItem)[] = [];

		const consoleSessions: ILanguageRuntimeSession[] = [];
		const notebookSessions: ILanguageRuntimeSession[] = [];
		for (const s of this._runtimeSessionService.getActiveSessions()) {
			// Discard exited sessions
			if (s.session.getRuntimeState() === RuntimeState.Exited) {
				continue;
			}

			// Add the session to the appropriate list based on its mode
			if (s.session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
				consoleSessions.push(s.session);
			}
			else if (s.session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
				notebookSessions.push(s.session);
			}
		}

		// Sort each session by recently used, descending, so that the most
		// recently used sessions appear first
		consoleSessions.sort((a, b) => b.lastUsed - a.lastUsed);
		notebookSessions.sort((a, b) => b.lastUsed - a.lastUsed);

		picks.push({
			type: 'separator',
			label: localize('chatContext.runtimeSessions.console', 'Console Sessions')
		});
		for (const consoleSession of consoleSessions) {
			picks.push(this.toPickItem(consoleSession));
		}
		picks.push({
			type: 'separator',
			label: localize('chatContext.runtimeSessions.notebook', 'Notebook Sessions')
		});
		for (const notebookSession of notebookSessions) {
			picks.push(this.toPickItem(notebookSession));
		}

		return {
			placeholder: localize('chatContext.runtimeSessions.placeholder', 'Select an Interpreter Session'),
			picks: Promise.resolve(picks)
		};
	}
}

export class ChatRuntimeSessionContextContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'chat.runtimeSessionContext';

	private _implicitSessionContextEnablement = this.configurationService.getValue<{ [mode: string]: string }>('chat.implicitSessionContext.enabled');

	constructor(
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IPositronVariablesService private readonly positronVariablesService: IPositronVariablesService,
		@IExecutionHistoryService private readonly executionHistoryService: IExecutionHistoryService,
		@IChatService private readonly chatService: IChatService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IChatContextPickService private readonly contextPickService: IChatContextPickService,
	) {
		super();

		this.updateRuntimeContext().then(() => {
			// No-op, just to ensure the context is updated on startup
		}).finally(() => {
			// Register for changes to the runtime session service
			this._register(this.runtimeSessionService.onDidChangeForegroundSession(() => this.updateRuntimeContext()));
		});

		// Listen for active editor changes to update runtime context when
		// notebook session changes This ensures that when the user switches
		// between notebooks, the chat context switches to the runtime session
		// associated with the active notebook
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this.updateRuntimeContext();
		}));

		// Same deal for runtime sessions. Notebooks open before the session
		// finishes starting, so this catches new notebook sessions (vs.
		// switching between existing ones).
		this._register(this.runtimeSessionService.onDidStartRuntime(async (session) => {
			await this.updateRuntimeContext();
		}));

		this._register(this.chatWidgetService.onDidAddWidget(async (widget) => {
			await this.updateRuntimeContext();
		}));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('chat.implicitSessionContext.enabled')) {
				this._implicitSessionContextEnablement = this.configurationService.getValue<{ [mode: string]: string }>('chat.implicitSessionContext.enabled');
				this.updateRuntimeContext();
			}
		}));

		this._register(this.chatService.onDidSubmitRequest(({ chatSessionResource }) => {
			const widget = this.chatWidgetService.getWidgetBySessionResource(chatSessionResource);
			if (!widget?.input.runtimeContext) {
				return;
			}
			if (this._implicitSessionContextEnablement[widget.location] === 'first' && widget.viewModel?.getItems().length !== 0) {
				widget.input.runtimeContext.enabled = false;
				widget.input.runtimeContext.setValue(undefined);
			}
		}));

		this._register(
			this.contextPickService.registerChatContextItem(
				new RuntimeSessionContextValuePick(
					this.runtimeSessionService,
					this.positronVariablesService,
					this.executionHistoryService,
					this.configurationService
				)
			));
	}

	private async updateRuntimeContext(): Promise<void> {
		// Determine the active session - prioritize notebook sessions if a notebook editor is active
		// This follows the same pattern as the positron variables service to ensure consistent behavior
		let session = this.runtimeSessionService.foregroundSession;

		// Check if we have an active notebook editor and find its corresponding session
		const editorInput = this.editorService.activeEditor;
		if (editorInput instanceof NotebookEditorInput || editorInput instanceof PositronNotebookEditorInput) {
			// Find the notebook session that corresponds with the active notebook editor
			const notebookSession = this.runtimeSessionService.activeSessions.find(
				s => s.metadata.notebookUri && isEqual(s.metadata.notebookUri, editorInput.resource) && s.getRuntimeState() !== RuntimeState.Exited
			);
			if (notebookSession) {
				session = notebookSession;
			}
		}

		const widgets = [...this.chatWidgetService.getAllWidgets()];
		for (const widget of widgets) {
			if (!widget.input.runtimeContext) {
				continue;
			}
			widget.input.runtimeContext.setServices(
				this.positronVariablesService,
				this.executionHistoryService,
				this.configurationService
			);

			const setting = this._implicitSessionContextEnablement[widget.location];
			const isFirstInteraction = widget.viewModel?.getItems().length === 0;
			if (setting === 'first' && !isFirstInteraction) {
				widget.input.runtimeContext.enabled = false;
				widget.input.runtimeContext.setValue(undefined);
			} else if (setting === 'always' || setting === 'first' && isFirstInteraction) {
				widget.input.runtimeContext.enabled = true;
				widget.input.runtimeContext.setValue(session);
			} else if (setting === 'never') {
				widget.input.runtimeContext.enabled = false;
				widget.input.runtimeContext.setValue(undefined);
			}
		}
	}
}

export class ChatRuntimeSessionContext extends Disposable {
	private static maxCostSettingId = 'chat.runtimeSessionContext.maxExecutionHistoryCharacters';
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
	private _configurationService?: IConfigurationService;

	constructor() {
		super();
	}

	setServices(
		positronVariablesService: IPositronVariablesService,
		executionHistoryService: IExecutionHistoryService,
		configurationService: IConfigurationService
	): void {
		this._positronVariablesService = positronVariablesService;
		this._executionHistoryService = executionHistoryService;
		this._configurationService = configurationService;
	}

	setValue(value: ILanguageRuntimeSession | undefined): void {
		this._value = value;
		this._onDidChangeValue.fire();
	}

	private summarizeSession(session: ILanguageRuntimeSession): IChatRuntimeSessionContext | undefined {
		if (!this._executionHistoryService) {
			return undefined;
		}

		const executions = this.summarizeExecutionHistory(session.metadata.sessionId);
		const sessionContext: IChatRuntimeSessionContext = {
			identifier: session.metadata.sessionId,
			language: session.runtimeMetadata.languageName,
			languageId: session.runtimeMetadata.languageId,
			version: session.runtimeMetadata.languageVersion,
			mode: session.metadata.sessionMode,
			executions,
		};
		if (session.metadata.notebookUri) {
			sessionContext.notebookUri = session.metadata.notebookUri.toString();
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
	private summarizeExecutionHistory(sessionId: string): Array<IHistorySummaryEntry> {
		if (!this._executionHistoryService) {
			return [];
		}

		const history = this._executionHistoryService.getExecutionEntries(sessionId);
		const summarized: Array<IHistorySummaryEntry> = [];
		let currentCost = 0;
		const maxCost = this._configurationService?.getValue<number>(ChatRuntimeSessionContext.maxCostSettingId) ?? 8192; // 8KB, default if not configured
		let firstTracebackIncluded = false;

		for (let i = history.length - 1; i >= 0; i--) {
			const entry = history[i];
			// Filter out non-execution entries
			if (entry.outputType !== ExecutionEntryType.Execution) {
				continue;
			}

			// Compute the cost of the entry
			const output = typeof entry.output === 'string' ? entry.output : '';
			let cost = entry.input.length + output.length;
			let errorContent: string | undefined = undefined;
			if (entry.error) {
				errorContent = JSON.stringify(entry.error);
				cost += errorContent.length;
			}

			// If this would exceed the max cost, try truncating
			if (currentCost + cost > maxCost) {
				const remainingBudget = maxCost - currentCost;

				// For the first traceback, ensure it's included even if truncated
				// We guarantee this traceback is included regardless of size constraints
				if (entry.error && !firstTracebackIncluded) {
					// Calculate dynamic truncation sizes based on available budget
					// Reserve minimum space for truncation markers and structure
					const minReserved = 50; // Space for "... (truncated)" markers
					const availableBudget = Math.max(remainingBudget - minReserved, 100);

					// Use consistent budget allocation logic
					const budgets = this.calculateBudgetAllocation(availableBudget, true);
					const { truncatedInput, truncatedOutput, truncatedErrorContent, cost } = this.truncateEntryContent(
						entry.input,
						output,
						errorContent,
						budgets
					);

					// Always include the first traceback, even if it exceeds remaining budget
					summarized.push({
						input: truncatedInput,
						output: truncatedOutput,
						error: truncatedErrorContent,
					});
					currentCost += cost;
					firstTracebackIncluded = true;
					continue;
				}

				// Try truncating input and output for non-traceback entries or subsequent tracebacks
				// This handles the general case where we need to fit an entry within the remaining budget
				// but it's not the critical first traceback that must be included

				// Calculate dynamic truncation sizes based on remaining budget
				const minReserved = 50; // Space for truncation markers
				const availableBudget = Math.max(remainingBudget - minReserved, 0);

				if (availableBudget <= 0) {
					// No budget left for any entries, stop processing
					break;
				}

				// Use consistent budget allocation logic
				const budgets = this.calculateBudgetAllocation(availableBudget, !!entry.error);
				const { truncatedInput, truncatedOutput, truncatedErrorContent, cost: truncatedCost } = this.truncateEntryContent(
					entry.input,
					output,
					errorContent,
					budgets
				);

				// Calculate the total cost after truncation to see if it fits in remaining budget
				if (truncatedCost > remainingBudget) {
					// Even with aggressive truncation, this entry won't fit in the remaining space
					// Stop processing further entries to respect the maximum cost limit
					break;
				} else {
					// Entry fits within budget after truncation, add it to the summary
					summarized.push({
						input: truncatedInput,
						output: truncatedOutput,
						error: truncatedErrorContent,
					});
					currentCost += truncatedCost;
					// Track that we've included a traceback if this entry had an error
					if (entry.error) {
						firstTracebackIncluded = true;
					}
					continue;
				}
			}

			// Entry fits completely within the remaining budget without any truncation needed
			// This is the ideal case where we can include the full execution entry
			currentCost += cost;
			summarized.push({
				input: entry.input,
				output: output,
				error: entry.error,
			});
			// Mark that we've included a traceback if this entry contains an error
			if (entry.error) {
				firstTracebackIncluded = true;
			}
		}

		// Reverse the order to maintain the original chronological order
		// We processed entries from newest to oldest, but want to present them oldest to newest
		summarized.reverse();
		return summarized;
	}

	/**
	 * Calculates dynamic budget allocation for truncating execution entry components
	 * @param availableBudget Total budget available for this entry
	 * @param hasError Whether this entry contains an error/traceback
	 * @returns Budget allocation for input, output, and error components
	 */
	private calculateBudgetAllocation(availableBudget: number, hasError: boolean): EntryTruncationBudgets {
		if (hasError) {
			// Error gets priority (50%), then output (30%), then input (20%)
			const errorBudget = Math.floor(availableBudget * 0.5);
			const outputBudget = Math.floor(availableBudget * 0.3);
			const inputBudget = availableBudget - errorBudget - outputBudget;
			return { inputBudget, outputBudget, errorBudget };
		} else {
			// No error, split between input (40%) and output (60%)
			const outputBudget = Math.floor(availableBudget * 0.6);
			const inputBudget = availableBudget - outputBudget;
			return { inputBudget, outputBudget, errorBudget: 0 };
		}
	}

	/**
	 * Truncates entry content based on allocated budgets
	 * @param input Original input content
	 * @param output Original output content
	 * @param errorContent Original error content (JSON stringified)
	 * @param budgets Budget allocation for each component
	 * @returns Truncated content for input, output, and error, plus the total cost
	 */
	private truncateEntryContent(
		input: string,
		output: string,
		errorContent: string | undefined,
		budgets: EntryTruncationBudgets
	): EntryTruncationResult {
		// Truncate input dynamically based on budget
		const truncatedInput = input.length > budgets.inputBudget ?
			input.slice(0, Math.max(budgets.inputBudget - 16, 10)) + '... (truncated)' :
			input;

		// Truncate output dynamically based on budget
		const truncatedOutput = output.length > budgets.outputBudget ?
			output.slice(0, Math.max(budgets.outputBudget - 16, 10)) + '... (truncated)' :
			output;

		// Truncate error content dynamically, preserving beginning and end
		let truncatedErrorContent = errorContent;
		if (errorContent && errorContent.length > budgets.errorBudget) {
			// Calculate begin/end lengths dynamically based on error budget
			const truncationMarker = '\n... (traceback truncated) ...\n';
			const markerLength = truncationMarker.length;
			const contentBudget = Math.max(budgets.errorBudget - markerLength, 20);
			const beginLength = Math.floor(contentBudget * 0.6); // 60% for beginning
			const endLength = contentBudget - beginLength; // 40% for end

			truncatedErrorContent = errorContent.slice(0, beginLength) +
				truncationMarker +
				errorContent.slice(-endLength);
		}

		let cost = truncatedInput.length + truncatedOutput.length;
		if (truncatedErrorContent) {
			cost += truncatedErrorContent.length;
		}

		return { truncatedInput, truncatedOutput, truncatedErrorContent, cost };
	}

	public toBaseEntries(): IChatRequestRuntimeSessionEntry[] {
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

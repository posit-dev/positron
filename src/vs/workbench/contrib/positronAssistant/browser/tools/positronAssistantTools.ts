/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { localize } from '../../../../../nls.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { createToolSimpleTextResult } from '../../../chat/common/tools/builtinTools/toolHelpers.js';
import { CountTokensCallback, ILanguageModelToolsService, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolInvocationPreparationContext, IToolResult, ToolDataSource, ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { CodeAttributionSource, IConsoleCodeAttribution } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { getSessionVariables, querySessionTables } from '../../../../services/positronVariables/common/helpers/sessionVariableQueries.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfiguration.js';
import { POSITRON_ASSISTANT_TOOL_TAG, PositronAssistantToolName, TOOL_TAG_REQUIRES_SESSION } from '../../common/positronAssistantToolNames.js';
import { resolveSessionId, resolveVariableNamesToAccessKeys } from './positronAssistantToolUtils.js';
import { PositronExecuteCodeObserver } from './positronExecuteCodeObserver.js';
import { IPositronAssistantService } from '../../common/interfaces/positronAssistantService.js';

/**
 * Only surface these tools when Positron's AI features are enabled.
 */
const aiEnabledWhen = ContextKeyExpr.equals(`config.${AI_ENABLED_KEY}`, true);

/** Tags applied to every tool in this file. */
const positronSessionToolTags = [POSITRON_ASSISTANT_TOOL_TAG, TOOL_TAG_REQUIRES_SESSION];

/** Input for the variable-oriented session tools. */
interface ISessionVariablesToolInput {
	sessionIdentifier?: string;
	variableNames?: string[];
}

//#region getPlot

const getPlotToolData: IToolData = {
	id: PositronAssistantToolName.GetPlot,
	toolReferenceName: PositronAssistantToolName.GetPlot,
	source: ToolDataSource.Internal,
	when: aiEnabledWhen,
	canBeReferencedInPrompt: true,
	icon: ThemeIcon.fromId('graph'),
	tags: positronSessionToolTags,
	displayName: localize('positron.assistant.tool.getPlot.displayName', "View Active Plot"),
	userDescription: localize('positron.assistant.tool.getPlot.userDescription', "View the current active plot."),
	modelDescription: 'View the current active plot if one exists. Don\'t invoke this tool if there are no plots in the session.',
};

class GetPlotTool implements IToolImpl {
	constructor(
		@IPositronAssistantService private readonly _positronAssistantService: IPositronAssistantService,
	) { }

	async prepareToolInvocation(_context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		return {
			invocationMessage: localize('positron.assistant.tool.getPlot.invocation', "Viewing the active plot"),
			pastTenseMessage: localize('positron.assistant.tool.getPlot.pastTense', "Viewed the active plot."),
		};
	}

	async invoke(_invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const uri = this._positronAssistantService.getCurrentPlotUri();
		if (!uri) {
			return createToolSimpleTextResult('No plot visible');
		}

		// Extract the MIME type and base64 data from the data URI.
		const matches = uri.match(/^data:(?<mimeType>[^;]+);base64,(?<data>.+)$/);
		if (!matches?.groups) {
			return createToolSimpleTextResult('Internal Error: Positron returned an unexpected plot URI format');
		}

		// Return the plot image data to the model.
		return {
			content: [{
				kind: 'data',
				value: { mimeType: matches.groups.mimeType, data: decodeBase64(matches.groups.data) },
			}],
		};
	}
}

//#endregion

//#region inspectVariables

const inspectVariablesToolData: IToolData = {
	id: PositronAssistantToolName.InspectVariables,
	toolReferenceName: PositronAssistantToolName.InspectVariables,
	source: ToolDataSource.Internal,
	when: aiEnabledWhen,
	canBeReferencedInPrompt: true,
	icon: ThemeIcon.fromId('positron-variables-view'),
	tags: positronSessionToolTags,
	displayName: localize('positron.assistant.tool.inspectVariables.displayName', "Inspect Variables"),
	userDescription: localize('positron.assistant.tool.inspectVariables.userDescription', "Inspect data and variables in the current session."),
	modelDescription: 'List the children of an array of variables in a session. For example, the columns in a dataframe, items in a column or array, or elements of a list. If `variableNames` is empty, lists all root-level variables in the session.',
	inputSchema: {
		type: 'object',
		properties: {
			sessionIdentifier: {
				type: 'string',
				description: 'The identifier of the session to inspect. Optional; defaults to the active session.',
			},
			variableNames: {
				type: 'array',
				description: 'An array of variable names to inspect.',
				items: { type: 'string', description: 'The name of a variable to inspect.' },
			},
		},
		required: ['variableNames'],
	},
};

class InspectVariablesTool implements IToolImpl {
	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IPositronVariablesService private readonly _positronVariablesService: IPositronVariablesService,
	) { }

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const input = invocation.parameters as ISessionVariablesToolInput;

		const sessionId = resolveSessionId(this._runtimeSessionService, input.sessionIdentifier);
		if (!sessionId) {
			return createToolSimpleTextResult('[[]]');
		}

		// Resolve variable names to access keys.
		const variableNames = input.variableNames || [];
		let accessKeys: Array<Array<string>> | undefined;
		let notFoundMessage = '';
		if (variableNames.length > 0) {
			const resolved = await resolveVariableNamesToAccessKeys(this._positronVariablesService, sessionId, variableNames);
			accessKeys = resolved.accessKeys;
			if (!resolved.allFound) {
				notFoundMessage = `Note: The following variable names were not found: ${resolved.notFound.join(', ')}. Returning all available variables instead.\n\n`;
			}
		}

		const result = await getSessionVariables(this._positronVariablesService, sessionId, accessKeys);
		return createToolSimpleTextResult(notFoundMessage + JSON.stringify(result));
	}
}

//#endregion

//#region getTableSummary

const getTableSummaryToolData: IToolData = {
	id: PositronAssistantToolName.GetTableSummary,
	toolReferenceName: PositronAssistantToolName.GetTableSummary,
	source: ToolDataSource.Internal,
	when: aiEnabledWhen,
	canBeReferencedInPrompt: true,
	icon: ThemeIcon.fromId('table'),
	tags: positronSessionToolTags,
	displayName: localize('positron.assistant.tool.getTableSummary.displayName', "Get Table Summary"),
	userDescription: localize('positron.assistant.tool.getTableSummary.userDescription', "Get a summary of a table's data and structure."),
	modelDescription: 'Retrieve summary statistics and structure of tabular data variables (DataFrames, tibbles, arrays) in the current session. Use when the user asks to summarize, describe, or inspect their data.',
	inputSchema: {
		type: 'object',
		properties: {
			sessionIdentifier: {
				type: 'string',
				description: 'The identifier of the session that contains the tables. Optional; defaults to the active session.',
			},
			variableNames: {
				type: 'array',
				description: 'An array of table variable names to summarize.',
				items: { type: 'string', description: 'The name of a table variable to summarize.' },
			},
		},
		required: ['variableNames'],
	},
};

class GetTableSummaryTool implements IToolImpl {
	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IPositronVariablesService private readonly _positronVariablesService: IPositronVariablesService,
	) { }

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const input = invocation.parameters as ISessionVariablesToolInput;

		const sessionId = resolveSessionId(this._runtimeSessionService, input.sessionIdentifier);
		if (!sessionId) {
			return createToolSimpleTextResult('[[]]');
		}

		const session = this._runtimeSessionService.getSession(sessionId);
		if (!session) {
			return createToolSimpleTextResult('[[]]');
		}

		// Enable only for R and Python sessions.
		const languageId = session.runtimeMetadata.languageId;
		if (languageId !== 'python' && languageId !== 'r') {
			return createToolSimpleTextResult('[[]]');
		}

		// Resolve variable names to access keys.
		const variableNames = input.variableNames || [];
		const resolved = await resolveVariableNamesToAccessKeys(this._positronVariablesService, sessionId, variableNames);
		let notFoundMessage = '';
		if (!resolved.allFound) {
			notFoundMessage = `Note: The following variable names were not found: ${resolved.notFound.join(', ')}. Returning all available table summaries instead.\n\n`;
		}

		const result = await querySessionTables(this._positronVariablesService, sessionId, resolved.accessKeys, ['summary_stats']);
		return createToolSimpleTextResult(notFoundMessage + JSON.stringify(result));
	}
}

//#endregion

//#region executeCode

const executeCodeToolData: IToolData = {
	id: PositronAssistantToolName.ExecuteCode,
	toolReferenceName: PositronAssistantToolName.ExecuteCode,
	source: ToolDataSource.Internal,
	when: aiEnabledWhen,
	canBeReferencedInPrompt: true,
	icon: ThemeIcon.fromId('play'),
	tags: positronSessionToolTags,
	displayName: localize('positron.assistant.tool.executeCode.displayName', "Execute Code"),
	userDescription: localize('positron.assistant.tool.executeCode.userDescription', "Execute code in the console."),
	modelDescription: 'Execute a piece of code in the specified programming language and return the result. You prefer to show code over running it unless given an imperative. You prefer this tool to the terminal and other ways of running code when there is a session available with the correct language.',
	inputSchema: {
		type: 'object',
		properties: {
			sessionIdentifier: {
				type: 'string',
				description: 'The identifier of the session to execute the code in. Optional; defaults to the active session for the language.',
			},
			code: {
				type: 'string',
				description: 'The code to execute.',
			},
			language: {
				type: 'string',
				description: 'The programming language of the code.',
			},
			summary: {
				type: 'string',
				description: 'A very short summary of the task the code is performing, beginning with a verb and not to exceed 7 words. Shown to the user to help them understand what the code will do.',
			},
		},
	},
};

interface IExecuteCodeToolInput {
	sessionIdentifier?: string;
	code: string;
	language: string;
	summary?: string;
}

class ExecuteCodeTool implements IToolImpl {
	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
	) { }

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const input = context.parameters as IExecuteCodeToolInput;

		// Show the user the code we are about to run and ask for confirmation.
		const codeBlock = new MarkdownString();
		codeBlock.appendCodeblock(input.code, input.language);

		return {
			invocationMessage: codeBlock,
			confirmationMessages: {
				title: input.summary || localize('positron.assistant.tool.executeCode.confirmTitle', "Run Code"),
				message: codeBlock,
			},
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, token: CancellationToken): Promise<IToolResult> {
		const input = invocation.parameters as IExecuteCodeToolInput;

		// Convert the language name into a language id. This works for R and
		// Python but may not hold for every language.
		const languageId = input.language.toLowerCase();
		const executionId = generateUuid();
		const attribution: IConsoleCodeAttribution = { source: CodeAttributionSource.Assistant };

		// Resolve the target session up front so we can observe its output
		// before the code starts running.
		let session = input.sessionIdentifier
			? this._runtimeSessionService.getSession(input.sessionIdentifier)
			: this._runtimeSessionService.getConsoleSessionForLanguage(languageId);
		let observer = session ? new PositronExecuteCodeObserver(session, executionId, token) : undefined;

		try {
			// Dispatch the execution. Passing the resolved session id keeps the
			// code in the session we are already observing.
			const sessionId = await this._positronConsoleService.executeCode(
				languageId,
				session?.sessionId,
				input.code,
				attribution,
				true,  // focus the console
				true,  // allow incomplete input so incomplete statements error right away
				RuntimeCodeExecutionMode.NonInteractive,
				RuntimeErrorBehavior.Stop,
				executionId);

			// If no session existed up front, the console created one; observe it now.
			if (!observer) {
				session = this._runtimeSessionService.getSession(sessionId);
				observer = session ? new PositronExecuteCodeObserver(session, executionId, token) : undefined;
			}

			const result = observer
				? await observer.waitForResult()
				: { error: { name: 'NoSession', message: 'No runtime session was available to execute the code.' } };
			return createToolSimpleTextResult(JSON.stringify(result));
		} finally {
			observer?.dispose();
		}
	}
}

//#endregion

/**
 * Registers Positron Assistant's session-oriented language model tools as
 * built-in tools. These were previously contributed by the
 * `positron-assistant` extension via `vscode.lm.registerTool`.
 */
export class PositronAssistantToolsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronAssistantTools';

	constructor(
		@ILanguageModelToolsService toolsService: ILanguageModelToolsService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(toolsService.registerTool(executeCodeToolData, instantiationService.createInstance(ExecuteCodeTool)));
		this._register(toolsService.registerTool(getPlotToolData, instantiationService.createInstance(GetPlotTool)));
		this._register(toolsService.registerTool(inspectVariablesToolData, instantiationService.createInstance(InspectVariablesTool)));
		this._register(toolsService.registerTool(getTableSummaryToolData, instantiationService.createInstance(GetTableSummaryTool)));
	}
}

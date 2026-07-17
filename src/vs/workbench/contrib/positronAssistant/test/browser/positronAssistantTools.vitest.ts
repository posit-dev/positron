/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, decodeBase64, encodeBase64 } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ILanguageRuntimeMessageResult, ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { VariablesClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeVariablesClient.js';
import { InspectedVariable, PositronVariablesComm, QueryTableSummaryResult, Variable, VariableList } from '../../../../services/languageRuntime/common/positronVariablesComm.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IPositronVariablesInstance } from '../../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { CountTokensCallback, IToolInvocation, IToolResult, ToolProgress } from '../../../chat/common/tools/languageModelToolsService.js';
import { ExecuteCodeTool, GetPlotTool, GetTableSummaryTool, InspectVariablesTool } from '../../browser/tools/positronAssistantTools.js';
import { IPositronAssistantService } from '../../common/interfaces/positronAssistantService.js';

const SESSION_ID = 'session-1';

// The two non-service arguments every IToolImpl.invoke receives; unused by
// these tools, so no-ops satisfy the signature.
const countTokens: CountTokensCallback = async () => 0;
const progress: ToolProgress = { report: () => { } };

/** Build a tool invocation carrying the given parameters. */
function invocation(parameters: Record<string, unknown>): IToolInvocation {
	return stubInterface<IToolInvocation>({ parameters });
}

/** Read the single text content part from a tool result. */
function textOf(result: IToolResult): string {
	const [part] = result.content;
	if (part.kind !== 'text') {
		throw new Error(`expected a text result but got '${part.kind}'`);
	}
	return part.value;
}

/** Build a minimal Variable exposing only the fields the tools read for name resolution. */
function variable(displayName: string, accessKey: string): Variable {
	return stubInterface<Variable>({ display_name: displayName, access_key: accessKey });
}

/** Build a variables service with a single session whose comm behaves as configured. */
function variablesServiceWith(overrides: { rootVariables?: Variable[]; tableSummary?: QueryTableSummaryResult }): IPositronVariablesService {
	const comm = stubInterface<PositronVariablesComm>({
		list: async () => stubInterface<VariableList>({ variables: overrides.rootVariables ?? [] }),
		inspect: async () => stubInterface<InspectedVariable>({ children: [] }),
		queryTableSummary: async () => overrides.tableSummary!,
	});
	const client = stubInterface<VariablesClientInstance>({ comm });
	const instance = stubInterface<IPositronVariablesInstance>({
		session: stubInterface<ILanguageRuntimeSession>({ sessionId: SESSION_ID }),
		getClientInstance: () => client,
	});
	return stubInterface<IPositronVariablesService>({ positronVariablesInstances: [instance] });
}

describe('GetPlotTool', () => {
	function invoke(plotUri: string | undefined): Promise<IToolResult> {
		const tool = new GetPlotTool(stubInterface<IPositronAssistantService>({ getCurrentPlotUri: () => plotUri }));
		return tool.invoke(invocation({}), countTokens, progress, CancellationToken.None);
	}

	it('reports no plot when none is visible', async () => {
		expect(textOf(await invoke(undefined))).toBe('No plot visible');
	});

	it('reports an internal error when the plot URI is not a base64 data URI', async () => {
		expect(textOf(await invoke('https://example.com/plot.png'))).toBe('Internal Error: Positron returned an unexpected plot URI format');
	});

	it('returns the decoded image data for a valid data URI', async () => {
		const encoded = encodeBase64(VSBuffer.fromString('image-bytes'));

		const result = await invoke(`data:image/png;base64,${encoded}`);

		expect(result.content).toEqual([{ kind: 'data', value: { mimeType: 'image/png', data: decodeBase64(encoded) } }]);
	});
});

describe('InspectVariablesTool', () => {
	function invoke(runtimeSessionService: IRuntimeSessionService, variablesService: IPositronVariablesService, parameters: Record<string, unknown>): Promise<IToolResult> {
		const tool = new InspectVariablesTool(runtimeSessionService, variablesService);
		return tool.invoke(invocation(parameters), countTokens, progress, CancellationToken.None);
	}

	it('returns an empty result when no session can be resolved', async () => {
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ foregroundSession: undefined });

		expect(textOf(await invoke(runtimeSessionService, variablesServiceWith({}), { variableNames: ['df'] }))).toBe('[[]]');
	});

	it('inspects the requested variables when all names are found', async () => {
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ foregroundSession: undefined });
		const variablesService = variablesServiceWith({ rootVariables: [variable('df', 'key_df')] });

		expect(textOf(await invoke(runtimeSessionService, variablesService, { sessionIdentifier: SESSION_ID, variableNames: ['df'] }))).toBe('[[]]');
	});

	it('prepends a not-found note when a requested variable is missing', async () => {
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ foregroundSession: undefined });
		const variablesService = variablesServiceWith({ rootVariables: [variable('df', 'key_df')] });

		expect(textOf(await invoke(runtimeSessionService, variablesService, { sessionIdentifier: SESSION_ID, variableNames: ['missing'] })))
			.toBe('Note: The following variable names were not found: missing. Returning all available variables instead.\n\n[[]]');
	});
});

describe('GetTableSummaryTool', () => {
	function sessionWithLanguage(languageId: string): ILanguageRuntimeSession {
		return stubInterface<ILanguageRuntimeSession>({
			sessionId: SESSION_ID,
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ languageId }),
		});
	}

	function invoke(runtimeSessionService: IRuntimeSessionService, variablesService: IPositronVariablesService, parameters: Record<string, unknown>): Promise<IToolResult> {
		const tool = new GetTableSummaryTool(runtimeSessionService, variablesService);
		return tool.invoke(invocation(parameters), countTokens, progress, CancellationToken.None);
	}

	it('returns an empty result when no session can be resolved', async () => {
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ foregroundSession: undefined });

		expect(textOf(await invoke(runtimeSessionService, variablesServiceWith({}), { variableNames: ['df'] }))).toBe('[[]]');
	});

	it('returns an empty result when the resolved session no longer exists', async () => {
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ getSession: () => undefined });

		expect(textOf(await invoke(runtimeSessionService, variablesServiceWith({}), { sessionIdentifier: SESSION_ID, variableNames: ['df'] }))).toBe('[[]]');
	});

	it('returns an empty result for sessions that are neither R nor Python', async () => {
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ getSession: () => sessionWithLanguage('julia') });

		expect(textOf(await invoke(runtimeSessionService, variablesServiceWith({}), { sessionIdentifier: SESSION_ID, variableNames: ['df'] }))).toBe('[[]]');
	});

	it('summarizes the requested tables for a Python session', async () => {
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ getSession: () => sessionWithLanguage('python') });
		const tableSummary: QueryTableSummaryResult = { num_rows: 10, num_columns: 2, column_schemas: [], column_profiles: [] };
		const variablesService = variablesServiceWith({ rootVariables: [variable('df', 'key_df')], tableSummary });

		expect(JSON.parse(textOf(await invoke(runtimeSessionService, variablesService, { sessionIdentifier: SESSION_ID, variableNames: ['df'] })))).toEqual([tableSummary]);
	});
});

describe('ExecuteCodeTool', () => {
	const disposables = ensureNoLeakedDisposables();

	it('reports a NoSession error when no runtime session is available', async () => {
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({
			getConsoleSessionForLanguage: () => undefined,
			getSession: () => undefined,
		});
		const consoleService = stubInterface<IPositronConsoleService>({ executeCode: async () => 'created-session' });
		const tool = new ExecuteCodeTool(runtimeSessionService, consoleService);

		const result = await tool.invoke(invocation({ code: '1 + 1', language: 'Python' }), countTokens, progress, CancellationToken.None);

		expect(JSON.parse(textOf(result))).toEqual({ error: { name: 'NoSession', message: 'No runtime session was available to execute the code.' } });
	});

	it('executes in the resolved console session and returns the observed result', async () => {
		const resultMessages = disposables.add(new Emitter<ILanguageRuntimeMessageResult>());
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: SESSION_ID,
			onDidReceiveRuntimeMessageOutput: Event.None,
			onDidReceiveRuntimeMessageResult: resultMessages.event,
			onDidReceiveRuntimeMessageStream: Event.None,
			onDidReceiveRuntimeMessageError: Event.None,
			onDidReceiveRuntimeMessageState: Event.None,
		});
		const runtimeSessionService = stubInterface<IRuntimeSessionService>({ getConsoleSessionForLanguage: () => session });
		const consoleService = stubInterface<IPositronConsoleService>({
			// The observer subscribes before the code runs, so fire the result as
			// the execution is dispatched, correlated by the tool's execution id.
			executeCode: async (_lang, _sid, _code, _attr, _focus, _incomplete, _mode, _err, executionId) => {
				resultMessages.fire(stubInterface<ILanguageRuntimeMessageResult>({ parent_id: executionId!, data: { 'text/plain': '2' } }));
				return SESSION_ID;
			},
		});
		const tool = new ExecuteCodeTool(runtimeSessionService, consoleService);

		const result = await tool.invoke(invocation({ code: '1 + 1', language: 'Python' }), countTokens, progress, CancellationToken.None);

		expect(JSON.parse(textOf(result))).toEqual({ result: '2' });
	});
});

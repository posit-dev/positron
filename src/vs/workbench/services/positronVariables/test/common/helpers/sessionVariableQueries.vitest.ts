/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { VariablesClientInstance } from '../../../../languageRuntime/common/languageRuntimeVariablesClient.js';
import { InspectedVariable, PositronVariablesComm, QueryTableSummaryResult, Variable, VariableList } from '../../../../languageRuntime/common/positronVariablesComm.js';
import { ILanguageRuntimeSession } from '../../../../runtimeSession/common/runtimeSessionService.js';
import { IPositronVariablesInstance } from '../../../common/interfaces/positronVariablesInstance.js';
import { IPositronVariablesService } from '../../../common/interfaces/positronVariablesService.js';
import { getSessionVariables, querySessionTables } from '../../../common/helpers/sessionVariableQueries.js';

const SESSION_ID = 'session-1';

/** Build a minimal Variable exposing only the field the helpers surface. */
function variable(accessKey: string): Variable {
	return stubInterface<Variable>({ access_key: accessKey });
}

/**
 * Build a variables service with a single session whose client's comm behaves
 * as configured. When `hasClient` is false, the session reports no client,
 * exercising the "no variables provider available" branch.
 */
function variablesServiceWith(comm: Partial<PositronVariablesComm>, hasClient = true): IPositronVariablesService {
	const client = hasClient
		? stubInterface<VariablesClientInstance>({ comm: stubInterface<PositronVariablesComm>(comm) })
		: undefined;
	const instance = stubInterface<IPositronVariablesInstance>({
		session: stubInterface<ILanguageRuntimeSession>({ sessionId: SESSION_ID }),
		getClientInstance: () => client,
	});
	return stubInterface<IPositronVariablesService>({ positronVariablesInstances: [instance] });
}

describe('getSessionVariables', () => {
	it('throws when no session matches the requested id', async () => {
		const service = stubInterface<IPositronVariablesService>({ positronVariablesInstances: [] });

		await expect(getSessionVariables(service, SESSION_ID)).rejects.toThrow('No variables provider found for session session-1');
	});

	it('throws when the matching session has no client', async () => {
		const service = variablesServiceWith({}, /* hasClient */ false);

		await expect(getSessionVariables(service, SESSION_ID)).rejects.toThrow('No variables provider available for session session-1');
	});

	it('lists all root-level variables when no access keys are supplied', async () => {
		const rootVariables = [variable('a'), variable('b')];
		const service = variablesServiceWith({ list: async () => stubInterface<VariableList>({ variables: rootVariables }) });

		expect(await getSessionVariables(service, SESSION_ID)).toEqual([rootVariables]);
	});

	it('lists all root-level variables when the access keys are all empty', async () => {
		const rootVariables = [variable('a')];
		const service = variablesServiceWith({ list: async () => stubInterface<VariableList>({ variables: rootVariables }) });

		expect(await getSessionVariables(service, SESSION_ID, [[]])).toEqual([rootVariables]);
	});

	it('inspects the children of each supplied access key', async () => {
		const childrenByKey = new Map<string, Variable[]>([
			['df', [variable('df.col')]],
			['x', [variable('x.0')]],
		]);
		const service = variablesServiceWith({
			inspect: async (path: string[]) => stubInterface<InspectedVariable>({ children: childrenByKey.get(path[0]) ?? [] }),
		});

		expect(await getSessionVariables(service, SESSION_ID, [['df'], ['x']])).toEqual([childrenByKey.get('df'), childrenByKey.get('x')]);
	});
});

describe('querySessionTables', () => {
	it('throws when no access keys are provided', async () => {
		const service = variablesServiceWith({});

		await expect(querySessionTables(service, SESSION_ID, [], ['summary_stats'])).rejects.toThrow('No access keys provided for variable data retrieval');
	});

	it('returns a table summary for each supplied access key', async () => {
		const summaryByKey = new Map<string, QueryTableSummaryResult>([
			['df', stubInterface<QueryTableSummaryResult>({ num_rows: 10 })],
			['tbl', stubInterface<QueryTableSummaryResult>({ num_rows: 20 })],
		]);
		const service = variablesServiceWith({
			queryTableSummary: async (path: string[]) => summaryByKey.get(path[0])!,
		});

		expect(await querySessionTables(service, SESSION_ID, [['df'], ['tbl']], ['summary_stats'])).toEqual([summaryByKey.get('df'), summaryByKey.get('tbl')]);
	});
});

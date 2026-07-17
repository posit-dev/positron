/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryTableSummaryResult, Variable } from '../../../languageRuntime/common/positronVariablesComm.js';
import { VariablesClientInstance } from '../../../languageRuntime/common/languageRuntimeVariablesClient.js';
import { IPositronVariablesService } from '../interfaces/positronVariablesService.js';

/**
 * Resolve the variables client for a session, throwing a descriptive error if
 * no variables provider is available.
 *
 * @param variablesService The Positron variables service.
 * @param sessionId The runtime session to look up.
 * @returns The variables client instance for the session.
 */
function getVariablesClient(variablesService: IPositronVariablesService, sessionId: string): VariablesClientInstance {
	const instance = variablesService.positronVariablesInstances.find(
		candidate => candidate.session.sessionId === sessionId);
	if (!instance) {
		throw new Error(`No variables provider found for session ${sessionId}`);
	}
	const client = instance.getClientInstance();
	if (!client) {
		throw new Error(`No variables provider available for session ${sessionId}`);
	}
	return client;
}

/**
 * Get the variables in a session, optionally scoped to a set of access keys.
 *
 * When access keys are provided, the children of each referenced variable are
 * returned. Otherwise, all root-level variables are returned.
 *
 * @param variablesService The Positron variables service.
 * @param sessionId The runtime session to inspect.
 * @param accessKeys Optional access key paths to inspect.
 * @returns An array of variable arrays, one per requested access key (or a
 * single entry containing all root-level variables).
 */
export async function getSessionVariables(
	variablesService: IPositronVariablesService,
	sessionId: string,
	accessKeys?: Array<Array<string>>): Promise<Array<Array<Variable>>> {
	const client = getVariablesClient(variablesService, sessionId);
	const accessKeysProvided = !!accessKeys && accessKeys.length > 0 && accessKeys.some(key => key.length !== 0);
	if (accessKeysProvided) {
		const result: Array<Array<Variable>> = [];
		for (const accessKey of accessKeys!) {
			result.push((await client.comm.inspect(accessKey)).children);
		}
		return result;
	}
	const allVars = await client.comm.list();
	return [allVars.variables];
}

/**
 * Query summary information for one or more tabular variables in a session.
 *
 * @param variablesService The Positron variables service.
 * @param sessionId The runtime session to query.
 * @param accessKeys The access key paths of the tables to summarize.
 * @param queryTypes The summary query types to run (e.g. `summary_stats`).
 * @returns A summary result per requested access key.
 */
export async function querySessionTables(
	variablesService: IPositronVariablesService,
	sessionId: string,
	accessKeys: Array<Array<string>>,
	queryTypes: Array<string>): Promise<Array<QueryTableSummaryResult>> {
	const client = getVariablesClient(variablesService, sessionId);
	if (accessKeys.length === 0) {
		throw new Error('No access keys provided for variable data retrieval');
	}
	const result: Array<QueryTableSummaryResult> = [];
	for (const accessKey of accessKeys) {
		result.push(await client.comm.queryTableSummary(accessKey, queryTypes));
	}
	return result;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSessionVariables } from '../../../../services/positronVariables/common/helpers/sessionVariableQueries.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * Result of resolving variable names to access keys.
 */
export interface ResolveVariableNamesResult {
	/** The resolved access key paths for each requested variable name. */
	accessKeys: Array<Array<string>>;
	/** Whether all requested names were found. */
	allFound: boolean;
	/** Names that were not found in the session. */
	notFound: string[];
}

/**
 * Resolve the runtime session a session tool should act on.
 *
 * Uses the identifier the model supplied, or falls back to the foreground
 * session when none is given.
 *
 * @param runtimeSessionService The runtime session service.
 * @param sessionIdentifier The identifier supplied by the model, if any.
 * @returns A session identifier, or undefined if no session is available.
 */
export function resolveSessionId(
	runtimeSessionService: IRuntimeSessionService,
	sessionIdentifier?: string): string | undefined {
	if (sessionIdentifier && sessionIdentifier !== 'undefined') {
		return sessionIdentifier;
	}
	return runtimeSessionService.foregroundSession?.sessionId;
}

/**
 * Resolve variable names to access keys by looking up variables in the session.
 *
 * If a name matches a variable's display name, the corresponding access key is
 * returned. If any requested name is not found, returns access keys for ALL
 * variables in the session to help the model discover what is available.
 *
 * @param variablesService The Positron variables service.
 * @param sessionId The session to look up variables in.
 * @param variableNames The variable names to resolve.
 * @returns The resolved access keys, whether all were found, and any not-found names.
 */
export async function resolveVariableNamesToAccessKeys(
	variablesService: IPositronVariablesService,
	sessionId: string,
	variableNames: string[]): Promise<ResolveVariableNamesResult> {
	// Get all root-level variables to build a name -> access_key map.
	const allVariables = await getSessionVariables(variablesService, sessionId);
	const rootVariables = allVariables[0] || [];

	const nameToAccessKey = new Map<string, string>();
	for (const variable of rootVariables) {
		nameToAccessKey.set(variable.display_name, variable.access_key);
	}

	// If any name is not found, return all variables to help the model discover
	// what is available.
	const notFound = variableNames.filter(name => !nameToAccessKey.has(name));
	if (notFound.length > 0) {
		return {
			accessKeys: rootVariables.map(variable => [variable.access_key]),
			allFound: false,
			notFound,
		};
	}

	// All names found - resolve each to its access key.
	return {
		accessKeys: variableNames.map(name => [nameToAccessKey.get(name)!]),
		allFound: true,
		notFound: [],
	};
}

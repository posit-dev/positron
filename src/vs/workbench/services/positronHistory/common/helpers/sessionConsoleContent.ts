/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeSessionService } from '../../../runtimeSession/common/runtimeSessionService.js';
import { IConsoleContentEntry, IExecutionHistoryService, projectExecutionEntriesToConsoleContent } from '../executionHistoryService.js';

/**
 * Get the recent console content for a session: the code fragments that have
 * run, each paired with its output and any error.
 *
 * The session is validated first, throwing a descriptive error for an unknown
 * session ID. This keeps the error surface consistent with the sibling
 * session-scoped read APIs (`getSessionVariables` / `querySessionTables`) and
 * avoids silently allocating a permanent, empty execution history through the
 * create-on-read path of {@link IExecutionHistoryService.getExecutionEntries}
 * when handed an untrusted session ID.
 *
 * @param executionHistoryService The execution history service.
 * @param runtimeSessionService The runtime session service, used to validate the session.
 * @param sessionId The runtime session to read console content for.
 * @param numberOfEntries The number of most recent entries to return.
 * @returns The projected console content entries, oldest first.
 */
export function getConsoleContent(
	executionHistoryService: IExecutionHistoryService,
	runtimeSessionService: IRuntimeSessionService,
	sessionId: string,
	numberOfEntries?: number): IConsoleContentEntry[] {
	if (!runtimeSessionService.getSession(sessionId)) {
		throw new Error(`No such session: ${sessionId}`);
	}
	return projectExecutionEntriesToConsoleContent(
		executionHistoryService.getExecutionEntries(sessionId), numberOfEntries);
}

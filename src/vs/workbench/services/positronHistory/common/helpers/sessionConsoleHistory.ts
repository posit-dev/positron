/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IRuntimeSessionService } from '../../../runtimeSession/common/runtimeSessionService.js';
import { CONSOLE_HISTORY_API_ENABLED_KEY, IConsoleHistoryEntry, IExecutionHistoryService, projectExecutionEntriesToConsoleHistory } from '../executionHistoryService.js';

/**
 * Get the recent console history for a session: the code fragments that have
 * run, each paired with its output and any error.
 *
 * Two guards run before any history is read, both throwing a descriptive error:
 *
 * - The {@link CONSOLE_HISTORY_API_ENABLED_KEY} privacy setting must be enabled
 *   (it is by default); a user can disable it to keep console content from
 *   being exposed to extensions.
 * - The session must exist. Validating it keeps the error surface consistent
 *   with the sibling session-scoped read APIs (`getSessionVariables` /
 *   `querySessionTables`) and avoids silently allocating a permanent, empty
 *   execution history through the create-on-read path of
 *   {@link IExecutionHistoryService.getExecutionEntries} when handed an
 *   untrusted session ID.
 *
 * The setting is read live so a mid-session toggle takes effect immediately.
 *
 * @param executionHistoryService The execution history service.
 * @param runtimeSessionService The runtime session service, used to validate the session.
 * @param configurationService The configuration service, used to read the privacy setting.
 * @param sessionId The runtime session to read console history for.
 * @param numberOfEntries The number of most recent entries to return.
 * @returns The projected console history entries, oldest first.
 */
export function getConsoleHistory(
	executionHistoryService: IExecutionHistoryService,
	runtimeSessionService: IRuntimeSessionService,
	configurationService: IConfigurationService,
	sessionId: string,
	numberOfEntries?: number): IConsoleHistoryEntry[] {
	if (configurationService.getValue<boolean>(CONSOLE_HISTORY_API_ENABLED_KEY) === false) {
		throw new Error(`Console history is unavailable because the "${CONSOLE_HISTORY_API_ENABLED_KEY}" setting is disabled.`);
	}
	if (!runtimeSessionService.getSession(sessionId)) {
		throw new Error(`No such session: ${sessionId}`);
	}
	return projectExecutionEntriesToConsoleHistory(
		executionHistoryService.getExecutionEntries(sessionId), numberOfEntries);
}

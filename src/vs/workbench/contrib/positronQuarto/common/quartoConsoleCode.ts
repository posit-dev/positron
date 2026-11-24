/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IQuartoExecutionManager } from './quartoExecutionTypes.js';
import { liveConsoleSession } from './quartoLanguages.js';

/** Code from a Quarto document ready for the console, and the session to run it in. */
export interface IQuartoConsoleCode {
	readonly code: string;
	/** The session to pin the code to, or undefined to leave it to the console service. */
	readonly sessionId: string | undefined;
}

/**
 * Prepares code from a Quarto document for the console (see
 * `IQuartoExecutionManager.consoleCode`), and decides which session it runs in.
 *
 * The code is prepared for a session: the one asked for, or else the language's
 * live console session. Code that preparing changed, such as a statement given
 * its cell's `@connect` line, is pinned to that session, since the preamble was
 * decided for it. Any other code keeps the session it was asked to run in, if
 * any, and is otherwise left for the console service to route. An exited session
 * is never the one prepared for, so code is never pinned to it.
 *
 * @param documentUri The Quarto document.
 * @param lineNumber A line of the cell the code comes from (1-based), or
 *   undefined when the code is a whole cell's.
 * @param code The code about to run.
 * @param languageId The language of the console it runs in.
 * @param sessionId The session the caller asked for, if any.
 */
export async function prepareQuartoConsoleCode(
	documentUri: URI,
	lineNumber: number | undefined,
	code: string,
	languageId: string,
	sessionId: string | undefined,
	services: {
		quartoExecutionManager: IQuartoExecutionManager;
		runtimeSessionService: IRuntimeSessionService;
	},
): Promise<IQuartoConsoleCode> {
	const targetSessionId = sessionId ?? liveConsoleSession(languageId, services.runtimeSessionService)?.sessionId;
	const prepared = await services.quartoExecutionManager.consoleCode(documentUri, lineNumber, code, targetSessionId);
	return prepared === code
		? { code, sessionId }
		: { code: prepared, sessionId: targetSessionId };
}

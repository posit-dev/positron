/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import * as xml from '../../common/xml.js';

/**
 * Information about the currently selected runtime, derived for prompt
 * generation.
 */
export interface IForegroundSessionInfo {
	/**
	 * Render-data sessions used to select language-specific prompt fragments
	 * (drives `positron.hasRSession` / `positron.hasPythonSession`).
	 */
	sessions: Array<{ languageId: string }>;
	/**
	 * An explicit context fragment naming the active session so the model knows
	 * which runtime to use. Undefined when no session is selected.
	 */
	contextFragment?: string;
}

/**
 * Describe the currently selected (foreground) runtime session for the chat
 * prompt.
 *
 * Scoped to the foreground session so the prompt reflects the runtime the user
 * is actually working in, rather than every session that happens to be active
 * in the background. Emits an explicit context fragment so the model executes
 * code in the selected session instead of guessing a language.
 *
 * @param runtimeSessionService The runtime session service.
 * @returns The render sessions and an optional context fragment.
 */
export function getForegroundSessionInfo(runtimeSessionService: IRuntimeSessionService): IForegroundSessionInfo {
	const foregroundSession = runtimeSessionService.foregroundSession;
	if (!foregroundSession) {
		return { sessions: [] };
	}

	const metadata = foregroundSession.runtimeMetadata;
	const contextFragment = xml.node(
		'active-session',
		`The user is currently working in a ${metadata.languageName} session (${metadata.runtimeName}). ` +
		`Unless the user asks otherwise, write ${metadata.languageName} code and run it in this session.`);

	return {
		sessions: [{ languageId: metadata.languageId }],
		contextFragment,
	};
}

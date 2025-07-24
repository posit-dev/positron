/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';
import { Tag } from '../Tag';

/**
 * A single summarized entry in the execution history provided to the chat model.
 */
export interface IHistorySummaryEntry {
	/** The input code for the execution */
	input: string;

	/** The result of the execution */
	output: string;

	/** The error, if any, that occurred during the execution. Can be text or structured object */
	error?: any;
}

/**
 * The runtime session context for the chat model based on IChatRuntimeSessionContext.
 */
export interface SessionData {
	/** The unique identifier for the runtime session (sessionId, e.g. 'python-12345678') */
	identifier: string;

	/** The language name of the runtime session (e.g. 'Python') */
	language: string;

	/** The language identifier of the runtime session (e.g. 'python') */
	languageId: string;

	/** The version of the language runtime (e.g. '3.10.4') */
	version: string;

	/** The mode of the runtime session (e.g. 'console') */
	mode: string; // LanguageRuntimeSessionMode enum value as string

	/** The notebook URI, if applicable */
	notebookUri?: string;

	/** The summarized execution history for the session */
	executions: Array<IHistorySummaryEntry>;

	/** Additional session information (for backward compatibility) */
	sessionSummary?: string;
}

export interface SessionProps extends BasePromptElementProps {
	session: SessionData;
}

/**
 * Component for rendering individual session data.
 */
export class Session extends PromptElement<SessionProps> {
	render() {
		const { session } = this.props;

		// If we have the full session data structure, use it
		if (session.language && session.languageId) {
			const sessionInfo = JSON.stringify({
				identifier: session.identifier,
				language: session.language,
				languageId: session.languageId,
				version: session.version,
				mode: session.mode,
				notebookUri: session.notebookUri,
				executions: session.executions
			}, null, 2);

			return (
				<Tag name="session">
					{sessionInfo}
				</Tag>
			);
		}

		// Fallback to sessionSummary for backward compatibility
		return (
			<Tag name="session">
				{session.sessionSummary || JSON.stringify(session, null, 2)}
			</Tag>
		);
	}
}

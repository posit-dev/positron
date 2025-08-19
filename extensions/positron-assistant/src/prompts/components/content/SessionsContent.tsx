/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	AssistantMessage,
	BasePromptElementProps,
	PromptElement,
	TextChunk
} from '@vscode/prompt-tsx';
import { Session, SessionData } from './Session';

export interface SessionsContentProps extends BasePromptElementProps {
	sessions?: SessionData[];
}

/**
 * Instructions for handling session information in the Positron Assistant.
 */
export class SessionsContent extends PromptElement<SessionsContentProps> {
	render() {
		const { sessions = [] } = this.props;

		return (
			<AssistantMessage>
				<TextChunk>
				The user has attached information about their interactive
				interpreter session below. This session is running alongside the
				conversation with you in the Positron IDE.
				</TextChunk>

				{sessions.map((session) => (
					<Session session={session} />
				))}
			</AssistantMessage>
		);
	}
}

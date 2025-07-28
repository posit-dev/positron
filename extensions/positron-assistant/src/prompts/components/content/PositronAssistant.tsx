/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';
import { DefaultContent } from './DefaultContent.js';
import * as vscode from 'vscode';
import { SessionData } from './Session.js';
import { SessionsContent } from './SessionsContent.js';

export interface AssistantProps extends BasePromptElementProps {
	request: vscode.ChatRequest;
}

export interface AssistantState {
	sessions?: SessionData[];
}

/**
 * The default activation steering and base content for Positron Assistant.
 * This content applies to all participant types and provides the core assistant identity.
 */
export class PositronAssistant extends PromptElement<AssistantProps, AssistantState> {

	render(state: AssistantState) {
		console.log('*** Positron Assistant rendering with request:', JSON.stringify(this.props.request, null, 2));
		const sessionData: SessionData[] = [];
		if (this.props.request.references.length > 0) {
			for (const reference of this.props.request.references) {
				const value = reference.value as any;
				if (value.activeSession) {
					// The user attached a runtime session - usually the active session in the IDE.
					const sessionSummary = JSON.stringify(value.activeSession, null, 2);
					let sessionContent = sessionSummary;
					if (value.variables) {
						// Include the session variables in the session content.
						const variablesSummary = JSON.stringify(value.variables, null, 2);
						sessionContent += '\n' + variablesSummary;
					}
					sessionData.push({
						...value.activeSession,
						variables: value.variables
					});
				}
			}
		}

		return (
			<>
				<DefaultContent />
				{ sessionData.length > 0 && <SessionsContent sessions={sessionData} /> }
			</>
		);
	}
}

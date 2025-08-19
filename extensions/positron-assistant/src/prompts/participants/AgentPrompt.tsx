/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	AssistantMessage,
	BasePromptElementProps,
	PromptElement,
	SystemMessage
} from '@vscode/prompt-tsx';
import { ActivationSteering } from '../components/base/ActivationSteering';
import { LanguageInstructions } from '../components/language/LanguageInstructions';

interface AgentPromptProps extends BasePromptElementProps {
	/**
	 * Active language sessions for context
	 */
	activeSessions?: string[];

	/**
	 * Map of language IDs to their loaded instruction content
	 */
	languageInstructions?: Map<string, string>;
}

/**
 * Main prompt component for the Agent participant.
 * Replaces the manual string concatenation in PositronAssistantAgentParticipant.
 */
export class AgentPrompt extends PromptElement<AgentPromptProps> {
	render() {
		// Agent has similar structure to Chat but with agent-specific activation
		return (
			<>
			<SystemMessage priority={100}>
				<ActivationSteering
					participantType="agent"
					priority={100}
				/>
				<LanguageInstructions
					activeSessions={this.props.activeSessions || []}
					languageInstructions={this.props.languageInstructions}
					priority={80}
				/>
			</SystemMessage>
			</>
		);
	}
}

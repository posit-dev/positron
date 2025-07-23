/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';
import { ActivationSteering } from '../components/base/ActivationSteering';
import { CommunicationGuidelines } from '../components/base/CommunicationGuidelines';

interface TerminalPromptProps extends BasePromptElementProps {
	// Terminal prompts are typically simpler and focused
}

/**
 * Main prompt component for the Terminal participant.
 * Replaces the manual file reading in PositronAssistantTerminalParticipant.
 */
export class TerminalPrompt extends PromptElement<TerminalPromptProps> {
	render() {
		return {
			ctor: 'div',
			props: {},
			children: [
				{
					ctor: ActivationSteering,
					props: {
						participantType: 'terminal' as const,
						priority: 100
					},
					children: []
				},
				{
					ctor: CommunicationGuidelines,
					props: {
						includeTerminalGuidance: true,
						priority: 90
					},
					children: []
				}
			]
		};
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';
import { ActivationSteering } from '../components/base/ActivationSteering';

interface TerminalPromptProps extends BasePromptElementProps {
	// Terminal prompts are typically simpler and focused
}

/**
 * Main prompt component for the Terminal participant.
 * Replaces the manual file reading in PositronAssistantTerminalParticipant.
 */
export class TerminalPrompt extends PromptElement<TerminalPromptProps> {
	render() {
		return (
			<>
				<ActivationSteering
					participantType="terminal"
					priority={100}
				/>
			</>
		);
	}
}

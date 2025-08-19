/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';
import { DefaultContent } from '../content/DefaultContent';
import { AgentContent } from '../content/AgentContent';
import { EditorContent } from '../content/EditorContent';
import { TerminalContent } from '../content/TerminalContent';

interface ActivationSteeringProps extends BasePromptElementProps {
	/**
	 * Type of participant this activation steering is for
	 */
	participantType: 'chat' | 'agent' | 'terminal' | 'editor' | 'edit';
}

/**
 * Component that loads activation steering content based on participant type.
 */
export class ActivationSteering extends PromptElement<ActivationSteeringProps> {
	render() {
		const { participantType } = this.props;
		const basePriority = this.props.priority || 100;

		return (
			<>
				<DefaultContent priority={basePriority} />
				{participantType === 'agent' && (
					<AgentContent priority={basePriority - 1} />
				)}
				{participantType === 'editor' && (
					<EditorContent priority={basePriority - 1} />
				)}
				{participantType === 'terminal' && (
					<TerminalContent priority={basePriority - 1} />
				)}
			</>
		);
	}
}

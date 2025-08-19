/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';
import { ActivationSteering } from '../components/base/ActivationSteering';
import { LanguageInstructions } from '../components/language/LanguageInstructions';
import { FilepathsContent } from '../components/content/FilepathsContent';

interface ChatPromptProps extends BasePromptElementProps {
	/**
	 * Whether to include filepath guidance
	 */
	includeFilepaths?: boolean;

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
 * Main prompt component for the Chat participant.
 * Replaces the manual string concatenation in PositronAssistantChatParticipant.
 */
export class ChatPrompt extends PromptElement<ChatPromptProps> {
	render() {
		return (
			<>
				<ActivationSteering
					participantType="chat"
					priority={100}
				/>
				<LanguageInstructions
					activeSessions={this.props.activeSessions || []}
					languageInstructions={this.props.languageInstructions}
					priority={80}
				/>
				{this.props.includeFilepaths && (
					<FilepathsContent
						priority={75}
					/>
				)}
			</>
		);
	}
}

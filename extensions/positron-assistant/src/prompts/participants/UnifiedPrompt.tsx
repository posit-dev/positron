/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,
	SystemMessage
} from '@vscode/prompt-tsx';
import { ActivationSteering } from '../components/base/ActivationSteering';
import { LanguageInstructions } from '../components/language/LanguageInstructions';
import { FilepathsContent } from '../components/content/FilepathsContent';

export type ParticipantType = 'chat' | 'agent' | 'terminal' | 'editor' | 'edit';

interface UnifiedPromptProps extends BasePromptElementProps {
	/**
	 * The type of participant requesting the prompt
	 */
	participantType: ParticipantType;

	/**
	 * Whether to include filepath guidance (mainly for chat/agent modes)
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

	/**
	 * Whether this is a text editing request (for editor mode)
	 */
	isTextEdit?: boolean;
}

/**
 * Unified prompt component that handles all participant types.
 * This replaces the separate ChatPrompt, AgentPrompt, TerminalPrompt, and EditorPrompt components
 * with a single component that adapts based on the participant type.
 */
export class UnifiedPrompt extends PromptElement<UnifiedPromptProps> {
	render() {
		const { participantType } = this.props;

		return (
			<SystemMessage priority={100}>
				<ActivationSteering
					participantType={participantType}
					priority={100}
				/>
				{this.shouldIncludeLanguageInstructions() && (
					<LanguageInstructions
						activeSessions={this.props.activeSessions || []}
						languageInstructions={this.props.languageInstructions}
						priority={80}
					/>
				)}
				{this.shouldIncludeFilepaths() && (
					<FilepathsContent
						priority={75}
					/>
				)}
			</SystemMessage>
		);
	}

	private shouldIncludeCodeGeneration(): boolean {
		// All participants except terminal typically deal with code
		return this.props.participantType !== 'terminal';
	}

	private shouldIncludeTerminalGuidance(): boolean {
		// Terminal and agent participants need terminal guidance
		return this.props.participantType === 'terminal' || this.props.participantType === 'agent';
	}

	private shouldIncludeLanguageInstructions(): boolean {
		// Chat and agent participants have language sessions
		return (this.props.participantType === 'chat' || this.props.participantType === 'agent' || this.props.participantType === 'edit') &&
			(this.props.activeSessions?.length ?? 0) > 0;
	}

	private shouldIncludeFilepaths(): boolean {
		// Include filepaths when explicitly requested (mainly for chat/agent/edit modes)
		return this.props.includeFilepaths === true;
	}
}

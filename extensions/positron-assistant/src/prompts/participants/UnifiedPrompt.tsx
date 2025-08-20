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

	/**
	 * File extension for language-specific guidance (for editor mode)
	 */
	fileExtension?: string;
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
				{this.shouldIncludeFileExtensionGuidance() && (
					<FileExtensionGuidance
						extension={this.props.fileExtension!}
						priority={85}
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

	private shouldIncludeFileExtensionGuidance(): boolean {
		// Only for editor participant with a file extension
		return this.props.participantType === 'editor' && !!this.props.fileExtension;
	}
}

/**
 * Component that provides file extension-specific guidance
 */
class FileExtensionGuidance extends PromptElement<{ extension: string } & BasePromptElementProps> {
	render() {
		const guidance = this.getExtensionGuidance(this.props.extension);
		return <>{guidance}</>;
	}

	private getExtensionGuidance(extension: string): string {
		switch (extension.toLowerCase()) {
			case 'py':
				return 'You are working with Python code. Follow PEP 8 style guidelines and use appropriate Python idioms.';
			case 'r':
				return 'You are working with R code. Use tidyverse conventions where appropriate and follow R style guidelines.';
			case 'js':
			case 'ts':
				return 'You are working with JavaScript/TypeScript. Follow modern ES6+ conventions and use appropriate TypeScript types when applicable.';
			case 'sql':
				return 'You are working with SQL. Use appropriate formatting and follow SQL best practices.';
			case 'md':
				return 'You are working with Markdown. Use proper Markdown syntax and formatting.';
			case 'json':
				return 'You are working with JSON. Ensure proper JSON syntax and formatting.';
			case 'yaml':
			case 'yml':
				return 'You are working with YAML. Use proper indentation and YAML syntax.';
			default:
				return `You are working with ${extension} files. Use appropriate syntax and conventions for this file type.`;
		}
	}
}

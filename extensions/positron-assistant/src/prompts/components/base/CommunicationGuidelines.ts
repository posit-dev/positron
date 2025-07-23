/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';
import {
	SystemMessage,
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';

interface CommunicationGuidelinesProps extends BasePromptElementProps {
	// Allow customization for specific use cases
	includeCodeGeneration?: boolean;
	includeTerminalGuidance?: boolean;
}

/**
 * Component that provides communication guidelines and response formatting instructions.
 * Replaces manual markdown file concatenation for communication guidelines.
 */
export class CommunicationGuidelines extends PromptElement<CommunicationGuidelinesProps> {
	private static readonly MARKDOWN_DIR = path.join(__dirname, '../../../md/prompts/chat');

	render() {
		return {
			ctor: SystemMessage,
			props: { priority: this.props.priority || 90 },
			children: [this.buildGuidelines()]
		};
	}

	private buildGuidelines(): string {
		const guidelines = [
			'## Communication Guidelines',
			'- Keep your answers short and impersonal.',
			'- Follow the user\'s requirements carefully & to the letter.',
			'- Be helpful and accurate in your responses.',
			'- Use appropriate Markdown formatting when needed.'
		];

		if (this.props.includeCodeGeneration) {
			guidelines.push(
				'- When generating code, ensure it\'s complete and functional.',
				'- Use appropriate syntax highlighting in code blocks.',
				'- Explain complex code sections when helpful.'
			);
		}

		if (this.props.includeTerminalGuidance) {
			guidelines.push(
				'- For terminal commands, provide clear explanations.',
				'- Consider platform-specific differences when relevant.',
				'- Warn about potentially destructive operations.'
			);
		}

		return guidelines.join('\n');
	}
}

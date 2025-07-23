/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	SystemMessage,
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';

interface LanguageInstructionsProps extends BasePromptElementProps {
	/**
	 * List of active language sessions
	 */
	activeSessions: string[];
	/**
	 * Map of language IDs to their loaded instruction content
	 */
	languageInstructions?: Map<string, string>;
}

/**
 * Component that provides language-specific instructions based on active sessions.
 * Replaces the getActiveSessionInstructions logic in participants.
 */
export class LanguageInstructions extends PromptElement<LanguageInstructionsProps> {
	render() {
		const instructions = this.buildLanguageInstructions();

		return {
			ctor: SystemMessage,
			props: { priority: this.props.priority || 80 },
			children: [instructions]
		};
	}

	private buildLanguageInstructions(): string {
		const { activeSessions, languageInstructions } = this.props;

		if (!activeSessions.length) {
			return '## Language Context\nNo active language sessions detected.';
		}

		const instructions: string[] = [];

		for (const languageId of activeSessions) {
			// Try to use loaded instructions first
			if (languageInstructions?.has(languageId)) {
				const languageContent = languageInstructions.get(languageId)!;
				instructions.push(languageContent);
			} else {
				// Fall back to basic context if no loaded instructions
				instructions.push(this.buildBasicLanguageContext(languageId));
			}
		}

		return instructions.join('\n\n');
	}

	private buildBasicLanguageContext(language: string): string {
		switch (language.toLowerCase()) {
			case 'python':
				return [
					'### Python Context',
					'- Use Python best practices and idiomatic code',
					'- Consider common libraries like pandas, numpy, matplotlib',
					'- Be aware of Python version differences when relevant'
				].join('\n');
			case 'r':
				return [
					'### R Context',
					'- Use R conventions and vectorized operations',
					'- Consider tidyverse and base R approaches',
					'- Be mindful of data frame vs tibble distinctions'
				].join('\n');
			case 'javascript':
			case 'typescript':
				return [
					'### JavaScript/TypeScript Context',
					'- Use modern ES6+ features',
					'- Consider async/await patterns',
					'- Be mindful of browser vs Node.js environments'
				].join('\n');
			default:
				return [
					`### ${language} Context`,
					`- Working with ${language} code`
				].join('\n');
		}
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement
} from '@vscode/prompt-tsx';
import { ActivationSteering } from '../components/base/ActivationSteering';

interface EditorPromptProps extends BasePromptElementProps {
	/**
	 * Whether this is a text editing request
	 */
	isTextEdit?: boolean;

	/**
	 * File extension for language-specific guidance
	 */
	fileExtension?: string;
}

/**
 * Main prompt component for the Editor participant.
 * Handles both inline chat and editing scenarios.
 */
export class EditorPrompt extends PromptElement<EditorPromptProps> {
	render() {
		return (
			<>
				<ActivationSteering
					participantType="editor"
					priority={100}
				/>
				{this.props.fileExtension && (
					<FileExtensionGuidance
						extension={this.props.fileExtension}
						priority={85}
					/>
				)}
			</>
		);
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
		const ext = extension.toLowerCase();

		switch (ext) {
			case 'py':
				return '## Python Context\n- Follow PEP 8 style guidelines\n- Use meaningful variable names\n- Consider type hints when appropriate';
			case 'r':
				return '## R Context\n- Use tidyverse conventions where appropriate\n- Consider vectorized operations\n- Use clear variable names';
			case 'js':
			case 'ts':
				return '## JavaScript/TypeScript Context\n- Use modern ES6+ features\n- Follow consistent naming conventions\n- Consider async/await for promises';
			case 'md':
				return '## Markdown Context\n- Use proper heading hierarchy\n- Format code blocks with language identifiers\n- Use consistent list formatting';
			default:
				return `## ${extension.toUpperCase()} Context\n- Follow language-specific best practices\n- Maintain consistent code style`;
		}
	}
}

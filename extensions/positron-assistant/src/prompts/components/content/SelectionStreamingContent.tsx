/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,

	SystemMessage
} from '@vscode/prompt-tsx';

export interface SelectionStreamingContentProps extends BasePromptElementProps {
}

/**
 * Selection streaming content for handling streaming selection edits in the Positron Assistant.
 */
export class SelectionStreamingContent extends PromptElement<SelectionStreamingContentProps> {
	render() {
		return (
			<SystemMessage priority={this.props.priority || 90}>
				{`The user has invoked you from the text editor.

You may respond in one of three ways:

1. A BRIEF answer to the user's question.
2. Return ONLY a single \`<replaceSelection>\` tag as defined below -- no explanation.
3. If you don't know how to answer the user's question, return an empty string.

<replaceSelection>The new text to insert in place of the selection.</replaceSelection>

Unless otherwise directed, focus on the selected text in the \`editor\` context.`}
			</SystemMessage>
		);
	}
}

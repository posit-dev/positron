/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,

	SystemMessage
} from '@vscode/prompt-tsx';

export interface SelectionContentProps extends BasePromptElementProps {
}

/**
 * Selection content for handling selection-based interactions in the Positron Assistant.
 */
export class SelectionContent extends PromptElement<SelectionContentProps> {
	render() {
		return (
			<SystemMessage priority={this.props.priority || 90}>
				The user has invoked you from the text editor.

				When you have finished responding, you can choose to output a
				revised version of the selection provided by the user if
				required.

				Never mention the name of the function, just use it.

				If there is selected text, assume the user has a question about
				it or wants to replace it with something else.

				Use the line and column provided to provide the user with
				response appropriate to the current cursor location, but don't
				mention the line and column numbers in your response unless
				needed for clarification.
			</SystemMessage>
		);
	}
}

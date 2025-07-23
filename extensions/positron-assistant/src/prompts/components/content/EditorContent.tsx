/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,
	SystemMessage
} from '@vscode/prompt-tsx';

export interface EditorContentProps extends BasePromptElementProps {
}

/**
 * Editor-specific content for the Positron Assistant editor participant.
 * This provides instructions for handling editor-based interactions.
 */
export class EditorContent extends PromptElement<EditorContentProps> {
	render() {
		return (
			<SystemMessage priority={this.props.priority || 90}>
				The user has invoked you from the text editor. They want to
				change something in the provided document. Your goal is to
				generate a set of edits to the document that represent the
				requested change.

				Use the line and column provided to provide the user with a
				response appropriate to the current cursor location. Unless
				otherwise directed, focus on the text near and below the cursor.

				When you are done, use the provided tool to apply your edits.
			</SystemMessage>
		);
	}
}

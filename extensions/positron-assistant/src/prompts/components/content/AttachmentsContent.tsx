/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,
	SystemMessage
} from '@vscode/prompt-tsx';

export interface AttachmentsContentProps extends BasePromptElementProps {
}

/**
 * Instructions for handling attachments in the Positron Assistant.
 * This provides context about attached files or references.
 */
export class AttachmentsContent extends PromptElement<AttachmentsContentProps> {
	render() {
		return (
			<SystemMessage priority={this.props.priority || 85}>
				The user has attached file references below.

				If the provided context is not useful or doesn't make sense with
				the user's question, just ignore the provided context.
			</SystemMessage>
		);
	}
}

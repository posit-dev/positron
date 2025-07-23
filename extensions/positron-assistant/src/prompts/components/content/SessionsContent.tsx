/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,

	SystemMessage
} from '@vscode/prompt-tsx';

export interface SessionsContentProps extends BasePromptElementProps {
}

/**
 * Instructions for handling session information in the Positron Assistant.
 */
export class SessionsContent extends PromptElement<SessionsContentProps> {
	render() {
		return (
			<SystemMessage priority={this.props.priority || 85}>
				The user has attached information about their interactive
				interpreter session below. This session is running alongside the
				conversation with you in the Positron IDE.
			</SystemMessage>
		);
	}
}

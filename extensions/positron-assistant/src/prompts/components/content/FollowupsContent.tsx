/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	BasePromptElementProps,
	PromptElement,

	SystemMessage
} from '@vscode/prompt-tsx';

export interface FollowupsContentProps extends BasePromptElementProps {
}

/**
 * Instructions for generating follow-up suggestions in the Positron Assistant.
 */
export class FollowupsContent extends PromptElement<FollowupsContentProps> {
	render() {
		return (
			<SystemMessage priority={this.props.priority || 85}>
				Based on what I have asked so far, suggest 2-3 follow-up steps,
				keeping them to a maximum length of one sentence. If I haven't
				asked anything, or there aren't any obvious next steps, don't
				provide any suggestions.

				You MUST return only JSON in the output, and nothing else. If
				present, format the suggestions as an array of strings. If not
				present, return an empty array.
			</SystemMessage>
		);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	SystemMessage as BaseSystemMessage,
	BasePromptElementProps,
	PromptElement,
	PromptPiece
} from '@vscode/prompt-tsx';

export interface SystemMessageProps extends BasePromptElementProps {
	/**
	 * The content of the system message.
	 */
	children?: any;
}

/**
 * A system message component that wraps content in appropriate system context.
 * This is the foundation for all assistant prompts.
 */
export class SystemMessage extends PromptElement<SystemMessageProps> {
	render(): PromptPiece {
		return (
			<BaseSystemMessage priority={this.props.priority}>
				{this.props.children || ''}
			</BaseSystemMessage>
		);
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';

import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { VerticalStack } from '../../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';
import Claude from '../icons/claude.js';
import Gemini from '../icons/gemini.js';
import GithubCopilot from '../icons/githubCopilot.js';
import Bedrock from '../icons/bedrockColor.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

interface LanguageModelButtonProps {
	identifier: string;
	displayName: string;
	selected?: boolean;
	onClick?: () => void;
}

/**
 * LanguageModelButton component.
 */
export const LanguageModelButton = (props: LanguageModelButtonProps) => {

	function getIcon() {
		switch (props.identifier) {
			case 'anthropic':
				return <Claude className='language-model icon' />;
			case 'google':
				return <Gemini className='language-model icon' />;
			case 'copilot':
				return <GithubCopilot className='language-model icon' />;
			case 'bedrock':
				return <Bedrock className='language-model icon' />;
			case 'error':
				return <div className={`language-model icon button-icon codicon codicon-error`} />;
			case 'echo':
				return <div className={`language-model icon button-icon codicon codicon-info`} />;
			default:
				return null;
		}
	}

	// Render.
	return (
		<Button
			className={positronClassNames(
				'language-model',
				'button',
				{ 'selected': props.selected }
			)}
			onPressed={props.onClick}>
			<div id={`${props.identifier}-provider-button`}>
				<VerticalStack>
					{getIcon()}
					{props.displayName}
				</VerticalStack>
			</div>
		</Button>
	);
};

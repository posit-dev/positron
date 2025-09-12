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
	disabled?: boolean;
	onClick?: () => void;
}

/**
 * LanguageModelButton component.
 */
export const LanguageModelButton = (props: LanguageModelButtonProps) => {
	return (
		<Button
			className={positronClassNames(
				'language-model',
				'button',
				{ 'selected': props.selected }
			)}
			disabled={props.disabled}
			onPressed={props.onClick}>
			<div id={`${props.identifier}-provider-button`}>
				<VerticalStack>
					<LanguageModelIcon provider={props.identifier} />
					{props.displayName}
				</VerticalStack>
			</div>
		</Button>
	);
};

export const LanguageModelIcon = (props: { provider: string }) => {
	function getIcon() {
		switch (props.provider) {
			case 'anthropic-api':
				return <Claude className='language-model icon' />;
			case 'google':
				return <Gemini className='language-model icon' />;
			case 'copilot':
				return <GithubCopilot className='language-model icon' />;
			case 'amazon-bedrock': // Vercel API uses this as an id
			case 'bedrock':
				return <Bedrock className='language-model icon' />;
			case 'error':
				return <div className={`language-model icon button-icon codicon codicon-error`} />;
			case 'echo':
			case 'test':
				return <div className={`language-model icon button-icon codicon codicon-info`} />;
			default:
				return null;
		}
	}
	return getIcon();
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

import { localize } from '../../../../../nls.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { VerticalStack } from '../../../../browser/positronComponents/positronModalDialog/components/verticalStack.js';
import Claude from '../icons/claude.js';
import Databricks from '../icons/databricks.js';
import DeepSeek from '../icons/deepseek.js';
import Gemini from '../icons/gemini.js';
import GithubCopilot from '../icons/githubCopilot.js';
import Bedrock from '../icons/bedrockColor.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import OpenAI from '../icons/openai.js';
import PositAi from '../icons/positAi.js';
import Snowflake from '../icons/snowflake.js';
import MicrosoftFoundry from '../icons/microsoftFoundry.js';
import Geap from '../icons/geap.js';

interface LanguageModelButtonProps {
	identifier: string;
	displayName: string;
	logoUrl?: string;
	selected?: boolean;
	disabled?: boolean;
	status?: 'preview' | 'experimental';
	onClick?: () => void;
}

/** Human-readable label for a provider's maturity status, or undefined for stable providers. */
function getStatusLabel(status: LanguageModelButtonProps['status']): string | undefined {
	switch (status) {
		case 'preview':
			return localize('positron.languageModelButton.status.preview', "Preview");
		case 'experimental':
			return localize('positron.languageModelButton.status.experimental', "Experimental");
		default:
			return undefined;
	}
}

/**
 * LanguageModelButton component.
 */
export const LanguageModelButton = React.forwardRef<HTMLDivElement, LanguageModelButtonProps>((props, ref) => {
	const statusLabel = getStatusLabel(props.status);
	return (
		<Button
			className={positronClassNames(
				'language-model',
				'button',
				{ 'selected': props.selected }
			)}
			disabled={props.disabled}
			onPressed={props.onClick}>
			<div ref={ref} id={`${props.identifier}-provider-button`}>
				<VerticalStack>
					<LanguageModelIcon logoUrl={props.logoUrl} provider={props.identifier} />
					{props.displayName}
					{statusLabel && <span className='language-model button-status'>{statusLabel}</span>}
				</VerticalStack>
			</div>
		</Button>
	);
});

export const LanguageModelIcon = (props: { provider: string; logoUrl?: string }) => {
	function getIcon() {
		if (props.logoUrl) {
			return <img className='language-model icon' src={props.logoUrl} />;
		}
		switch (props.provider) {
			case 'anthropic-api':
				return <Claude className='language-model icon' />;
			case 'google':
				return <Gemini className='language-model icon' />;
			case 'google-cloud':
				return <Geap className='language-model icon' />;
			case 'copilot':
			case 'copilot-auth':
				return <GithubCopilot className='language-model icon' />;
			case 'amazon-bedrock': // Vercel API uses this as an id
				return <Bedrock className='language-model icon' />;
			case 'deepseek-api':
				return <DeepSeek className='language-model icon' />;
			case 'openai-api':
				return <OpenAI className='language-model icon' />;
			case 'ms-foundry':
				return <MicrosoftFoundry className='language-model icon' />;
			case 'posit-ai':
				return <PositAi className='language-model icon' />;
			case 'snowflake-cortex':
				return <Snowflake className='language-model icon' />;
			case 'databricks':
				return <Databricks className='language-model icon' />;
			case 'openai-compatible':
				return <div className={`language-model icon button-icon codicon codicon-wrench`} />;
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
};

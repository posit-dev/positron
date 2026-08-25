/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './languageModelButton.css';

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
export function getStatusLabel(status: LanguageModelButtonProps['status']): string | undefined {
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

export const LanguageModelIcon = (props: { provider: string; logoUrl?: string; monochrome?: boolean }) => {
	// When `monochrome`, recolor the icon to the theme's icon foreground so it stays
	// legible on every theme (see #15321). Only the new provider modal opts in;
	// the legacy dialog renders icons in their original brand colors.
	const iconClassName = positronClassNames('language-model icon', { monochrome: props.monochrome });
	function getIcon() {
		if (props.logoUrl) {
			// A plain <img> can't be recolored, so when monochrome we paint the theme
			// color and clip it to the logo shape with a CSS mask. Otherwise the
			// logo renders as-is.
			return props.monochrome
				? <div className={iconClassName} data-testid='language-model-icon'
					style={{
						flex: 'none',
						backgroundColor: 'var(--vscode-icon-foreground)',
						WebkitMaskImage: `url(${props.logoUrl})`,
						maskImage: `url(${props.logoUrl})`,
						WebkitMaskSize: 'contain',
						maskSize: 'contain',
						WebkitMaskRepeat: 'no-repeat',
						maskRepeat: 'no-repeat',
						WebkitMaskPosition: 'center',
						maskPosition: 'center',
					}}
				/>
				: <img className={iconClassName} data-testid='language-model-icon' src={props.logoUrl} />;
		}
		switch (props.provider) {
			case 'anthropic-api':
				return <Claude className={iconClassName} data-testid='language-model-icon' />;
			case 'google':
				return <Gemini className={iconClassName} data-testid='language-model-icon' />;
			case 'google-cloud':
				return <Geap className={iconClassName} data-testid='language-model-icon' />;
			case 'copilot':
			case 'copilot-auth':
				return <GithubCopilot className={iconClassName} data-testid='language-model-icon' />;
			case 'amazon-bedrock': // Vercel API uses this as an id
				return <Bedrock className={iconClassName} data-testid='language-model-icon' />;
			case 'deepseek-api':
				return <DeepSeek className={iconClassName} data-testid='language-model-icon' />;
			case 'openai-api':
				return <OpenAI className={iconClassName} data-testid='language-model-icon' />;
			case 'ms-foundry':
				return <MicrosoftFoundry className={iconClassName} data-testid='language-model-icon' />;
			case 'posit-ai':
				return <PositAi className={iconClassName} data-testid='language-model-icon' />;
			case 'snowflake-cortex':
				return <Snowflake className={iconClassName} data-testid='language-model-icon' />;
			case 'databricks':
				return <Databricks className={iconClassName} data-testid='language-model-icon' />;
			case 'openai-compatible':
				return <div className={`language-model icon button-icon codicon codicon-wrench`} data-testid='language-model-icon' />;
			case 'error':
				return <div className={`language-model icon button-icon codicon codicon-error`} data-testid='language-model-icon' />;
			case 'echo':
			case 'test':
				return <div className={`language-model icon button-icon codicon codicon-info`} data-testid='language-model-icon' />;
			default:
				return null;
		}
	}
	return getIcon();
};

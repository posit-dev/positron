/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './FindWidget.css';

// React.
import React from 'react';

// Other dependencies.
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { PositronFindInput } from './PositronFindInput.js';
import { Toggle } from '../../../../../../base/browser/ui/toggle/toggle.js';

export interface FindWidgetProps {
	readonly findText?: string;
	readonly matchCase?: boolean;
	readonly matchWholeWord?: boolean;
	readonly useRegex?: boolean;
	readonly focusInput?: boolean;
	readonly matchIndex?: number;
	readonly matchCount?: number;
	readonly additionalToggles?: Toggle[];
	readonly onFindTextChange: (value: string) => void;
	readonly onMatchCaseChange: (value: boolean) => void;
	readonly onMatchWholeWordChange: (value: boolean) => void;
	readonly onUseRegexChange: (value: boolean) => void;
	readonly onPreviousMatch: () => void;
	readonly onNextMatch: () => void;
	readonly onClose: () => void;
}

export const FindWidget = ({
	findText,
	matchCase = false,
	matchWholeWord = false,
	useRegex = false,
	focusInput = true,
	matchIndex,
	matchCount,
	additionalToggles,
	onFindTextChange,
	onMatchCaseChange,
	onMatchWholeWordChange,
	onUseRegexChange,
	onPreviousMatch,
	onNextMatch,
	onClose,
}: FindWidgetProps) => {
	return (
		<div className='positron-find-widget-positioned'>
			<div className='positron-find-widget'>
				<div className='find-widget-row'>
					<div className='find-input-container'>
						<PositronFindInput
							additionalToggles={additionalToggles}
							focusInput={focusInput}
							matchCase={matchCase}
							matchWholeWord={matchWholeWord}
							useRegex={useRegex}
							value={findText}
							onMatchCaseChange={onMatchCaseChange}
							onMatchWholeWordChange={onMatchWholeWordChange}
							onUseRegexChange={onUseRegexChange}
							onValueChange={onFindTextChange}
						/>
					</div>
					<div className={`find-results ${findText && matchCount === 0 ? 'no-results' : ''}`}>
						{findText && matchCount !== undefined ? (
							matchCount === 0 ? 'No results' : `${matchIndex ?? 1} of ${matchCount}`
						) : ''}
					</div>
					<div className='find-navigation-buttons'>
						<ActionButton
							ariaLabel='Previous Match'
							className='find-action-button'
							onPressed={() => onPreviousMatch()}
						>
							<div className='codicon codicon-arrow-up' />
						</ActionButton>
						<ActionButton
							ariaLabel='Next Match'
							className='find-action-button'
							onPressed={() => onNextMatch()}
						>
							<div className='codicon codicon-arrow-down' />
						</ActionButton>
					</div>
					<ActionButton
						ariaLabel='Close'
						className='find-action-button find-close-button'
						onPressed={() => onClose()}
					>
						<div className='codicon codicon-close' />
					</ActionButton>
				</div>
			</div>
		</div>
	);
}

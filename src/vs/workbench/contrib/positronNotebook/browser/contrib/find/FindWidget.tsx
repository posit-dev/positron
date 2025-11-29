/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './FindWidget.css';

// React.
import React, { useEffect, useRef } from 'react';

// Other dependencies.
import { ActionButton } from '../../utilityComponents/ActionButton.js';

export interface FindWidgetProps {
	readonly findText?: string;
	readonly matchCase?: boolean;
	readonly matchWholeWord?: boolean;
	readonly useRegex?: boolean;
	readonly focusInput?: boolean;
	readonly matchIndex?: number;
	readonly matchCount?: number;
	readonly onFindTextChange: (value: string) => void;
	readonly onMatchCaseChange: (value: boolean) => void;
	readonly onMatchWholeWordChange: (value: boolean) => void;
	readonly onUseRegexChange: (value: boolean) => void;
	readonly onPreviousMatch: () => void;
	readonly onNextMatch: () => void;
	readonly onFindInSelection: () => void;
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
	onFindTextChange,
	onMatchCaseChange,
	onMatchWholeWordChange,
	onUseRegexChange,
	onPreviousMatch,
	onNextMatch,
	onFindInSelection,
	onClose,
}: FindWidgetProps) => {
	const inputRef = useRef<HTMLInputElement>(null);

	// Focus input when requested
	useEffect(() => {
		if (focusInput) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [focusInput]);

	return (
		<div className='positron-find-widget-positioned'>
			<div className='positron-find-widget'>
				<div className='find-widget-row'>
					<div className='find-input-container'>
						<input
							ref={inputRef}
							className='find-input'
							placeholder='Find'
							type='text'
							value={findText}
							onChange={(e) => onFindTextChange(e.target.value)}
							onKeyDown={(e) => {
								// Don't consume Escape or keyboard shortcuts with modifiers
								if (e.key === 'Escape' || e.metaKey || e.ctrlKey) {
									return;
								}
								e.stopPropagation();
							}}
						/>
						<div className='find-input-buttons'>
							<ActionButton
								ariaLabel='Match Case'
								className={`find-action-button ${matchCase ? 'active' : ''}`}
								onPressed={() => onMatchCaseChange(!matchCase)}
							>
								<div className='codicon codicon-case-sensitive' />
							</ActionButton>
							<ActionButton
								ariaLabel='Match Whole Word'
								className={`find-action-button ${matchWholeWord ? 'active' : ''}`}
								onPressed={() => onMatchWholeWordChange(!matchWholeWord)}
							>
								<div className='codicon codicon-whole-word' />
							</ActionButton>
							<ActionButton
								ariaLabel='Use Regular Expression'
								className={`find-action-button ${useRegex ? 'active' : ''}`}
								onPressed={() => onUseRegexChange(!useRegex)}
							>
								<div className='codicon codicon-regex' />
							</ActionButton>
							<ActionButton
								ariaLabel='Find in Selection'
								className='find-action-button'
								onPressed={() => onFindInSelection()}
							>
								<div className='codicon codicon-selection' />
							</ActionButton>
						</div>
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

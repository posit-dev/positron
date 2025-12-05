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
import { ISettableObservable } from '../../../../../../base/common/observable.js';
import { useObservedValue } from '../../useObservedValue.js';

export interface PositronFindWidgetProps {
	readonly findText: ISettableObservable<string>;
	readonly matchCase: ISettableObservable<boolean>;
	readonly matchWholeWord: ISettableObservable<boolean>;
	readonly useRegex: ISettableObservable<boolean>;
	readonly focusInput?: boolean;
	readonly matchIndex?: number;
	readonly matchCount?: number;
	readonly additionalToggles?: Toggle[];
	readonly onPreviousMatch: () => void;
	readonly onNextMatch: () => void;
	readonly onClose: () => void;
}

export const PositronFindWidget = ({
	findText: findTextObs,
	matchCase: matchCaseObs,
	matchWholeWord: matchWholeWordObs,
	useRegex: useRegexObs,
	focusInput = true,
	matchIndex,
	matchCount,
	additionalToggles,
	onPreviousMatch,
	onNextMatch,
	onClose,
}: PositronFindWidgetProps) => {
	const findText = useObservedValue(findTextObs);
	const matchCase = useObservedValue(matchCaseObs);
	const matchWholeWord = useObservedValue(matchWholeWordObs);
	const useRegex = useObservedValue(useRegexObs);

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
							onMatchCaseChange={(value) => matchCaseObs.set(value, undefined)}
							onMatchWholeWordChange={(value) => matchWholeWordObs.set(value, undefined)}
							onUseRegexChange={(value) => useRegexObs.set(value, undefined)}
							onValueChange={(value) => findTextObs.set(value, undefined)}
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

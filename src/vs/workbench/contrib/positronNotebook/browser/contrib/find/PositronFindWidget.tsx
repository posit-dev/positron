/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './PositronFindWidget.css';

// React.
import React from 'react';

// Other dependencies.
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { PositronFindInput } from './PositronFindInput.js';
import { IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';
import { IObservable, ISettableObservable } from '../../../../../../base/common/observable.js';
import { useObservedValue } from '../../useObservedValue.js';
import { ThemeIcon } from '../../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { localize } from '../../../../../../nls.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';

// Localized strings
const previousMatchLabel = localize('positronNotebook.find.previousMatch', "Previous Match");
const nextMatchLabel = localize('positronNotebook.find.nextMatch', "Next Match");
const closeLabel = localize('positronNotebook.find.close', "Close");
const noResultsLabel = localize('positronNotebook.find.noResults', "No results");
const matchCountLabel = (matchIndex: number, matchCount: number) =>
	localize('positronNotebook.find.matchCount', "{0} of {1}", matchIndex, matchCount);

export interface PositronFindWidgetProps {
	readonly findText: ISettableObservable<string>;
	readonly contextKeyService: IContextKeyService;
	readonly contextViewService: IContextViewService;
	readonly matchCase: ISettableObservable<boolean>;
	readonly matchWholeWord: ISettableObservable<boolean>;
	readonly useRegex: ISettableObservable<boolean>;
	readonly matchIndex: IObservable<number | undefined>;
	readonly matchCount: IObservable<number | undefined>;
	readonly findInputOptions: IFindInputOptions;
	readonly isVisible: ISettableObservable<boolean>;
	readonly inputFocused: ISettableObservable<boolean>;
	readonly onPreviousMatch: () => void;
	readonly onNextMatch: () => void;
}

export const PositronFindWidget = ({
	findText,
	contextKeyService,
	contextViewService,
	matchCase,
	matchWholeWord,
	useRegex,
	matchIndex,
	matchCount,
	isVisible,
	inputFocused,
	findInputOptions,
	onPreviousMatch,
	onNextMatch,
}: PositronFindWidgetProps) => {
	const _findText = useObservedValue(findText);
	const _matchCase = useObservedValue(matchCase);
	const _matchWholeWord = useObservedValue(matchWholeWord);
	const _useRegex = useObservedValue(useRegex);
	const _matchIndex = useObservedValue(matchIndex);
	const _matchCount = useObservedValue(matchCount);
	const _isVisible = useObservedValue(isVisible);
	const _inputFocused = useObservedValue(inputFocused);

	const noMatches = !_matchCount;
	const hasNoResults = _findText && _matchCount === 0;

	return (
		<div className={`positron-find-widget${_isVisible ? ' visible' : ''}${hasNoResults ? ' no-results' : ''}`}>
			<PositronFindInput
				contextKeyService={contextKeyService}
				contextViewService={contextViewService}
				findInputOptions={findInputOptions}
				focus={_inputFocused}
				matchCase={_matchCase}
				matchWholeWord={_matchWholeWord}
				useRegex={_useRegex}
				value={_findText}
				onInputBlur={() => inputFocused.set(false, undefined)}
				onInputFocus={() => inputFocused.set(true, undefined)}
				onMatchCaseChange={(value) => matchCase.set(value, undefined)}
				onMatchWholeWordChange={(value) => matchWholeWord.set(value, undefined)}
				onUseRegexChange={(value) => useRegex.set(value, undefined)}
				onValueChange={(value) => findText.set(value, undefined)}
			/>
			<FindResult
				findText={_findText}
				matchCount={_matchCount}
				matchIndex={_matchIndex}
			/>
			<div className='navigation-buttons'>
				<ActionButton
					ariaLabel={previousMatchLabel}
					className='action-button'
					disabled={noMatches}
					onPressed={() => onPreviousMatch()}
				>
					<ThemeIcon icon={Codicon.arrowUp} />
				</ActionButton>
				<ActionButton
					ariaLabel={nextMatchLabel}
					className='action-button'
					disabled={noMatches}
					onPressed={() => onNextMatch()}
				>
					<ThemeIcon icon={Codicon.arrowDown} />
				</ActionButton>
			</div>
			<ActionButton
				ariaLabel={closeLabel}
				className='action-button close-button'
				onPressed={() => isVisible.set(false, undefined)}
			>
				<div className='codicon codicon-close' />
			</ActionButton>
		</div>
	);
};

interface FindResultProps {
	findText: string;
	matchIndex?: number;
	matchCount?: number;
}

const FindResult = ({ findText, matchIndex, matchCount }: FindResultProps) => {
	// Case 1: No find text - show "No results" in ordinary color
	if (!findText) {
		return <div className='results'>{noResultsLabel}</div>;
	}

	// Case 2: Find text but matchCount not yet calculated
	if (matchCount === undefined) {
		return <div className='results'></div>;
	}

	// Case 3: Find text but no matches found - color handled by widget.no-results class
	if (matchCount === 0) {
		return <div className='results'>{noResultsLabel}</div>;
	}

	// Case 4: Matches found - show count
	return <div className='results'>{matchCountLabel((matchIndex ?? 0) + 1, matchCount)}</div>;
};

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
import { IObservable, ISettableObservable, transaction } from '../../../../../../base/common/observable.js';
import { useObservedValue } from '../../useObservedValue.js';
import { ThemeIcon } from '../../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { localize } from '../../../../../../nls.js';

// Localized strings
const previousMatchLabel = localize('positronNotebook.find.previousMatch', "Previous Match");
const nextMatchLabel = localize('positronNotebook.find.nextMatch', "Next Match");
const closeLabel = localize('positronNotebook.find.close', "Close");
const noResultsLabel = localize('positronNotebook.find.noResults', "No results");
const matchCountLabel = (matchIndex: number, matchCount: number) =>
	localize('positronNotebook.find.matchCount', "{0} of {1}", matchIndex, matchCount);

export interface PositronFindWidgetProps {
	readonly findText: ISettableObservable<string>;
	readonly matchCase: ISettableObservable<boolean>;
	readonly matchWholeWord: ISettableObservable<boolean>;
	readonly useRegex: ISettableObservable<boolean>;
	readonly focusInput?: boolean;
	readonly matchIndex: IObservable<number | undefined>;
	readonly matchCount: IObservable<number | undefined>;
	readonly findInputOptions: IFindInputOptions;
	readonly isVisible: ISettableObservable<boolean>;
	readonly inputFocused: ISettableObservable<boolean>;
	readonly onPreviousMatch: () => void;
	readonly onNextMatch: () => void;
}

export const PositronFindWidget = ({
	findText: findTextObs,
	matchCase: matchCaseObs,
	matchWholeWord: matchWholeWordObs,
	useRegex: useRegexObs,
	focusInput = true,
	matchIndex: matchIndexObs,
	matchCount: matchCountObs,
	isVisible: isVisibleObs,
	inputFocused,
	findInputOptions,
	onPreviousMatch,
	onNextMatch,
}: PositronFindWidgetProps) => {
	const findText = useObservedValue(findTextObs);
	const matchCase = useObservedValue(matchCaseObs);
	const matchWholeWord = useObservedValue(matchWholeWordObs);
	const useRegex = useObservedValue(useRegexObs);
	const matchIndex = useObservedValue(matchIndexObs);
	const matchCount = useObservedValue(matchCountObs);
	const isVisible = useObservedValue(isVisibleObs);

	const noMatches = !matchCount;
	const hasNoResults = findText && matchCount === 0;

	return (
		<div className={`positron-find-widget${isVisible ? ' visible' : ''}${hasNoResults ? ' no-results' : ''}`}>
			<div className='row'>
				<PositronFindInput
					findInputOptions={findInputOptions}
					focusInput={focusInput}
					matchCase={matchCase}
					matchWholeWord={matchWholeWord}
					useRegex={useRegex}
					value={findText}
					onInputBlur={() => inputFocused.set(false, undefined)}
					onInputFocus={() => inputFocused.set(true, undefined)}
					onKeyDown={(e) => {
						if (e.equals(KeyCode.Enter)) {
							onNextMatch();
							e.preventDefault();
							return;
						} else if (e.equals(KeyMod.Shift | KeyCode.Enter)) {
							onPreviousMatch();
							e.preventDefault();
							return;
						} else if (e.equals(KeyCode.Escape)) {
							transaction((tx) => {
								inputFocused.set(false, tx);
								isVisibleObs.set(false, tx);
							})
							e.preventDefault();
							return;
						}
					}}
					onMatchCaseChange={(value) => matchCaseObs.set(value, undefined)}
					onMatchWholeWordChange={(value) => matchWholeWordObs.set(value, undefined)}
					onUseRegexChange={(value) => useRegexObs.set(value, undefined)}
					onValueChange={(value) => findTextObs.set(value, undefined)}
				/>
				<FindResult
					findText={findText}
					matchCount={matchCount}
					matchIndex={matchIndex}
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
					onPressed={() => isVisibleObs.set(false, undefined)}
				>
					<div className='codicon codicon-close' />
				</ActionButton>
			</div>
		</div>
	);
}

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

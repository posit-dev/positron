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
import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';

export interface PositronFindWidgetProps {
	readonly findText: ISettableObservable<string>;
	readonly matchCase: ISettableObservable<boolean>;
	readonly matchWholeWord: ISettableObservable<boolean>;
	readonly useRegex: ISettableObservable<boolean>;
	readonly focusInput?: boolean;
	readonly matchIndex: IObservable<number | undefined>;
	readonly matchCount: IObservable<number | undefined>;
	readonly findInputOptions: IFindInputOptions;
	readonly onPreviousMatch: () => void;
	readonly onNextMatch: () => void;
	readonly onClose: () => void;
	readonly onInputFocus?: () => void;
	readonly onInputBlur?: () => void;
}

export const PositronFindWidget = ({
	findText: findTextObs,
	matchCase: matchCaseObs,
	matchWholeWord: matchWholeWordObs,
	useRegex: useRegexObs,
	focusInput = true,
	matchIndex: matchIndexObs,
	matchCount: matchCountObs,
	findInputOptions,
	onPreviousMatch,
	onNextMatch,
	onClose,
	onInputFocus,
	onInputBlur,
}: PositronFindWidgetProps) => {
	const findText = useObservedValue(findTextObs);
	const matchCase = useObservedValue(matchCaseObs);
	const matchWholeWord = useObservedValue(matchWholeWordObs);
	const useRegex = useObservedValue(useRegexObs);
	const matchIndex = useObservedValue(matchIndexObs);
	const matchCount = useObservedValue(matchCountObs);

	const noMatches = !matchCount;

	return (
		<div className='positron-find-widget-positioned'>
			<div className='positron-find-widget'>
				<div className='find-widget-row'>
					<PositronFindInput
						findInputOptions={findInputOptions}
						focusInput={focusInput}
						matchCase={matchCase}
						matchWholeWord={matchWholeWord}
						useRegex={useRegex}
						value={findText}
						onInputBlur={onInputBlur}
						onInputFocus={onInputFocus}
						onKeyDown={(e) => {
							// TODO: Can/should we use actions instead of handling here?
							//       Upstream plaintext find uses actions but notebook editor does not
							if (e.equals(KeyCode.Enter)) {
								onNextMatch();
								e.preventDefault();
								return;
							} else if (e.equals(KeyMod.Shift | KeyCode.Enter)) {
								onPreviousMatch();
								e.preventDefault();
								return;
							} else if (e.equals(KeyCode.Escape)) {
								onClose();
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
					<div className='find-navigation-buttons'>
						<ActionButton
							ariaLabel='Previous Match'
							className='find-action-button'
							disabled={noMatches}
							onPressed={() => onPreviousMatch()}
						>
							<ThemeIcon icon={Codicon.arrowUp} />
						</ActionButton>
						<ActionButton
							ariaLabel='Next Match'
							className='find-action-button'
							disabled={noMatches}
							onPressed={() => onNextMatch()}
						>
							<ThemeIcon icon={Codicon.arrowDown} />
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

interface FindResultProps {
	findText: string;
	matchIndex?: number;
	matchCount?: number;
}

const FindResult = ({ findText, matchIndex, matchCount }: FindResultProps) => {
	// Case 1: No find text - show "No results" in ordinary color
	if (!findText) {
		return <div className='find-results'>No results</div>;
	}

	// Case 2: Find text but matchCount not yet calculated
	if (matchCount === undefined) {
		return <div className='find-results'></div>;
	}

	// Case 3: Find text but no matches found - different color
	if (matchCount === 0) {
		return <div className='find-results no-results'>No results</div>;
	}

	// Case 4: Matches found - show count
	return <div className='find-results'>{matchIndex ?? 1} of {matchCount}</div>;
};

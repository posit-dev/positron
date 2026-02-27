/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './PositronFindWidget.css';

// Other dependencies.
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { PositronFindInput } from './PositronFindInput.js';
import { PositronReplaceInput } from './PositronReplaceInput.js';
import { IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';
import { IReplaceInputOptions } from '../../../../../../base/browser/ui/findinput/replaceInput.js';
import { IObservable, ISettableObservable } from '../../../../../../base/common/observable.js';
import { useObservedValue } from '../../useObservedValue.js';
import { ThemeIcon } from '../../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { localize } from '../../../../../../nls.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { useRef } from 'react';

// Localized strings
const previousMatchLabel = localize('positronNotebook.find.previousMatch', "Previous Match");
const nextMatchLabel = localize('positronNotebook.find.nextMatch', "Next Match");
const closeLabel = localize('positronNotebook.find.close', "Close");
const noResultsLabel = localize('positronNotebook.find.noResults', "No results");
const toggleReplaceLabel = localize('positronNotebook.find.toggleReplace', "Toggle Replace");
const replaceLabel = localize('positronNotebook.find.replace', "Replace");
const replaceAllLabel = localize('positronNotebook.find.replaceAll', "Replace All");
const matchCountLabel = (matchIndex: number, matchCount: number) =>
	localize('positronNotebook.find.matchCount', "{0} of {1}", matchIndex, matchCount);

export interface PositronFindWidgetReplaceProps {
	readonly isVisible: ISettableObservable<boolean>;
	readonly replaceText: ISettableObservable<string>;
	readonly preserveCase: ISettableObservable<boolean>;
	readonly replaceInputFocused: ISettableObservable<boolean>;
	readonly replaceInputOptions: IReplaceInputOptions;
	readonly onReplace: () => void;
	readonly onReplaceAll: () => void;
}

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
	readonly replace?: PositronFindWidgetReplaceProps;
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
	replace,
	onPreviousMatch,
	onNextMatch,
}: PositronFindWidgetProps) => {
	const replaceButtonRef = useRef<HTMLButtonElement>(null);

	const _findText = useObservedValue(findText);
	const _matchCase = useObservedValue(matchCase);
	const _matchWholeWord = useObservedValue(matchWholeWord);
	const _useRegex = useObservedValue(useRegex);
	const _matchIndex = useObservedValue(matchIndex);
	const _matchCount = useObservedValue(matchCount);
	const _isVisible = useObservedValue(isVisible);
	const _inputFocused = useObservedValue(inputFocused);
	const _isReplaceVisible = useObservedValue(replace?.isVisible, false);
	const _replaceText = useObservedValue(replace?.replaceText, '');
	const _preserveCase = useObservedValue(replace?.preserveCase, false);

	const noMatches = !_matchCount;
	const hasNoResults = _findText && _matchCount === 0;
	const replaceButtonsEnabled = !!_findText;

	const findPart = (
		<div className='find-part'>
			<PositronFindInput
				contextKeyService={contextKeyService}
				contextViewService={contextViewService}
				findInputOptions={findInputOptions}
				isFocused={_inputFocused}
				matchCase={_matchCase}
				matchWholeWord={_matchWholeWord}
				useRegex={_useRegex}
				value={_findText}
				onBlur={() => inputFocused.set(false, undefined)}
				onCaseSensitiveKeyDown={(e) => {
					// TODO: focus
				}}
				onFocus={() => inputFocused.set(true, undefined)}
				onKeyDown={(e) => {
					// TODO: focus
				}}
				onMatchCaseChange={(value) => matchCase.set(value, undefined)}
				onMatchWholeWordChange={(value) => matchWholeWord.set(value, undefined)}
				onRegexKeyDown={(e) => {
					// TODO: focus
				}}
				onUseRegexChange={(value) => useRegex.set(value, undefined)}
				onValueChange={(value) => findText.set(value, undefined)}
			/>
			<div className='find-actions'>
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
		</div>
	);

	return (
		<div className={`positron-find-widget${_isVisible ? ' visible' : ''}${hasNoResults ? ' no-results' : ''}`}>
			{replace && (
				<ActionButton
					ariaLabel={toggleReplaceLabel}
					className='action-button toggle-replace'
					onPressed={() => replace.isVisible.set(!replace.isVisible.get(), undefined)}
				>
					<ThemeIcon icon={_isReplaceVisible ? Codicon.chevronDown : Codicon.chevronRight} />
				</ActionButton>
			)}
			<div className='find-replace-rows'>
				{findPart}
				{replace && _isReplaceVisible && (
					<div className='replace-part'>
						<PositronReplaceInput
							contextKeyService={contextKeyService}
							contextViewService={contextViewService}
							preserveCase={_preserveCase}
							replaceInputOptions={replace.replaceInputOptions}
							value={_replaceText}
							onBlur={() => replace.replaceInputFocused.set(false, undefined)}
							onFocus={() => replace.replaceInputFocused.set(true, undefined)}
							onPreserveCaseChange={(value) => replace.preserveCase.set(value, undefined)}
							onValueChange={(value) => replace.replaceText.set(value, undefined)}
						/>
						<div className='replace-actions'>
							<ActionButton
								ref={replaceButtonRef}
								ariaLabel={replaceLabel}
								className='action-button replace-button'
								disabled={!replaceButtonsEnabled}
								onPressed={() => replace.onReplace()}
							>
								<ThemeIcon icon={Codicon.replace} />
							</ActionButton>
							<ActionButton
								ariaLabel={replaceAllLabel}
								className='action-button replace-all-button'
								disabled={!replaceButtonsEnabled}
								onPressed={() => replace.onReplaceAll()}
							>
								<ThemeIcon icon={Codicon.replaceAll} />
							</ActionButton>
						</div>
					</div>
				)}
			</div>
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

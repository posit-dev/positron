/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './PositronFindWidget.css';

// Other dependencies.
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { PositronFindInput, PositronFindInputHandle } from './PositronFindInput.js';
import { PositronReplaceInput, PositronReplaceInputHandle } from './PositronReplaceInput.js';
import { IKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';
import { IReplaceInputOptions } from '../../../../../../base/browser/ui/findinput/replaceInput.js';
import { IObservable, ISettableObservable } from '../../../../../../base/common/observable.js';
import { useObservedValue } from '../../useObservedValue.js';
import { ThemeIcon } from '../../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { localize } from '../../../../../../nls.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';

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

export interface PositronFindWidgetHandle {
	focusFindInput(): void;
}

export interface PositronFindWidgetReplaceProps {
	readonly isVisible: ISettableObservable<boolean>;
	readonly replaceText: ISettableObservable<string>;
	readonly preserveCase: ISettableObservable<boolean>;
	readonly replaceInputOptions: IReplaceInputOptions;
	readonly onReplace: () => void;
	readonly onReplaceAll: () => void;
	readonly onReplaceInputFocus: () => void;
	readonly onReplaceInputBlur: () => void;
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
	readonly replace?: PositronFindWidgetReplaceProps;
	readonly onPreviousMatch: () => void;
	readonly onNextMatch: () => void;
	readonly onFindInputFocus: () => void;
	readonly onFindInputBlur: () => void;
}

export const PositronFindWidget = forwardRef<PositronFindWidgetHandle, PositronFindWidgetProps>((props, ref) => {
	const findInputRef = useRef<PositronFindInputHandle>(null);
	const replaceInputRef = useRef<PositronReplaceInputHandle>(null);
	const prevButtonRef = useRef<HTMLButtonElement>(null);
	const nextButtonRef = useRef<HTMLButtonElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const replaceButtonRef = useRef<HTMLButtonElement>(null);

	useImperativeHandle(ref, () => ({
		focusFindInput() {
			findInputRef.current?.focus();
			findInputRef.current?.select();
		},
	}), []);

	const findText = useObservedValue(props.findText);
	const matchCase = useObservedValue(props.matchCase);
	const matchWholeWord = useObservedValue(props.matchWholeWord);
	const useRegex = useObservedValue(props.useRegex);
	const matchIndex = useObservedValue(props.matchIndex);
	const matchCount = useObservedValue(props.matchCount);
	const isVisible = useObservedValue(props.isVisible);
	const isReplaceVisible = useObservedValue(props.replace?.isVisible, false);
	const replaceText = useObservedValue(props.replace?.replaceText, '');
	const preserveCase = useObservedValue(props.replace?.preserveCase, false);

	// Auto-focus find input when widget becomes visible after being hidden.
	// First show is handled by FindInput's creation effect; this covers re-shows
	// where the DOM container transitions from display:none to visible.
	useEffect(() => {
		if (isVisible) {
			findInputRef.current?.focus();
			findInputRef.current?.select();
		}
	}, [isVisible]);

	const noMatches = !matchCount;
	const hasNoResults = !!findText && matchCount === 0;
	const replaceButtonsEnabled = !!findText;

	// --- Tab order key handlers ---
	// These intercept Tab/Shift+Tab at points where the desired tab order
	// differs from natural DOM order (cross-row transitions).

	const handleFindInputKeyDown = (e: IKeyboardEvent) => {
		// Tab from find text with replace visible -> focus replace input
		if (e.equals(KeyCode.Tab) && isReplaceVisible) {
			e.preventDefault();
			replaceInputRef.current?.focus();
		}
	};

	const handleCaseSensitiveKeyDown = (e: IKeyboardEvent) => {
		// Shift+Tab from case sensitive with replace visible -> focus replace input
		if (e.equals(KeyMod.Shift | KeyCode.Tab) && isReplaceVisible) {
			e.preventDefault();
			replaceInputRef.current?.focus();
		}
	};

	const handleRegexKeyDown = (e: IKeyboardEvent) => {
		// Tab from regex with replace visible -> focus preserve case
		if (e.equals(KeyCode.Tab) && isReplaceVisible) {
			e.preventDefault();
			replaceInputRef.current?.focusOnPreserveCase();
		}
	};

	const handleCloseButtonKeyDown = (e: React.KeyboardEvent) => {
		// Tab from close button with replace visible -> focus replace button
		if (e.key === 'Tab' && !e.shiftKey && isReplaceVisible) {
			e.preventDefault();
			replaceButtonRef.current?.focus();
		}
	};

	const handleReplaceInputKeyDown = (e: IKeyboardEvent) => {
		// Tab from replace text -> focus case sensitive toggle
		if (e.equals(KeyCode.Tab)) {
			e.preventDefault();
			findInputRef.current?.focusOnCaseSensitive();
		}
		// Shift+Tab from replace text -> focus find input
		if (e.equals(KeyMod.Shift | KeyCode.Tab)) {
			e.preventDefault();
			findInputRef.current?.focus();
		}
	};

	const handlePreserveCaseKeyDown = (e: IKeyboardEvent) => {
		// Tab from preserve case -> focus first enabled: prev, next, close
		if (e.equals(KeyCode.Tab)) {
			e.preventDefault();
			if (!noMatches) {
				prevButtonRef.current?.focus();
			} else {
				closeButtonRef.current?.focus();
			}
		}
	};

	const handleReplaceButtonKeyDown = (e: React.KeyboardEvent) => {
		// Shift+Tab from replace button -> focus close button
		if (e.key === 'Tab' && e.shiftKey) {
			e.preventDefault();
			closeButtonRef.current?.focus();
		}
	};

	const findPart = (
		<div className='find-part'>
			<PositronFindInput
				ref={findInputRef}
				contextKeyService={props.contextKeyService}
				contextViewService={props.contextViewService}
				findInputOptions={props.findInputOptions}
				matchCase={matchCase}
				matchWholeWord={matchWholeWord}
				useRegex={useRegex}
				value={findText}
				onBlur={props.onFindInputBlur}
				onCaseSensitiveKeyDown={handleCaseSensitiveKeyDown}
				onFocus={props.onFindInputFocus}
				onKeyDown={handleFindInputKeyDown}
				onMatchCaseChange={(value) => props.matchCase.set(value, undefined)}
				onMatchWholeWordChange={(value) => props.matchWholeWord.set(value, undefined)}
				onRegexKeyDown={handleRegexKeyDown}
				onUseRegexChange={(value) => props.useRegex.set(value, undefined)}
				onValueChange={(value) => props.findText.set(value, undefined)}
			/>
			<div className='find-actions'>
				<FindResult
					findText={findText}
					matchCount={matchCount}
					matchIndex={matchIndex}
				/>
				<div className='navigation-buttons'>
					<ActionButton
						ref={prevButtonRef}
						ariaLabel={previousMatchLabel}
						className='action-button'
						disabled={noMatches}
						onPressed={props.onPreviousMatch}
					>
						<ThemeIcon icon={Codicon.arrowUp} />
					</ActionButton>
					<ActionButton
						ref={nextButtonRef}
						ariaLabel={nextMatchLabel}
						className='action-button'
						disabled={noMatches}
						onPressed={props.onNextMatch}
					>
						<ThemeIcon icon={Codicon.arrowDown} />
					</ActionButton>
				</div>
				<ActionButton
					ref={closeButtonRef}
					ariaLabel={closeLabel}
					className='action-button close-button'
					onKeyDown={handleCloseButtonKeyDown}
					onPressed={() => props.isVisible.set(false, undefined)}
				>
					<div className='codicon codicon-close' />
				</ActionButton>
			</div>
		</div>
	);

	return (
		<div className={`positron-find-widget${isVisible ? ' visible' : ''}${hasNoResults ? ' no-results' : ''}`}>
			{props.replace && (
				<ActionButton
					ariaLabel={toggleReplaceLabel}
					className='action-button toggle-replace'
					onPressed={() => props.replace!.isVisible.set(!props.replace!.isVisible.get(), undefined)}
				>
					<ThemeIcon icon={isReplaceVisible ? Codicon.chevronDown : Codicon.chevronRight} />
				</ActionButton>
			)}
			<div className='find-replace-rows'>
				{findPart}
				{props.replace && isReplaceVisible && (
					<div className='replace-part'>
						<PositronReplaceInput
							ref={replaceInputRef}
							contextKeyService={props.contextKeyService}
							contextViewService={props.contextViewService}
							preserveCase={preserveCase}
							replaceInputOptions={props.replace.replaceInputOptions}
							value={replaceText}
							onBlur={props.replace.onReplaceInputBlur}
							onFocus={props.replace.onReplaceInputFocus}
							onKeyDown={handleReplaceInputKeyDown}
							onPreserveCaseChange={(value) => props.replace!.preserveCase.set(value, undefined)}
							onPreserveCaseKeyDown={handlePreserveCaseKeyDown}
							onValueChange={(value) => props.replace!.replaceText.set(value, undefined)}
						/>
						<div className='replace-actions'>
							<ActionButton
								ref={replaceButtonRef}
								ariaLabel={replaceLabel}
								className='action-button replace-button'
								disabled={!replaceButtonsEnabled}
								onKeyDown={handleReplaceButtonKeyDown}
								onPressed={props.replace.onReplace}
							>
								<ThemeIcon icon={Codicon.replace} />
							</ActionButton>
							<ActionButton
								ariaLabel={replaceAllLabel}
								className='action-button replace-all-button'
								disabled={!replaceButtonsEnabled}
								onPressed={props.replace.onReplaceAll}
							>
								<ThemeIcon icon={Codicon.replaceAll} />
							</ActionButton>
						</div>
					</div>
				)}
			</div>
		</div>
	);
});

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

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './FindWidget.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { ActionButton } from '../../utilityComponents/ActionButton.js';
import { FindInput, IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';
import { Toggle } from '../../../../../../base/browser/ui/toggle/toggle.js';
import { ISettableObservable } from '../../../../../../base/common/observable.js';
import { useObservedValue } from '../../useObservedValue.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';

export interface PositronFindWidgetProps {
	readonly findText: ISettableObservable<string>;
	readonly matchCase: ISettableObservable<boolean>;
	readonly matchWholeWord: ISettableObservable<boolean>;
	readonly useRegex: ISettableObservable<boolean>;
	readonly focusInput?: boolean;
	readonly matchIndex?: number;
	readonly matchCount?: number;
	readonly additionalToggles?: Toggle[];
	readonly findInputOptions?: IFindInputOptions;
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
	findInputOptions,
	onPreviousMatch,
	onNextMatch,
	onClose,
}: PositronFindWidgetProps) => {
	const findText = useObservedValue(findTextObs);
	const matchCase = useObservedValue(matchCaseObs);
	const matchWholeWord = useObservedValue(matchWholeWordObs);
	const useRegex = useObservedValue(useRegexObs);

	const findInputContainerRef = useRef<HTMLDivElement>(null);
	const [findInput, setFindInput] = useState<FindInput | null>(null);

	// Capture initial options to avoid recreating FindInput on prop changes
	const initialOptionsRef = useRef({
		...findInputOptions,
		additionalToggles,
	});

	// Initialize FindInput widget once on mount
	useEffect(() => {
		if (!findInputContainerRef.current) {
			return;
		}

		const options = initialOptionsRef.current;

		// Create the FindInput widget with merged options
		const input = new FindInput(
			findInputContainerRef.current,
			undefined,  // context view provider
			{
				label: 'Find',
				placeholder: 'Find',
				showCommonFindToggles: true,
				...options,
				inputBoxStyles: defaultInputBoxStyles,
				toggleStyles: defaultToggleStyles,
			});

		setFindInput(input);

		return () => {
			input.dispose();
			setFindInput(null);
		};
	}, []);

	// Set up onInput listener
	useEffect(() => {
		if (!findInput) {
			return;
		}

		const disposable = findInput.onInput(() => {
			findTextObs.set(findInput.getValue(), undefined);
		});

		return () => disposable.dispose();
	}, [findInput, findTextObs]);

	// Set up onDidOptionChange listener
	useEffect(() => {
		if (!findInput) {
			return;
		}

		const disposable = findInput.onDidOptionChange(() => {
			matchCaseObs.set(findInput.getCaseSensitive(), undefined);
			matchWholeWordObs.set(findInput.getWholeWords(), undefined);
			useRegexObs.set(findInput.getRegex(), undefined);
		});

		return () => disposable.dispose();
	}, [findInput, matchCaseObs, matchWholeWordObs, useRegexObs]);

	// Update additionalToggles dynamically
	useEffect(() => {
		if (findInput && additionalToggles) {
			findInput.setAdditionalToggles(additionalToggles);
		}
	}, [findInput, additionalToggles]);

	// Update value
	useEffect(() => {
		if (findInput && findInput.getValue() !== findText) {
			findInput.setValue(findText || '');
		}
	}, [findInput, findText]);

	// Update toggle states
	useEffect(() => {
		if (findInput) {
			findInput.setCaseSensitive(matchCase);
		}
	}, [findInput, matchCase]);

	useEffect(() => {
		if (findInput) {
			findInput.setWholeWords(matchWholeWord);
		}
	}, [findInput, matchWholeWord]);

	useEffect(() => {
		if (findInput) {
			findInput.setRegex(useRegex);
		}
	}, [findInput, useRegex]);

	// Focus input when requested
	useEffect(() => {
		if (focusInput && findInput) {
			findInput.focus();
			findInput.select();
		}
	}, [findInput, focusInput]);

	return (
		<div className='positron-find-widget-positioned'>
			<div className='positron-find-widget'>
				<div className='find-widget-row'>
					<div className='find-input-container'>
						<div ref={findInputContainerRef} />
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

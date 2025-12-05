/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { FindInput } from '../../../../../../base/browser/ui/findinput/findInput.js';
import { Toggle } from '../../../../../../base/browser/ui/toggle/toggle.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';

export interface PositronFindInputProps {
	readonly value?: string;
	readonly matchCase?: boolean;
	readonly matchWholeWord?: boolean;
	readonly useRegex?: boolean;
	readonly focusInput?: boolean;
	readonly additionalToggles?: Toggle[];
	readonly onValueChange: (value: string) => void;
	readonly onMatchCaseChange: (value: boolean) => void;
	readonly onMatchWholeWordChange: (value: boolean) => void;
	readonly onUseRegexChange: (value: boolean) => void;
}

export const PositronFindInput = ({
	value,
	matchCase = false,
	matchWholeWord = false,
	useRegex = false,
	focusInput = false,
	additionalToggles,
	onValueChange,
	onMatchCaseChange,
	onMatchWholeWordChange,
	onUseRegexChange,
}: PositronFindInputProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const initialAdditionTogglesRef = useRef(additionalToggles);
	const [findInput, setFindInput] = useState<FindInput | null>(null);

	// Initialize FindInput widget once on mount
	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		// Create the FindInput widget
		const input = new FindInput(
			containerRef.current,  // parent element
			undefined,  // context view provider TODO: what is this for?
			{
				label: 'Find',
				placeholder: 'Find',
				showCommonFindToggles: true,
				additionalToggles: initialAdditionTogglesRef.current,
				inputBoxStyles: defaultInputBoxStyles,
				toggleStyles: defaultToggleStyles,
			});

		setFindInput(input);

		return () => {
			input.dispose();
			setFindInput(null);
		};
	}, []);

	// Set up onInput listener (recreate when callback or widget changes)
	useEffect(() => {
		if (!findInput) {
			return;
		}

		const disposable = findInput.onInput(() => {
			onValueChange(findInput.getValue());
		});

		return () => disposable.dispose();
	}, [findInput, onValueChange]);

	// Set up onDidOptionChange listener (recreate when callbacks or widget changes)
	useEffect(() => {
		if (!findInput) {
			return;
		}

		const disposable = findInput.onDidOptionChange(() => {
			// TODO: Does it matter that these are called even if the value didn't change?
			onMatchCaseChange(findInput.getCaseSensitive());
			onMatchWholeWordChange(findInput.getWholeWords());
			onUseRegexChange(findInput.getRegex());
		});

		return () => disposable.dispose();
	}, [findInput, onMatchCaseChange, onMatchWholeWordChange, onUseRegexChange]);

	useEffect(() => {
		if (findInput && additionalToggles) {
			findInput.setAdditionalToggles(additionalToggles);
		}
	}, [findInput, additionalToggles]);

	// Update value
	useEffect(() => {
		if (findInput && value) {
			findInput.setValue(value);
		}
	}, [findInput, value]);

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

	return <div ref={containerRef} />;
};

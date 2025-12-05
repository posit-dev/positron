/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { FindInput, IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';

export interface PositronFindInputProps {
	readonly findInputOptions: IFindInputOptions;
	readonly value?: string;
	readonly matchCase?: boolean;
	readonly matchWholeWord?: boolean;
	readonly useRegex?: boolean;
	readonly focusInput?: boolean;
	readonly onValueChange: (value: string) => void;
	readonly onMatchCaseChange: (value: boolean) => void;
	readonly onMatchWholeWordChange: (value: boolean) => void;
	readonly onUseRegexChange: (value: boolean) => void;
	readonly onInputFocus?: () => void;
	readonly onInputBlur?: () => void;
}

export const PositronFindInput = ({
	value,
	matchCase = false,
	matchWholeWord = false,
	useRegex = false,
	focusInput = false,
	findInputOptions,
	onValueChange,
	onMatchCaseChange,
	onMatchWholeWordChange,
	onUseRegexChange,
	onInputFocus,
	onInputBlur,
}: PositronFindInputProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [findInput, setFindInput] = useState<FindInput | null>(null);

	// Capture initial options to avoid recreating FindInput on prop changes
	const initialOptionsRef = useRef(findInputOptions);

	// Initialize FindInput widget once on mount
	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const options = initialOptionsRef.current;

		// Create the FindInput widget with merged options
		const input = new FindInput(
			containerRef.current,  // parent
			undefined,  // context view provider
			options,
		);

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
			onValueChange(findInput.getValue());
		});

		return () => disposable.dispose();
	}, [findInput, onValueChange]);

	// Set up onDidOptionChange listener
	useEffect(() => {
		if (!findInput) {
			return;
		}

		const disposable = findInput.onDidOptionChange(() => {
			onMatchCaseChange(findInput.getCaseSensitive());
			onMatchWholeWordChange(findInput.getWholeWords());
			onUseRegexChange(findInput.getRegex());
		});

		return () => disposable.dispose();
	}, [findInput, onMatchCaseChange, onMatchWholeWordChange, onUseRegexChange]);

	// Set up focus listener
	useEffect(() => {
		if (findInput && onInputFocus) {
			const disposable = findInput.inputBox.onDidFocus(() => {
				onInputFocus();
			});
			return () => disposable.dispose();
		}
		return;
	}, [findInput, onInputFocus]);

	// Set up blur listener
	useEffect(() => {
		if (findInput && onInputBlur) {
			const disposable = findInput.inputBox.onDidBlur(() => {
				onInputBlur();
			});
			return () => disposable.dispose();
		}
		return;
	}, [findInput, onInputBlur]);

	// Update value
	useEffect(() => {
		if (findInput && findInput.getValue() !== value) {
			findInput.setValue(value || '');
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

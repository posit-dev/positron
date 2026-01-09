/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useCallback, useEffect, useRef, useState } from 'react';

// VS Code utilities.
import { Delayer } from '../../../../../../base/common/async.js';

// Other dependencies.
import { FindInput, IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';
import { IKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { ContextScopedFindInput } from '../../../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';

export interface PositronFindInputProps {
	readonly findInputOptions: IFindInputOptions;
	readonly contextKeyService: IContextKeyService;
	readonly contextViewService: IContextViewService;
	readonly value?: string;
	readonly matchCase?: boolean;
	readonly matchWholeWord?: boolean;
	readonly useRegex?: boolean;
	readonly focus?: boolean;
	readonly onKeyDown?: (e: IKeyboardEvent) => void;
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
	focus = false,
	findInputOptions,
	contextKeyService,
	contextViewService,
	onKeyDown,
	onValueChange,
	onMatchCaseChange,
	onMatchWholeWordChange,
	onUseRegexChange,
	onInputFocus,
	onInputBlur,
}: PositronFindInputProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [findInput, setFindInput] = useState<FindInput | null>(null);

	// Delayer for history updates (500ms like SimpleFindWidget)
	const historyDelayerRef = useRef<Delayer<void>>(new Delayer(500));

	// Capture initial options to avoid recreating FindInput on prop changes
	const initialOptionsRef = useRef(findInputOptions);
	const initialValueRef = useRef(value);

	// Initialize FindInput widget once on mount
	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const options = initialOptionsRef.current;

		// Create the FindInput widget with merged options
		const input = new ContextScopedFindInput(
			containerRef.current,  // parent
			contextViewService,
			options,
			contextKeyService,
		);

		// Set the initial value immediately to avoid a flicker waiting for the value effect
		if (initialValueRef.current !== undefined) {
			input.setValue(initialValueRef.current);
		}

		setFindInput(input);

		return () => {
			input.dispose();
			setFindInput(null);
		};
	}, [contextKeyService, contextViewService]);

	// Cleanup delayer on unmount
	useEffect(() => {
		const delayer = historyDelayerRef.current;
		return () => delayer.dispose();
	}, []);

	// History update callback - adds current value to history
	const updateHistory = useCallback(() => {
		if (findInput) {
			findInput.inputBox.addToHistory();
		}
	}, [findInput]);

	// Debounced history update - triggers after 500ms of inactivity
	const delayedUpdateHistory = useCallback(() => {
		historyDelayerRef.current.trigger(updateHistory);
	}, [updateHistory]);

	// Set up onInput listener
	useEffect(() => {
		if (!findInput) {
			return;
		}

		const disposable = findInput.onInput(() => {
			onValueChange(findInput.getValue());
			delayedUpdateHistory();
		});

		return () => disposable.dispose();
	}, [findInput, onValueChange, delayedUpdateHistory]);

	// Set up onDidOptionChange listener
	useEffect(() => {
		if (!findInput) {
			return;
		}

		const disposable = findInput.onDidOptionChange(() => {
			onMatchCaseChange(findInput.getCaseSensitive());
			onMatchWholeWordChange(findInput.getWholeWords());
			onUseRegexChange(findInput.getRegex());
			delayedUpdateHistory();
		});

		return () => disposable.dispose();
	}, [findInput, onMatchCaseChange, onMatchWholeWordChange, onUseRegexChange, delayedUpdateHistory]);

	useEffect(() => {
		if (findInput && onKeyDown) {
			const disposable = findInput.onKeyDown((e) => {
				onKeyDown(e);
			});
			return () => disposable.dispose();
		}
		return;
	}, [findInput, onKeyDown]);

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
		if (findInput && focus) {
			findInput.focus();
			findInput.select();
		}
	}, [findInput, focus]);

	return <div ref={containerRef} className='find-input-container' />;
}

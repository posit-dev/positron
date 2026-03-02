/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { forwardRef, RefObject, useCallback, useEffect, useRef, useState } from 'react';

// VS Code utilities.
import { Delayer } from '../../../../../../base/common/async.js';

// Other dependencies.
import { FindInput, IFindInputOptions } from '../../../../../../base/browser/ui/findinput/findInput.js';
import { IKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { ContextScopedFindInput } from '../../../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { useDisposableEffect } from '../../useDisposableEffect.js';
import { useDelayer } from './useDelayer.js';

export interface PositronFindInputProps {
	readonly value?: string;
	readonly matchCase?: boolean;
	readonly matchWholeWord?: boolean;
	readonly useRegex?: boolean;
	readonly isFocused?: boolean;
	readonly onKeyDown?: (e: IKeyboardEvent) => void;
	readonly onCaseSensitiveKeyDown?: (e: IKeyboardEvent) => void;
	readonly onRegexKeyDown?: (e: IKeyboardEvent) => void;
	readonly onValueChange: (value: string) => void;
	readonly onMatchCaseChange: (value: boolean) => void;
	readonly onMatchWholeWordChange: (value: boolean) => void;
	readonly onUseRegexChange: (value: boolean) => void;
	readonly onFocus?: () => void;
	readonly onBlur?: () => void;
	readonly findInputOptions: IFindInputOptions;
	readonly contextKeyService: IContextKeyService;
	readonly contextViewService: IContextViewService;
}

export const PositronFindInput = forwardRef<FindInput, PositronFindInputProps>(({
	value,
	matchCase = false,
	matchWholeWord = false,
	useRegex = false,
	isFocused = false,
	onKeyDown,
	onCaseSensitiveKeyDown,
	onRegexKeyDown,
	onValueChange,
	onMatchCaseChange,
	onMatchWholeWordChange,
	onUseRegexChange,
	onFocus,
	onBlur,
	findInputOptions,
	contextKeyService,
	contextViewService,
}, ref) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const findInput = useFindInput(containerRef, findInputOptions, contextViewService, contextKeyService, value);

	/** Track whether the input was previously focused */
	const wasFocused = useRef(false);

	/** Delayer/throttler for history updates (500ms like SimpleFindWidget) */
	const delayer = useDelayer(() => new Delayer<void>(500));

	/** Add the current find input value to the history (no delay) */
	const updateHistory = useCallback(() => {
		findInput?.inputBox.addToHistory();
	}, [findInput]);

	// Connect find input events to component callbacks
	useDisposableEffect(() => {
		if (!findInput) { return; }
		return onKeyDown && findInput.onKeyDown((e) => onKeyDown(e));
	}, [findInput, onKeyDown]);
	useDisposableEffect(() => {
		if (!findInput) { return; }
		return onFocus && findInput.inputBox.onDidFocus(() => onFocus());
	}, [findInput, onFocus]);
	useDisposableEffect(() => {
		if (!findInput) { return; }
		return onBlur && findInput.inputBox.onDidBlur(() => onBlur());
	}, [findInput, onBlur]);
	useDisposableEffect(() => {
		if (!findInput) { return; }
		return onCaseSensitiveKeyDown && findInput.onCaseSensitiveKeyDown((e) => onCaseSensitiveKeyDown(e));
	}, [findInput, onCaseSensitiveKeyDown]);
	useDisposableEffect(() => {
		if (!findInput) { return; }
		return onRegexKeyDown && findInput.onRegexKeyDown((e) => onRegexKeyDown(e));
	}, [findInput, onRegexKeyDown]);

	// Use separate callbacks for each option
	useDisposableEffect(() => {
		if (!findInput) { return; }
		return findInput.onDidOptionChange(() => {
			onMatchCaseChange(findInput.getCaseSensitive());
			onMatchWholeWordChange(findInput.getWholeWords());
			onUseRegexChange(findInput.getRegex());
			delayer.trigger(updateHistory);
		});
	}, [findInput, onMatchCaseChange, onMatchWholeWordChange, onUseRegexChange, delayer, updateHistory]);

	// Update value and trigger delayed history update on input
	useDisposableEffect(() => {
		if (!findInput) { return; }
		return findInput.onInput(() => {
			onValueChange(findInput.getValue());
			delayer.trigger(updateHistory);
		});
	}, [findInput, onValueChange, delayer, updateHistory]);

	// Connect scalar props to find input
	useEffect(() => {
		if (!findInput) { return; }
		const newValue = value || '';
		if (findInput.getValue() !== newValue) {
			findInput.setValue(newValue);
		}
	}, [findInput, value]);
	useEffect(() => {
		if (!findInput) { return; }
		findInput.setCaseSensitive(matchCase);
	}, [findInput, matchCase]);
	useEffect(() => {
		if (!findInput) { return; }
		findInput.setWholeWords(matchWholeWord);
	}, [findInput, matchWholeWord]);
	useEffect(() => {
		if (!findInput) { return; }
		findInput.setRegex(useRegex);
	}, [findInput, useRegex]);

	// Focus input when requested
	useEffect(() => {
		if (!findInput) { return; }
		if (!wasFocused.current && isFocused) {
			findInput.focus();
			findInput.select();
		}
		wasFocused.current = isFocused;
	}, [findInput, isFocused]);

	return <div ref={containerRef} className='find-input-container' />;
});

function useFindInput(
	containerRef: RefObject<HTMLElement | null>,
	options: IFindInputOptions,
	contextViewService: IContextViewService,
	contextKeyService: IContextKeyService,
	value?: string,
): FindInput | null {
	const [findInput, setFindInput] = useState<FindInput | null>(null);

	// Capture initial options to avoid recreating FindInput on prop changes
	const initialOptionsRef = useRef(options);
	const initialValueRef = useRef(value);

	// Initialize FindInput widget once on mount
	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		// Create the FindInput widget
		const input = new ContextScopedFindInput(
			containerRef.current,
			contextViewService,
			initialOptionsRef.current,
			contextKeyService,
		);

		// Set the initial value immediately to avoid a flicker waiting for the value effect
		if (initialValueRef.current !== undefined) {
			input.setValue(initialValueRef.current);
		}

		setFindInput(input);

		return () => {
			input.dispose();
		};
	}, [containerRef, contextKeyService, contextViewService]);

	return findInput;
}

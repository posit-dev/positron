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
	const { inputRef, isReady } = useFindInput(containerRef, findInputOptions, contextViewService, contextKeyService, value);

	/** Track whether the input was previously focused */
	const wasFocused = useRef(false);

	/** Delayer/throttler for history updates (500ms like SimpleFindWidget) */
	const delayer = useDelayer(() => new Delayer<void>(500));

	/** Add the current find input value to the history (no delay) */
	const updateHistory = useCallback(() => {
		if (!inputRef.current) { return; }
		inputRef.current.inputBox.addToHistory();
	}, [inputRef]);

	// Connect find input events to component callbacks
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		return onKeyDown && inputRef.current.onKeyDown((e) => onKeyDown(e));
	}, [isReady, inputRef, onKeyDown]);
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		return onFocus && inputRef.current.inputBox.onDidFocus(() => onFocus());
	}, [isReady, inputRef, onFocus]);
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		return onBlur && inputRef.current.inputBox.onDidBlur(() => onBlur());
	}, [isReady, inputRef, onBlur]);
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		return onCaseSensitiveKeyDown && inputRef.current.onCaseSensitiveKeyDown((e) => onCaseSensitiveKeyDown(e));
	}, [isReady, inputRef, onCaseSensitiveKeyDown]);
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		return onRegexKeyDown && inputRef.current.onRegexKeyDown((e) => onRegexKeyDown(e));
	}, [isReady, inputRef, onRegexKeyDown]);

	// Use separate callbacks for each option
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		const input = inputRef.current;
		return input.onDidOptionChange(() => {
			onMatchCaseChange(input.getCaseSensitive());
			onMatchWholeWordChange(input.getWholeWords());
			onUseRegexChange(input.getRegex());
			delayer.trigger(updateHistory);
		});
	}, [isReady, inputRef, onMatchCaseChange, onMatchWholeWordChange, onUseRegexChange, delayer, updateHistory]);

	// Update value and trigger delayed history update on input
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		const input = inputRef.current;
		return input.onInput(() => {
			onValueChange(input.getValue());
			delayer.trigger(updateHistory);
		});
	}, [isReady, inputRef, onValueChange, delayer, updateHistory]);

	// Connect scalar props to find input
	useEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		const newValue = value || '';
		if (inputRef.current.getValue() !== newValue) {
			inputRef.current.setValue(newValue);
		}
	}, [isReady, inputRef, value]);
	useEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		inputRef.current.setCaseSensitive(matchCase);
	}, [isReady, inputRef, matchCase]);
	useEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		inputRef.current.setWholeWords(matchWholeWord);
	}, [isReady, inputRef, matchWholeWord]);
	useEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		inputRef.current.setRegex(useRegex);
	}, [isReady, inputRef, useRegex]);

	// Focus input when requested
	useEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		if (!wasFocused.current && isFocused) {
			inputRef.current.focus();
			inputRef.current.select();
		}
		wasFocused.current = isFocused;
	}, [isReady, inputRef, isFocused]);

	return <div ref={containerRef} className='find-input-container' />;
});

interface UseFindInputResult {
	readonly inputRef: RefObject<FindInput | null>;
	readonly isReady: boolean;
}

function useFindInput(
	containerRef: RefObject<HTMLElement | null>,
	options: IFindInputOptions,
	contextViewService: IContextViewService,
	contextKeyService: IContextKeyService,
	value?: string,
): UseFindInputResult {
	const inputRef = useRef<FindInput | null>(null);
	const [isReady, setIsReady] = useState(false);

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

		inputRef.current = input;
		setIsReady(true);

		return () => {
			input.dispose();
			inputRef.current = null;
			// Do NOT call setIsReady(false) -- avoid state updates during unmount
		};
	}, [containerRef, contextKeyService, contextViewService]);

	return { inputRef, isReady };
}


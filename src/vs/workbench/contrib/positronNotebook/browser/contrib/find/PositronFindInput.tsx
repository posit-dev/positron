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

interface BaseFindInputProps {
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
}

export interface PositronFindInputProps extends BaseFindInputProps {
	readonly findInputOptions: IFindInputOptions;
	readonly contextKeyService: IContextKeyService;
	readonly contextViewService: IContextViewService;
}

export const PositronFindInput = forwardRef<FindInput, PositronFindInputProps>((props, ref) => {
	const {
		value,
		findInputOptions,
		contextKeyService,
		contextViewService,
	} = props;
	const containerRef = useRef<HTMLDivElement>(null);
	const { inputRef, isReady } = useFindInput(containerRef, findInputOptions, contextViewService, contextKeyService, value);

	return <div ref={containerRef} className='find-input-container'>
		{isReady && inputRef.current && <FindInputEffects findInput={inputRef.current} {...props} />}
	</div>;
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

interface FindInputEffectsProps extends BaseFindInputProps {
	readonly findInput: FindInput;
	readonly onFocus?: () => void;
	readonly onBlur?: () => void;
}

const FindInputEffects = ({
	findInput,
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
}: FindInputEffectsProps) => {
	/** Track whether the input was previously focused */
	const wasFocused = useRef(false);

	/** Delayer/throttler for history updates (500ms like SimpleFindWidget) */
	const delayer = useDelayer(() => new Delayer<void>(500));

	/** Add the current find input value to the history (no delay) */
	const updateHistory = useCallback(() => {
		findInput.inputBox.addToHistory();
	}, [findInput.inputBox]);

	// Connect find input events to component callbacks
	useDisposableEffect(() => onKeyDown && findInput.onKeyDown((e) => onKeyDown(e)), [findInput, onKeyDown]);
	useDisposableEffect(() => onFocus && findInput.inputBox.onDidFocus(() => onFocus()), [findInput.inputBox, onFocus]);
	useDisposableEffect(() => onBlur && findInput.inputBox.onDidBlur(() => onBlur()), [findInput.inputBox, onBlur]);
	useDisposableEffect(() => onCaseSensitiveKeyDown && findInput.onCaseSensitiveKeyDown((e) => onCaseSensitiveKeyDown(e)), [findInput, onCaseSensitiveKeyDown]);
	useDisposableEffect(() => onRegexKeyDown && findInput.onRegexKeyDown((e) => onRegexKeyDown(e)), [findInput, onRegexKeyDown]);

	// Use separate callbacks for each option
	useDisposableEffect(() => findInput.onDidOptionChange(() => {
		onMatchCaseChange(findInput.getCaseSensitive());
		onMatchWholeWordChange(findInput.getWholeWords());
		onUseRegexChange(findInput.getRegex());
		delayer.trigger(updateHistory);
	}), [findInput, onMatchCaseChange, onMatchWholeWordChange, onUseRegexChange, delayer, updateHistory]);

	// Update value and trigger delayed history update on input
	useDisposableEffect(() => findInput.onInput(() => {
		onValueChange(findInput.getValue());
		delayer.trigger(updateHistory);
	}), [findInput, onValueChange, delayer, updateHistory]);

	// Connect scalar props to find input
	useEffect(() => {
		const newValue = value || '';
		if (findInput.getValue() !== newValue) {
			findInput.setValue(newValue);
		}
	}, [findInput, value]);
	useEffect(() => findInput.setCaseSensitive(matchCase), [findInput, matchCase]);
	useEffect(() => findInput.setWholeWords(matchWholeWord), [findInput, matchWholeWord]);
	useEffect(() => findInput.setRegex(useRegex), [findInput, useRegex]);

	// Focus input when requested
	useEffect(() => {
		if (!wasFocused.current && isFocused) {
			findInput.focus();
			findInput.select();
		}
		wasFocused.current = isFocused;
	}, [findInput, isFocused]);

	// Don't actually render anything. This component exists to conditionally
	// create effects only once findInput is instantiated.
	return null;
};

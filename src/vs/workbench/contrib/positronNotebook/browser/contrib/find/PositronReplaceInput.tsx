/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

// VS Code utilities.
import { Delayer } from '../../../../../../base/common/async.js';

// Other dependencies.
import { IReplaceInputOptions, ReplaceInput } from '../../../../../../base/browser/ui/findinput/replaceInput.js';
import { IKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { ContextScopedReplaceInput } from '../../../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { useDisposableEffect } from '../../useDisposableEffect.js';
import { useDelayer } from './useDelayer.js';

interface BaseReplaceInputProps {
	readonly value?: string;
	readonly preserveCase?: boolean;
	readonly isFocused?: boolean;
	readonly onKeyDown?: (e: IKeyboardEvent) => void;
	readonly onPreserveCaseKeyDown?: (e: IKeyboardEvent) => void;
	readonly onValueChange: (value: string) => void;
	readonly onPreserveCaseChange: (value: boolean) => void;
	readonly onFocus?: () => void;
	readonly onBlur?: () => void;
}

export interface PositronReplaceInputProps extends BaseReplaceInputProps {
	readonly replaceInputOptions: IReplaceInputOptions;
	readonly contextKeyService: IContextKeyService;
	readonly contextViewService: IContextViewService;
}

export const PositronReplaceInput = (props: PositronReplaceInputProps) => {
	const {
		value,
		replaceInputOptions,
		contextKeyService,
		contextViewService,
	} = props;
	const containerRef = useRef<HTMLDivElement>(null);
	const { inputRef, isReady } = useReplaceInput(containerRef, replaceInputOptions, contextViewService, contextKeyService, value);

	return <div ref={containerRef} className='replace-input-container'>
		{isReady && inputRef.current && <ReplaceInputEffects replaceInput={inputRef.current} {...props} />}
	</div>;
};

interface UseReplaceInputResult {
	readonly inputRef: RefObject<ReplaceInput | null>;
	readonly isReady: boolean;
}

function useReplaceInput(
	containerRef: RefObject<HTMLElement | null>,
	options: IReplaceInputOptions,
	contextViewService: IContextViewService,
	contextKeyService: IContextKeyService,
	value?: string,
): UseReplaceInputResult {
	const inputRef = useRef<ReplaceInput | null>(null);
	const [isReady, setIsReady] = useState(false);

	// Capture initial options to avoid recreating ReplaceInput on prop changes
	const initialOptionsRef = useRef(options);
	const initialValueRef = useRef(value);

	// Initialize ReplaceInput widget once on mount
	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const input = new ContextScopedReplaceInput(
			containerRef.current,
			contextViewService,
			initialOptionsRef.current,
			contextKeyService,
			true, // showReplaceOptions (preserve case toggle)
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

interface ReplaceInputEffectsProps extends BaseReplaceInputProps {
	readonly replaceInput: ReplaceInput;
}

const ReplaceInputEffects = ({
	replaceInput,
	value,
	preserveCase = false,
	isFocused = false,
	onKeyDown,
	onPreserveCaseKeyDown,
	onValueChange,
	onPreserveCaseChange,
	onFocus,
	onBlur,
}: ReplaceInputEffectsProps) => {
	/** Track whether the input was previously focused */
	const wasFocused = useRef(false);

	/** Delayer/throttler for history updates (500ms like SimpleFindWidget) */
	const delayer = useDelayer(() => new Delayer<void>(500));

	/** Add the current replace input value to the history (no delay) */
	const updateHistory = useCallback(() => {
		replaceInput.inputBox.addToHistory();
	}, [replaceInput.inputBox]);

	// Connect replace input events to component callbacks
	useDisposableEffect(() => onKeyDown && replaceInput.onKeyDown((e) => onKeyDown(e)), [replaceInput, onKeyDown]);
	useDisposableEffect(() => onFocus && replaceInput.inputBox.onDidFocus(() => onFocus()), [replaceInput.inputBox, onFocus]);
	useDisposableEffect(() => onBlur && replaceInput.inputBox.onDidBlur(() => onBlur()), [replaceInput.inputBox, onBlur]);
	useDisposableEffect(() => onPreserveCaseKeyDown && replaceInput.onPreserveCaseKeyDown((e) => onPreserveCaseKeyDown(e)), [replaceInput, onPreserveCaseKeyDown]);

	// Handle option change (preserve case toggle)
	useDisposableEffect(() => replaceInput.onDidOptionChange(() => {
		onPreserveCaseChange(replaceInput.getPreserveCase());
		delayer.trigger(updateHistory);
	}), [replaceInput, onPreserveCaseChange, delayer, updateHistory]);

	// Update value and trigger delayed history update on input
	useDisposableEffect(() => replaceInput.onInput(() => {
		onValueChange(replaceInput.getValue());
		delayer.trigger(updateHistory);
	}), [replaceInput, onValueChange, delayer, updateHistory]);

	// Connect scalar props to replace input
	useEffect(() => {
		const newValue = value || '';
		if (replaceInput.getValue() !== newValue) {
			replaceInput.setValue(newValue);
		}
	}, [replaceInput, value]);
	useEffect(() => replaceInput.setPreserveCase(preserveCase), [replaceInput, preserveCase]);

	// Focus input when requested
	useEffect(() => {
		if (!wasFocused.current && isFocused) {
			replaceInput.focus();
			replaceInput.select();
		}
		wasFocused.current = isFocused;
	}, [replaceInput, isFocused]);

	// Don't actually render anything. This component exists to conditionally
	// create effects only once replaceInput is instantiated.
	return null;
};

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

export interface PositronReplaceInputProps {
	readonly value?: string;
	readonly preserveCase?: boolean;
	readonly isFocused?: boolean;
	readonly onKeyDown?: (e: IKeyboardEvent) => void;
	readonly onPreserveCaseKeyDown?: (e: IKeyboardEvent) => void;
	readonly onValueChange: (value: string) => void;
	readonly onPreserveCaseChange: (value: boolean) => void;
	readonly onFocus?: () => void;
	readonly onBlur?: () => void;
	readonly replaceInputOptions: IReplaceInputOptions;
	readonly contextKeyService: IContextKeyService;
	readonly contextViewService: IContextViewService;
}

export const PositronReplaceInput = ({
	value,
	preserveCase = false,
	isFocused = false,
	onKeyDown,
	onPreserveCaseKeyDown,
	onValueChange,
	onPreserveCaseChange,
	onFocus,
	onBlur,
	replaceInputOptions,
	contextKeyService,
	contextViewService,
}: PositronReplaceInputProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const { inputRef, isReady } = useReplaceInput(containerRef, replaceInputOptions, contextViewService, contextKeyService, value);

	/** Track whether the input was previously focused */
	const wasFocused = useRef(false);

	/** Delayer/throttler for history updates (500ms like SimpleFindWidget) */
	const delayer = useDelayer(() => new Delayer<void>(500));

	/** Add the current replace input value to the history (no delay) */
	const updateHistory = useCallback(() => {
		if (!inputRef.current) { return; }
		inputRef.current.inputBox.addToHistory();
	}, [inputRef]);

	// Connect replace input events to component callbacks
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
		return onPreserveCaseKeyDown && inputRef.current.onPreserveCaseKeyDown((e) => onPreserveCaseKeyDown(e));
	}, [isReady, inputRef, onPreserveCaseKeyDown]);

	// Handle option change (preserve case toggle)
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		const input = inputRef.current;
		return input.onDidOptionChange(() => {
			onPreserveCaseChange(input.getPreserveCase());
			delayer.trigger(updateHistory);
		});
	}, [isReady, inputRef, onPreserveCaseChange, delayer, updateHistory]);

	// Update value and trigger delayed history update on input
	useDisposableEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		const input = inputRef.current;
		return input.onInput(() => {
			onValueChange(input.getValue());
			delayer.trigger(updateHistory);
		});
	}, [isReady, inputRef, onValueChange, delayer, updateHistory]);

	// Connect scalar props to replace input
	useEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		const newValue = value || '';
		if (inputRef.current.getValue() !== newValue) {
			inputRef.current.setValue(newValue);
		}
	}, [isReady, inputRef, value]);
	useEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		inputRef.current.setPreserveCase(preserveCase);
	}, [isReady, inputRef, preserveCase]);

	// Focus input when requested
	useEffect(() => {
		if (!isReady || !inputRef.current) { return; }
		if (!wasFocused.current && isFocused) {
			inputRef.current.focus();
			inputRef.current.select();
		}
		wasFocused.current = isFocused;
	}, [isReady, inputRef, isFocused]);

	return <div ref={containerRef} className='replace-input-container' />;
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


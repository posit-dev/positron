/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback, useEffect, useRef, useState } from 'react';

// VS Code utilities.
import { Delayer } from '../../../../../../base/common/async.js';

// Other dependencies.
import { IReplaceInputOptions, ReplaceInput } from '../../../../../../base/browser/ui/findinput/replaceInput.js';
import { IKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { ContextScopedReplaceInput } from '../../../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';

export interface PositronReplaceInputProps {
	readonly replaceInputOptions: IReplaceInputOptions;
	readonly contextKeyService: IContextKeyService;
	readonly contextViewService: IContextViewService;
	readonly value?: string;
	readonly preserveCase?: boolean;
	readonly focus?: boolean;
	readonly onKeyDown?: (e: IKeyboardEvent) => void;
	readonly onValueChange: (value: string) => void;
	readonly onPreserveCaseChange: (value: boolean) => void;
	readonly onInputFocus?: () => void;
	readonly onInputBlur?: () => void;
}

export const PositronReplaceInput = ({
	value,
	preserveCase = false,
	focus = false,
	replaceInputOptions,
	contextKeyService,
	contextViewService,
	onKeyDown,
	onValueChange,
	onPreserveCaseChange,
	onInputFocus,
	onInputBlur,
}: PositronReplaceInputProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [replaceInput, setReplaceInput] = useState<ReplaceInput | null>(null);

	// Delayer for history updates (500ms like SimpleFindWidget)
	const historyDelayerRef = useRef<Delayer<void>>(new Delayer(500));

	// Capture initial options to avoid recreating ReplaceInput on prop changes
	const initialOptionsRef = useRef(replaceInputOptions);
	const initialValueRef = useRef(value);

	// Initialize ReplaceInput widget once on mount
	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const options = initialOptionsRef.current;

		const input = new ContextScopedReplaceInput(
			containerRef.current,
			contextViewService,
			options,
			contextKeyService,
			true, // showReplaceOptions (preserve case toggle)
		);

		// Set the initial value immediately to avoid a flicker waiting for the value effect
		if (initialValueRef.current !== undefined) {
			input.setValue(initialValueRef.current);
		}

		setReplaceInput(input);

		return () => {
			input.dispose();
			setReplaceInput(null);
		};
	}, [contextKeyService, contextViewService]);

	// Cleanup delayer on unmount
	useEffect(() => {
		const delayer = historyDelayerRef.current;
		return () => delayer.dispose();
	}, []);

	// History update callback
	const updateHistory = useCallback(() => {
		if (replaceInput) {
			replaceInput.inputBox.addToHistory();
		}
	}, [replaceInput]);

	// Debounced history update
	const delayedUpdateHistory = useCallback(() => {
		historyDelayerRef.current.trigger(updateHistory);
	}, [updateHistory]);

	// Set up onInput listener
	useEffect(() => {
		if (!replaceInput) {
			return;
		}

		const disposable = replaceInput.onInput(() => {
			onValueChange(replaceInput.getValue());
			delayedUpdateHistory();
		});

		return () => disposable.dispose();
	}, [replaceInput, onValueChange, delayedUpdateHistory]);

	// Set up onDidOptionChange listener (preserve case)
	useEffect(() => {
		if (!replaceInput) {
			return;
		}

		const disposable = replaceInput.onDidOptionChange(() => {
			onPreserveCaseChange(replaceInput.getPreserveCase());
			delayedUpdateHistory();
		});

		return () => disposable.dispose();
	}, [replaceInput, onPreserveCaseChange, delayedUpdateHistory]);

	// Set up onKeyDown listener
	useEffect(() => {
		if (replaceInput && onKeyDown) {
			const disposable = replaceInput.onKeyDown((e) => {
				onKeyDown(e);
			});
			return () => disposable.dispose();
		}
		return;
	}, [replaceInput, onKeyDown]);

	// Set up focus listener
	useEffect(() => {
		if (replaceInput && onInputFocus) {
			const disposable = replaceInput.inputBox.onDidFocus(() => {
				onInputFocus();
			});
			return () => disposable.dispose();
		}
		return;
	}, [replaceInput, onInputFocus]);

	// Set up blur listener
	useEffect(() => {
		if (replaceInput && onInputBlur) {
			const disposable = replaceInput.inputBox.onDidBlur(() => {
				onInputBlur();
			});
			return () => disposable.dispose();
		}
		return;
	}, [replaceInput, onInputBlur]);

	// Update value
	useEffect(() => {
		if (replaceInput && replaceInput.getValue() !== value) {
			replaceInput.setValue(value || '');
		}
	}, [replaceInput, value]);

	// Update preserve case toggle
	useEffect(() => {
		if (replaceInput) {
			replaceInput.setPreserveCase(preserveCase);
		}
	}, [replaceInput, preserveCase]);

	// Focus input when requested
	useEffect(() => {
		if (replaceInput && focus) {
			replaceInput.focus();
			replaceInput.select();
		}
	}, [replaceInput, focus]);

	return <div ref={containerRef} className='replace-input-container' />;
};

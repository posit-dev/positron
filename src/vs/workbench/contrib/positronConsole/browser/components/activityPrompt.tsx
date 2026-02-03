/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityPrompt.css';

// React.
import React, { KeyboardEvent, useCallback, useEffect, useRef } from 'react';

// Other dependencies.
import { Emitter } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { OutputRun } from '../../../../browser/positronAnsiRenderer/outputRun.js';
import { EditOperation } from '../../../../../editor/common/core/editOperation.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from '../../../codeEditor/browser/simpleEditorOptions.js';
import { ActivityItemPrompt, ActivityItemPromptState } from '../../../../services/positronConsole/browser/classes/activityItemPrompt.js';

// ActivityPromptProps interface.
export interface ActivityPromptProps {
	activityItemPrompt: ActivityItemPrompt;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * Inserts text at the current selection in the editor, stripping newlines.
 * Used for paste operations in single-line activity prompts.
 */
const insertTextAtSelection = (editor: CodeEditorWidget, text: string) => {
	const cleanedText = text.replace(/[\r\n]+/g, ' ');
	const selection = editor.getSelection();
	if (selection) {
		const startPosition = selection.getStartPosition();
		editor.executeEdits('paste', [EditOperation.replace(selection, cleanedText)]);
		editor.setPosition({
			lineNumber: startPosition.lineNumber,
			column: startPosition.column + cleanedText.length
		});
	}
};

/**
 * ActivityPrompt component.
 * @param props An ActivityPromptProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityPrompt = (props: ActivityPromptProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const passwordInputRef = useRef<HTMLInputElement>(null);
	const editorContainerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<CodeEditorWidget | null>(null);

	// Whether to use the password input (HTML input) or the editor (CodeEditorWidget).
	const isPassword = props.activityItemPrompt.password;
	const isUnanswered = props.activityItemPrompt.state === ActivityItemPromptState.Unanswered;

	/**
	 * Focuses the appropriate input element.
	 */
	const focusInput = useCallback(() => {
		if (isPassword) {
			passwordInputRef.current?.scrollIntoView({ behavior: 'auto' });
			passwordInputRef.current?.focus();
		} else {
			editorContainerRef.current?.scrollIntoView({ behavior: 'auto' });
			editorRef.current?.focus();
		}
	}, [isPassword]);

	// Set up the CodeEditorWidget for non-password prompts.
	useEffect(() => {
		// Only create editor for non-password, unanswered prompts.
		if (isPassword || !isUnanswered || !editorContainerRef.current) {
			return;
		}

		const disposableStore = new DisposableStore();

		// Create the editor with minimal configuration for single-line input.
		const editor = disposableStore.add(
			services.instantiationService.createInstance(
				CodeEditorWidget,
				editorContainerRef.current,
				{
					...getSimpleEditorOptions(services.configurationService),
					wordWrap: 'off',
					lineNumbers: 'off',
					scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
					renderLineHighlight: 'none',
					minimap: { enabled: false },
					overviewRulerLanes: 0,
					lineDecorationsWidth: 0,
					padding: { top: 0, bottom: 0 },
				},
				getSimpleCodeEditorWidgetOptions()
			)
		);

		// Create a plain text model for the editor.
		const emitter = disposableStore.add(new Emitter<string>());
		const model = disposableStore.add(
			services.modelService.createModel(
				'',
				{ languageId: '', onDidChange: emitter.event },
				undefined,
				true
			)
		);
		editor.setModel(model);

		// Handle paste and select all via capture phase to intercept before VS Code's keybinding system.
		// This is necessary because the keybinding system processes events before the editor's handlers.
		const container = editorContainerRef.current;
		const handleKeydownCapture = async (e: globalThis.KeyboardEvent) => {
			const ke = new StandardKeyboardEvent(e);
			const cmdOrCtrlKey = isMacintosh ? ke.metaKey && !ke.ctrlKey : ke.ctrlKey && !ke.metaKey;

			// Cmd/Ctrl+V - paste from clipboard.
			if (ke.keyCode === KeyCode.KeyV && cmdOrCtrlKey && !ke.shiftKey && !ke.altKey) {
				ke.preventDefault();
				ke.stopPropagation();

				const clipboardText = await services.clipboardService.readText();
				if (clipboardText) {
					insertTextAtSelection(editor, clipboardText);
				}
				return;
			}

			// Cmd/Ctrl+A - select all text in the editor.
			if (ke.keyCode === KeyCode.KeyA && cmdOrCtrlKey && !ke.shiftKey && !ke.altKey) {
				ke.preventDefault();
				ke.stopPropagation();

				const textModel = editor.getModel();
				if (textModel) {
					const fullModelRange = textModel.getFullModelRange();
					editor.setSelection(fullModelRange);
				}
				return;
			}
		};
		container.addEventListener('keydown', handleKeydownCapture, true);
		disposableStore.add({ dispose: () => container.removeEventListener('keydown', handleKeydownCapture, true) });

		// Handle keyboard events for Enter and Ctrl+C.
		disposableStore.add(editor.onKeyDown(async e => {
			// Enter key - submit the prompt.
			if (e.keyCode === KeyCode.Enter) {
				e.preventDefault();
				e.stopPropagation();
				props.positronConsoleInstance.replyToPrompt(editor.getValue());
				return;
			}

			// Ctrl+C handling (matches consoleInput.tsx behavior).
			if (e.keyCode === KeyCode.KeyC && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
				e.preventDefault();
				e.stopPropagation();

				// On macOS, Ctrl+C always interrupts the runtime.
				// On Windows/Linux, Ctrl+C copies if there's a selection, otherwise interrupts.
				if (isMacintosh) {
					props.positronConsoleInstance.interrupt();
				} else {
					const selection = editor.getSelection();
					if (!selection || selection.isEmpty()) {
						props.positronConsoleInstance.interrupt();
					} else {
						const textModel = editor.getModel();
						if (textModel) {
							const value = textModel.getValueInRange(selection);
							await services.clipboardService.writeText(value);
						}
					}
				}
				return;
			}
		}));

		// Handle paste events from context menu and drag-drop via DOM paste event.
		// We intercept BEFORE the editor processes the paste so there's only one undo operation.
		const handlePasteCapture = (e: ClipboardEvent) => {
			const clipboardText = e.clipboardData?.getData('text/plain');
			if (clipboardText && (clipboardText.includes('\n') || clipboardText.includes('\r'))) {
				// Prevent the native paste since we'll insert cleaned text manually.
				e.preventDefault();
				e.stopPropagation();
				insertTextAtSelection(editor, clipboardText);
			}
			// If no newlines, let the native paste handle it.
		};
		container.addEventListener('paste', handlePasteCapture, true);
		disposableStore.add({ dispose: () => container.removeEventListener('paste', handlePasteCapture, true) });

		// Stop mouse down events from propagating to the ConsoleInstance, which has its
		// own context menu. This allows the editor's context menu to appear on right-click.
		// See https://github.com/posit-dev/positron/issues/2281 for similar fix in consoleInput.
		disposableStore.add(editor.onMouseDown(e => {
			e.event.stopPropagation();
		}));

		// Store the editor reference and focus it.
		editorRef.current = editor;

		// Layout the editor to match container size.
		editor.layout({ width: container.clientWidth, height: container.clientHeight });

		// Focus the editor.
		editor.focus();

		return () => {
			editorRef.current = null;
			disposableStore.dispose();
		};
	}, [isPassword, isUnanswered, props.positronConsoleInstance, services.instantiationService, services.configurationService, services.modelService, services.clipboardService]);

	// Set up focus handling and paste support for password input.
	useEffect(() => {
		if (!isPassword || !isUnanswered) {
			return;
		}

		const input = passwordInputRef.current;
		if (!input) {
			return;
		}

		// Focus the password input.
		input.scrollIntoView({ behavior: 'auto' });
		input.focus();

		// Handle paste via capture phase to intercept before VS Code's keybinding system.
		const handlePasteKeydown = async (e: globalThis.KeyboardEvent) => {
			const ke = new StandardKeyboardEvent(e);
			const cmdOrCtrlKey = isMacintosh ? ke.metaKey && !ke.ctrlKey : ke.ctrlKey && !ke.metaKey;
			const isPasteKey = ke.keyCode === KeyCode.KeyV && cmdOrCtrlKey && !ke.shiftKey && !ke.altKey;

			if (isPasteKey) {
				ke.preventDefault();
				ke.stopPropagation();

				const clipboardText = await services.clipboardService.readText();
				if (clipboardText) {
					const start = input.selectionStart ?? 0;
					const end = input.selectionEnd ?? 0;
					const before = input.value.substring(0, start);
					const after = input.value.substring(end);
					input.value = before + clipboardText + after;

					const newCursorPosition = start + clipboardText.length;
					input.selectionStart = newCursorPosition;
					input.selectionEnd = newCursorPosition;
				}
			}
		};

		// Use capture phase (true) to intercept before VS Code's keybinding system.
		input.addEventListener('keydown', handlePasteKeydown, true);

		return () => {
			input.removeEventListener('keydown', handlePasteKeydown, true);
		};
	}, [isPassword, isUnanswered, services.clipboardService]);

	// Handle onFocusInput events from the console instance.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(props.positronConsoleInstance.onFocusInput(() => {
			focusInput();
		}));

		return () => disposableStore.dispose();
	}, [props.positronConsoleInstance, focusInput]);

	/**
	 * Password input keydown handler.
	 * @param e A KeyboardEvent that describes a user interaction with the keyboard.
	 */
	const passwordKeyDownHandler = (e: KeyboardEvent<HTMLInputElement>) => {
		const ke = new StandardKeyboardEvent(e.nativeEvent);

		// Enter key - submit the prompt.
		if (ke.keyCode === KeyCode.Enter && !ke.ctrlKey && !ke.metaKey && !ke.shiftKey && !ke.altKey) {
			ke.preventDefault();
			ke.stopPropagation();
			props.positronConsoleInstance.replyToPrompt(passwordInputRef.current?.value ?? '');
			return;
		}

		// Ctrl+C - interrupt the runtime.
		if (ke.keyCode === KeyCode.KeyC && ke.ctrlKey && !ke.metaKey && !ke.shiftKey && !ke.altKey) {
			ke.preventDefault();
			ke.stopPropagation();
			props.positronConsoleInstance.interrupt();
			return;
		}
	};

	// Determine what to render based on prompt state.
	let prompt;
	switch (props.activityItemPrompt.state) {
		// When the prompt is unanswered, render the appropriate input.
		case ActivityItemPromptState.Unanswered:
			if (isPassword) {
				// Use HTML input for password prompts to get native masking.
				prompt = (
					<input
						ref={passwordInputRef}
						className='input-field'
						type='password'
						onKeyDown={passwordKeyDownHandler}
						onMouseDown={(e) => e.stopPropagation()}
					/>
				);
			} else {
				// Use CodeEditorWidget for regular prompts.
				prompt = (
					<div
						ref={editorContainerRef}
						className='editor-input-container'
					/>
				);
			}
			break;

		// When the prompt was answered, render the answer (unless it was a password).
		case ActivityItemPromptState.Answered:
			prompt = props.activityItemPrompt.password ?
				null :
				<span>{props.activityItemPrompt.answer}</span>;
			break;

		// When the prompt was interrupted, render nothing.
		case ActivityItemPromptState.Interrupted:
			prompt = null;
			break;
	}

	// Render.
	return (
		<div className='activity-prompt'>
			<ConsoleOutputLines outputLines={props.activityItemPrompt.outputLines.slice(0, -1)} />
			<div className='prompt-line'>
				{props.activityItemPrompt.outputLines.slice(-1).map(outputLine =>
					outputLine.outputRuns.map(outputRun =>
						<OutputRun key={outputRun.id} outputRun={outputRun} />
					)
				)}
				{prompt}
			</div>
		</div>
	);
};

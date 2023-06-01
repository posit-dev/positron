/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleInput';
import * as React from 'react';
import { FocusEvent, forwardRef, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { KeyCode } from 'vs/base/common/keyCodes';
import { generateUuid } from 'vs/base/common/uuid';
import { isMacintosh } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { HistoryNavigator2 } from 'vs/base/common/history';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { ModesHoverController } from 'vs/editor/contrib/hover/browser/hover';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { MarkerController } from 'vs/editor/contrib/gotoError/browser/gotoError';
import { SuggestController } from 'vs/editor/contrib/suggest/browser/suggestController';
import { SnippetController2 } from 'vs/editor/contrib/snippet/browser/snippetController2';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/browser/contextmenu';
import { TabCompletionController } from 'vs/workbench/contrib/snippets/browser/tabCompletion';
import { IInputHistoryEntry } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { IPositronConsoleInstance, PositronConsoleState } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';
import { RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleInputProps interface.
export interface ConsoleInputProps {
	readonly width: number;
	readonly positronConsoleInstance: IPositronConsoleInstance;
	selectAll: () => void;
}

/**
 * ConsoleInput component.
 * @param props A ConsoleInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleInput = forwardRef<HTMLDivElement, ConsoleInputProps>((props: ConsoleInputProps, consoleInputRef) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const codeEditorWidgetContainerRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [, setCodeEditorWidget, codeEditorWidgetRef] = useStateRef<CodeEditorWidget>(undefined!);
	const [, setCodeEditorWidth, codeEditorWidthRef] = useStateRef(props.width);
	const [, setHistoryNavigator, historyNavigatorRef] =
		useStateRef<HistoryNavigator2<IInputHistoryEntry> | undefined>(undefined);
	const [, setCurrentCodeFragment, currentCodeFragmentRef] =
		useStateRef<string | undefined>(undefined);

	/**
	 * Updates the code editor widget position such that the cursor appers on the first line and the
	 * first column.
	 */
	const updateCodeEditorWidgetPositionToBeginning = () => {
		// Set the code editor widget position.
		codeEditorWidgetRef.current.setPosition({
			lineNumber: 1,
			column: 1
		});

		// Ensure that the code editor widget is scrolled into view.
		codeEditorWidgetContainerRef.current?.scrollIntoView({ behavior: 'auto' });
	};

	/**
	 * Updates the code editor widget position such that the cursor appers on the last line and the
	 * last column.
	 */
	const updateCodeEditorWidgetPositionToEnd = () => {
		// Get the model. If it isn't null (which it won't be), set the code editor widget position.
		const textModel = codeEditorWidgetRef.current.getModel();
		if (textModel) {
			const lineNumber = textModel.getLineCount();
			const column = textModel.getLineMaxColumn(lineNumber);
			codeEditorWidgetRef.current.setPosition({
				lineNumber,
				column
			});

			// Ensure that the code editor widget is scrolled into view.
			codeEditorWidgetContainerRef.current?.scrollIntoView({ behavior: 'auto' });
		}
	};

	/**
	 * Executes the code editor widget's code, if possible.
	 */
	const executeCodeEditorWidgetCodeIfPossible = async () => {
		// Get the code fragment from the code editor widget.
		const codeFragment = codeEditorWidgetRef.current.getValue();

		// Check on whether the code fragment is complete and can be executed.
		const runtimeCodeFragmentStatus = await props.positronConsoleInstance.runtime.
			isCodeFragmentComplete(codeFragment);

		// Handle the runtime code fragment status.
		switch (runtimeCodeFragmentStatus) {
			// If the code fragment is complete, execute it.
			case RuntimeCodeFragmentStatus.Complete:
				break;

			// If the code fragment is incomplete, don't do anything. The user will just see a new
			// line in the input area.
			case RuntimeCodeFragmentStatus.Incomplete: {
				// For the moment, this works. Ideally, we'd like to have the current code fragment
				// prettied up by the runtime and updated.
				const updatedCodeFragment = codeFragment + '\n';
				setCurrentCodeFragment(updatedCodeFragment);
				codeEditorWidgetRef.current.setValue(updatedCodeFragment);
				updateCodeEditorWidgetPositionToEnd();
				return;
			}

			// If the code fragment is invalid (contains syntax errors), log a warning but execute
			// it anyway (so the user can see a syntax error from the interpreter).
			case RuntimeCodeFragmentStatus.Invalid:
				positronConsoleContext.logService.warn(
					`Executing invalid code fragment: '${codeFragment}'`
				);
				break;

			// If the code gragment status is unknown, log a warning but execute it anyway (so the
			// user can see an error from the interpreter).
			case RuntimeCodeFragmentStatus.Unknown:
				positronConsoleContext.logService.warn(
					`Could not determine whether code fragment: '${codeFragment}' is complete.`
				);
				break;
		}

		// If the code fragment isn't just whitespace characters, add it to the history navigator.
		if (codeFragment.trim().length) {
			// Create the input history entry.
			const inputHistoryEntry = {
				when: new Date().getTime(),
				input: codeFragment,
			} satisfies IInputHistoryEntry;

			// Add the input history entry.
			if (historyNavigatorRef.current) {
				historyNavigatorRef.current.add(inputHistoryEntry);
			} else {
				// TODO@softwarenerd - Get 1000 from settings.
				setHistoryNavigator(new HistoryNavigator2<IInputHistoryEntry>(
					[inputHistoryEntry],
					1000
				));
			}
		}

		// Ask the runtime to execute the code fragment. This is an asynchronous and unwaitable.
		props.positronConsoleInstance.runtime.execute(
			codeFragment,
			`fragment-${generateUuid()}`,
			RuntimeCodeExecutionMode.Interactive,
			RuntimeErrorBehavior.Continue);

		// Reset the code input state.
		setCurrentCodeFragment(undefined);
		codeEditorWidgetRef.current.setValue('');
	};

	// Memoize the key down event handler.
	const keyDownHandler = async (e: IKeyboardEvent) => {
		/**
		 * Consumes an event.
		 */
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Check for a suggest widget in the DOM. If one exists, then don't
		// handle the key.
		//
		// TODO(Kevin): Ideally, we'd do this by checking the
		// 'suggestWidgetVisible' context key, but the way VSCode handles
		// 'scoped' contexts makes that challenging to access here, and I
		// haven't figured out the 'right' way to get access to those contexts.
		const suggestWidgets = document.getElementsByClassName('suggest-widget');
		for (const suggestWidget of suggestWidgets) {
			if (suggestWidget.classList.contains('visible')) {
				return;
			}
		}

		// Process the key code.
		switch (e.keyCode) {
			// Escape handling.
			case KeyCode.Escape: {
				// Consume the event.
				consumeEvent();

				// Interrupt the runtime.
				props.positronConsoleInstance.runtime.interrupt();
				break;
			}

			// Ctrl-A handling.
			case KeyCode.KeyA: {
				// Determine whether the cmd or ctrl key is pressed.
				const cmdOrCtrlKey = isMacintosh ? e.metaKey : e.ctrlKey;

				// If the cmd or ctrl key is pressed, see if the user wants to select all.
				if (cmdOrCtrlKey) {
					// Get the code fragment from the code editor widget.
					const codeFragment = codeEditorWidgetRef.current.getValue();

					// If there is no code in the code editor widget, call the select all callback
					// to select all output.
					if (!codeFragment.length) {
						// Consume the event.
						consumeEvent();

						// Call the select all callback.
						props.selectAll();
					}

					// Get the selection and the text model.
					const selection = codeEditorWidgetRef.current.getSelection();
					const textModel = codeEditorWidgetRef.current.getModel();
					if (selection && textModel) {
						// If the full model range is not already selected, select it.
						const fullModelRange = textModel.getFullModelRange();
						if (!selection.equalsRange(fullModelRange)) {
							codeEditorWidgetRef.current.setSelection(fullModelRange);
						}

						// Consume the event.
						consumeEvent();
					}
				}
				break;
			}

			// Ctrl-C handling.
			case KeyCode.KeyC: {
				// Check for the right modifiers and if this is a Ctrl-C, interrupt the runtime.
				if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
					// Consume the event.
					consumeEvent();

					// Interrupt the runtime.
					props.positronConsoleInstance.runtime.interrupt();
				}
				break;
			}

			// Up arrow processing.
			case KeyCode.UpArrow: {
				// Get the position. If it's at line number 1, allow backward history navigation.
				const position = codeEditorWidgetRef.current.getPosition();
				if (position?.lineNumber === 1) {
					// Consume the event.
					consumeEvent();

					// If the console instance isn't ready, do not navigate.
					if (props.positronConsoleInstance.state !== PositronConsoleState.Ready) {
						return;
					}

					// If there are history entries, process the event.
					if (historyNavigatorRef.current) {
						// When the user moves up from the end, and we don't have a current code editor
						// fragment, set the current code fragment. Otherwise, move to the previous
						// entry.
						if (historyNavigatorRef.current.isAtEnd() &&
							currentCodeFragmentRef.current === undefined) {
							setCurrentCodeFragment(codeEditorWidgetRef.current.getValue());
						} else {
							historyNavigatorRef.current.previous();
						}

						// Get the current history entry, set it as the value of the code editor widget.
						const inputHistoryEntry = historyNavigatorRef.current.current();
						codeEditorWidgetRef.current.setValue(inputHistoryEntry.input);

						// Position the code editor widget.
						updateCodeEditorWidgetPositionToBeginning();
					}
				}
				break;
			}

			// Down arrow processing.
			case KeyCode.DownArrow: {
				// Get the position and text model. If it's on the last line, allow forward history
				// navigation.
				const position = codeEditorWidgetRef.current.getPosition();
				const textModel = codeEditorWidgetRef.current.getModel();
				if (position?.lineNumber === textModel?.getLineCount()) {
					// Consume the event.
					consumeEvent();

					// If the console instance isn't ready, do not navigate.
					if (props.positronConsoleInstance.state !== PositronConsoleState.Ready) {
						return;
					}

					// If there are history entries, process the event.
					if (historyNavigatorRef.current) {
						// When the user reaches the end of the history entries, restore the current
						// code fragment.
						if (historyNavigatorRef.current.isAtEnd()) {
							if (currentCodeFragmentRef.current !== undefined) {
								console.log(`Restoring fragment "${currentCodeFragmentRef.current}"`);
								codeEditorWidgetRef.current.setValue(currentCodeFragmentRef.current);
								setCurrentCodeFragment(undefined);
							}
						} else {
							// Move to the next history entry and set it as the value of the code editor
							// widget.
							const inputHistoryEntry = historyNavigatorRef.current.next();
							codeEditorWidgetRef.current.setValue(inputHistoryEntry.input);
						}

						// Position the code editor widget.
						updateCodeEditorWidgetPositionToEnd();
					}
				}
				break;
			}

			// Enter processing.
			case KeyCode.Enter: {
				// Consume the event.
				consumeEvent();

				// If the shift key is pressed, do not process the event because the user is
				// entering multiple lines.
				if (e.shiftKey) {
					codeEditorWidgetRef.current.setValue(
						codeEditorWidgetRef.current.getValue() + '\n'
					);
					updateCodeEditorWidgetPositionToEnd();
					return;
				}

				// If the console instance isn't ready, ignore the event.
				if (props.positronConsoleInstance.state !== PositronConsoleState.Ready) {
					return;
				}

				// Try to execute the code editor widget's code.
				await executeCodeEditorWidgetCodeIfPossible();
				break;
			}
		}
	};

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Build the history entries, if there is input history.
		const inputHistoryEntries = positronConsoleContext.executionHistoryService.getInputEntries(
			props.positronConsoleInstance.runtime.metadata.languageId
		);
		if (inputHistoryEntries.length) {
			// console.log(`There are input history entries for ${props.positronConsoleInstance.runtime.metadata.languageId}`);
			// inputHistoryEntries.forEach((inputHistoryEntry, index) => {
			// 	console.log(`    Entry: ${index} Code: ${inputHistoryEntry.input}`);
			// });

			// TODO@softwarenerd - Get 1000 from settings.
			setHistoryNavigator(new HistoryNavigator2<IInputHistoryEntry>(inputHistoryEntries.slice(-1000), 1000));
		}

		// Create the resource URI.
		const uri = URI.from({
			scheme: Schemas.inMemory,
			path: `/repl-${props.positronConsoleInstance.runtime.metadata.languageId}-${generateUuid()}`
		});

		// Create language selection.
		const languageSelection = positronConsoleContext.
			languageService.
			createById(props.positronConsoleInstance.runtime.metadata.languageId);

		// Create text model; this is the backing store for the Monaco editor that receives
		// the user's input.
		const textModel = positronConsoleContext.modelService.createModel(
			'',					// initial value
			languageSelection,  // language selection
			uri,          		// resource URI
			false               // this widget is not simple
		);

		// Line numbers functions.
		const notReadyLineNumbers = (n: number) => '';
		const readyLineNumbers = (n: number) => {
			// Render the input prompt for the first line; do not render
			// anything in the margin for following lines
			if (n < 2) {
				return props.positronConsoleInstance.runtime.metadata.inputPrompt;
			} else {
				return props.positronConsoleInstance.runtime.metadata.continuationPrompt;
			}
		};

		// The editor options we override.
		const editorOptions = {
			lineNumbers: readyLineNumbers,
			readOnly: false,
			minimap: {
				enabled: false
			},
			glyphMargin: false,
			folding: false,
			lineDecorationsWidth: '1.0ch',
			renderLineHighlight: 'none',
			wordWrap: 'bounded',
			wordWrapColumn: 2048,
			scrollbar: {
				vertical: 'hidden',
				useShadows: false
			},
			overviewRulerLanes: 0,
			scrollBeyondLastLine: false,
			lineNumbersMinChars: props.positronConsoleInstance.runtime.metadata.inputPrompt.length
		} satisfies IEditorOptions;

		// Create the code editor widget.
		const codeEditorWidget = positronConsoleContext.instantiationService.createInstance(
			CodeEditorWidget,
			codeEditorWidgetContainerRef.current,
			{
				...positronConsoleContext.configurationService.getValue<IEditorOptions>('editor'),
				...editorOptions
			},
			{
				isSimpleWidget: false,
				contributions: EditorExtensionsRegistry.getSomeEditorContributions([
					SelectionClipboardContributionID,
					ContextMenuController.ID,
					SuggestController.ID,
					SnippetController2.ID,
					TabCompletionController.ID,
					ModesHoverController.ID,
					MarkerController.ID,
				])
			});

		// Add the code editor widget to the disposables store.
		disposableStore.add(codeEditorWidget);
		setCodeEditorWidget(codeEditorWidget);

		// Attach the text model.
		codeEditorWidget.setModel(textModel);

		// Set the key down event handler.
		disposableStore.add(codeEditorWidget.onKeyDown(keyDownHandler));

		// Auto-grow the editor as the internal content size changes (i.e. make it grow vertically
		// as the user enters additional lines of input.)
		disposableStore.add(codeEditorWidget.onDidContentSizeChange(contentSizeChangedEvent => {
			codeEditorWidget.layout({
				width: codeEditorWidthRef.current,
				height: codeEditorWidget.getContentHeight()
			});
		}));

		// Set the paste event handler.
		disposableStore.add(codeEditorWidget.onDidPaste(e => {
			// On paste, make sure the code editor widget is positioned to the end so everything
			// that was pasted is visible.
			updateCodeEditorWidgetPositionToEnd();
		}));

		// [Preserving this comment for later use...]
		// Forward mouse wheel events. We do this because it is not currently
		// possible to prevent the editor from trapping scroll events, so
		// instead we use this handle to forward the scroll events to the outer
		// scrollable region (consisting of all REPL cells)
		// this.onMouseWheel = this._editor.onMouseWheel;

		// Perform the initial layout.
		codeEditorWidget.layout();

		// Add the onDidChangeActivePositronConsoleInstance event handler.
		disposableStore.add(
			positronConsoleContext.positronConsoleService.onDidChangeActivePositronConsoleInstance(
				positronConsoleInstance => {
					if (positronConsoleInstance === props.positronConsoleInstance) {
						codeEditorWidget.focus();
					}
				}));

		// Add the onDidChangeConfiguration event handler.
		disposableStore.add(
			positronConsoleContext.configurationService.onDidChangeConfiguration(
				configurationChangeEvent => {
					if (configurationChangeEvent.affectsConfiguration('editor')) {
						codeEditorWidget.updateOptions({
							...positronConsoleContext.configurationService.
								getValue<IEditorOptions>('editor'),
							...editorOptions
						});
					}
				})
		);

		// Add the onDidChangeState event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeState(state => {
			// Set up editor options based on state.
			let lineNumbers;
			let readOnly;
			switch (state) {
				// When uninitialized or starting, switch to a read only normal prompt so it looks
				// right, but no typeahead is allowed.
				case PositronConsoleState.Uninitialized:
				case PositronConsoleState.Starting:
					readOnly = true;
					lineNumbers = readyLineNumbers;
					break;

				// When ready, switch to an active normal prompt.
				case PositronConsoleState.Ready:
					readOnly = false;
					lineNumbers = readyLineNumbers;
					break;

				// In any other state, don't display the normal prompt, but allow typeahead.
				default:
					readOnly = false;
					lineNumbers = notReadyLineNumbers;
			}

			// Update the code editor widget options.
			codeEditorWidget.updateOptions({
				...editorOptions,
				readOnly,
				lineNumbers
			});
		}));

		// Add the onDidClearConsole event handler.
		disposableStore.add(props.positronConsoleInstance.onDidClearConsole(() => {
			// When the console is cleared, erase anything that was partially entered.
			textModel.setValue('');

			// Re-focus the console.
			codeEditorWidget.focus();
		}));

		// Add the onDidClearInputHistory event handler.
		disposableStore.add(props.positronConsoleInstance.onDidClearInputHistory(() => {
			// Discard the history navigator.
			setHistoryNavigator(undefined);

			// Re-focus the console.
			codeEditorWidget.focus();
		}));

		// Add the onDidExecuteCode event handler.
		disposableStore.add(props.positronConsoleInstance.onDidExecuteCode(async codeFragment => {
			// Get the current code fragment.
			const currentCodeFragment = codeEditorWidgetRef.current.getValue();

			// If there is a current code fragment, append the new code fragment on a new line.
			if (currentCodeFragment.length) {
				codeFragment = `${currentCodeFragment}${codeFragment}`;
			}

			// Update the current code fragment.
			setCurrentCodeFragment(codeFragment);
			codeEditorWidgetRef.current.setValue(codeFragment);

			// Try to execute the code.
			await executeCodeEditorWidgetCodeIfPossible();
		}));

		// Focus the console.
		codeEditorWidget.focus();

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	// Experimental.
	useEffect(() => {
		if (codeEditorWidgetRef.current) {
			setCodeEditorWidth(props.width);
			codeEditorWidgetRef.current.layout({
				width: props.width,
				height: codeEditorWidgetRef.current.getContentHeight()
			});
		}
	}, [props.width]);

	/**
	 * onFocus event handler.
	 * @param e A FocusEvent<HTMLDivElement, Element> that contains the event data.
	 */
	const focusHandler = (e: FocusEvent<HTMLDivElement, Element>) => {
		// Drive focus into the code editor widget.
		if (codeEditorWidgetRef.current) {
			codeEditorWidgetRef.current.focus();
		}
	};

	// Render.
	return (
		<div ref={consoleInputRef} className='console-input' tabIndex={0} onFocus={focusHandler}>
			<div ref={codeEditorWidgetContainerRef} />
		</div>
	);
});

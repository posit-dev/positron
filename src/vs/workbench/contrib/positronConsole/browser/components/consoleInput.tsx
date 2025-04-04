/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInput.css';

// React.
import React, { FocusEvent, useEffect, useLayoutEffect, useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { URI } from '../../../../../base/common/uri.js';
import { Schemas } from '../../../../../base/common/network.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { HistoryNavigator2 } from '../../../../../base/common/history.js';
import { ISelection } from '../../../../../editor/common/core/selection.js';
import { IKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import { CursorChangeReason } from '../../../../../editor/common/cursorEvents.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { InQuickPickContextKey } from '../../../../browser/quickaccess.js';
import { FormatOnType } from '../../../../../editor/contrib/format/browser/formatActions.js';
import { EditorExtensionsRegistry } from '../../../../../editor/browser/editorExtensions.js';
import { MarkerController } from '../../../../../editor/contrib/gotoError/browser/gotoError.js';
import { IEditorOptions, LineNumbersType } from '../../../../../editor/common/config/editorOptions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { SuggestController } from '../../../../../editor/contrib/suggest/browser/suggestController.js';
import { SnippetController2 } from '../../../../../editor/contrib/snippet/browser/snippetController2.js';
import { ContextMenuController } from '../../../../../editor/contrib/contextmenu/browser/contextmenu.js';
import { EditOperation, ISingleEditOperation } from '../../../../../editor/common/core/editOperation.js';
import { TabCompletionController } from '../../../snippets/browser/tabCompletion.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { ParameterHintsController } from '../../../../../editor/contrib/parameterHints/browser/parameterHints.js';
import { SelectionClipboardContributionID } from '../../../codeEditor/browser/selectionClipboard.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { HistoryBrowserPopup } from './historyBrowserPopup.js';
import { HistoryInfixMatchStrategy } from '../../common/historyInfixMatchStrategy.js';
import { HistoryPrefixMatchStrategy } from '../../common/historyPrefixMatchStrategy.js';
import { EmptyHistoryMatchStrategy, HistoryMatch, HistoryMatchStrategy } from '../../common/historyMatchStrategy.js';
import { CodeAttributionSource, IConsoleCodeAttribution, IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ContentHoverController } from '../../../../../editor/contrib/hover/browser/contentHoverController.js';
import { IInputHistoryEntry } from '../../../../services/positronHistory/common/executionHistoryService.js';

// Position enumeration.
const enum Position {
	First,
	Last
}

// Utility type for just the line numbers options from IEditorOptions.
type ILineNumbersOptions = Pick<IEditorOptions, 'lineNumbers' | 'lineNumbersMinChars'>;

// ConsoleInputProps interface.
interface ConsoleInputProps {
	readonly width: number;
	readonly hidden: boolean;
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly onSelectAll: () => void;
	readonly onCodeExecuted: () => void;
}

/**
 * ConsoleInput component.
 * @param props A ConsoleInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleInput = (props: ConsoleInputProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const codeEditorWidgetContainerRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [, setCodeEditorWidget, codeEditorWidgetRef] = useStateRef<CodeEditorWidget>(undefined!);
	const [, setCodeEditorWidth, codeEditorWidthRef] = useStateRef(props.width);
	const [historyBrowserActive, setHistoryBrowserActive, historyBrowserActiveRef] = useStateRef(false);
	const [historyBrowserSelectedIndex, setHistoryBrowserSelectedIndex, historyBrowserSelectedIndexRef] = useStateRef(0);
	const [, setHistoryMatchStrategy, historyMatchStrategyRef] = useStateRef<HistoryMatchStrategy>(new EmptyHistoryMatchStrategy());
	const [historyItems, setHistoryItems, historyItemsRef] = useStateRef<HistoryMatch[]>([]);
	const [, setSupressCompletions, suppressCompletionsRef] = useStateRef<IDisposable | undefined>(undefined);
	const [, setHistoryNavigator, historyNavigatorRef] =
		useStateRef<HistoryNavigator2<IInputHistoryEntry> | undefined>(undefined);
	const [, setCurrentCodeFragment, currentCodeFragmentRef] =
		useStateRef<string | undefined>(undefined);
	const shouldExecuteOnStartRef = useRef(false);

	/**
	 * Determines whether it is OK to take focus.
	 * @returns true if it is OK to take focus; otherwise, false.
	 */
	const okToTakeFocus = () => {
		// https://github.com/posit-dev/positron/issues/2802
		// It's only OK to take focus if there is no focused editor. This avoids stealing focus when
		// the user could be actively working in an editor.

		// Get the context key service context.
		const contextKeyContext = positronConsoleContext.contextKeyService.getContext(
			DOM.getActiveElement()
		);

		// Sensitive to all editor contexts, simple (e.g. git commit textbox) or not (e.g. code
		// editor).
		if (contextKeyContext.getValue(EditorContextKeys.textInputFocus.key)) {
			return false;
		}

		// Sensitive to all quick pick contexts, e.g. the commande palette or the file picker.
		if (contextKeyContext.getValue(InQuickPickContextKey.key)) {
			return false;
		}

		// Sensitive to terminal focus.
		if (contextKeyContext.getValue(TerminalContextKeys.focus.key)) {
			return false;
		}

		// It's OK to take focus.
		return true;
	};

	/**
	 * Updates the code editor widget position.
	 * @param linePosition The line position.
	 * @param columnPosition The column position.
	 */
	const updateCodeEditorWidgetPosition = (linePosition: Position, columnPosition: Position) => {
		// Get the model. If it isn't null (which it won't be), set the code editor widget position.
		const textModel = codeEditorWidgetRef.current.getModel();
		if (textModel) {
			// Set the line number and column.
			const lineNumber = linePosition === Position.First ?
				1 :
				textModel.getLineCount();
			const column = columnPosition === Position.First ?
				1 :
				textModel.getLineMaxColumn(lineNumber);

			// Set the code editor widget position.
			codeEditorWidgetRef.current.setPosition({ lineNumber, column });

			// Ensure that the code editor widget is scrolled into view.
			codeEditorWidgetContainerRef.current?.scrollIntoView({ behavior: 'auto' });
		}
	};

	/**
	 * Executes the code editor widget's code, if possible.
	 * @returns A Promise<boolean> that indicates whether the code was executed.
	 */
	const executeCodeEditorWidgetCodeIfPossible = async () => {
		// Get the code from the code editor widget.
		const code = codeEditorWidgetRef.current.getValue();

		// Get the session to check against.
		const session = props.positronConsoleInstance.attachedRuntimeSession;
		if (!session) {
			return false;
		}
		// Check on whether the code is complete and can be executed.
		switch (await session.isCodeFragmentComplete(code)) {
			// If the code fragment is complete, execute it.
			case RuntimeCodeFragmentStatus.Complete:
				break;

			// If the code fragment is incomplete, don't do anything. The user will just see a new
			// line in the input area.
			case RuntimeCodeFragmentStatus.Incomplete: {
				// Don't execute the code, let the code editor widget handle the key event.
				return false;
			}

			// If the code fragment is invalid (contains syntax errors), log a warning but execute
			// it anyway (so the user can see a syntax error from the interpreter).
			case RuntimeCodeFragmentStatus.Invalid:
				positronConsoleContext.logService.warn(
					`Executing invalid code fragment: '${code}'`
				);
				break;

			// If the code fragment status is unknown, log a warning but execute it anyway (so the
			// user can see an error from the interpreter).
			case RuntimeCodeFragmentStatus.Unknown:
				positronConsoleContext.logService.warn(
					`Could not determine whether code fragment: '${code}' is complete.`
				);
				break;
		}

		// Clear the current code fragment.
		setCurrentCodeFragment(undefined);

		// Clear the code editor widget's model.
		codeEditorWidgetRef.current.setValue('');

		// Immediately change the prompt to be spaces to eliminate prompt flickering.
		const promptWidth = Math.max(
			session.dynState.inputPrompt.length,
			session.dynState.continuationPrompt.length
		);
		codeEditorWidgetRef.current.updateOptions({
			lineNumbers: (_: number) => ' '.repeat(promptWidth),
			lineNumbersMinChars: promptWidth
		});

		// Execute the code.
		const attribution: IConsoleCodeAttribution = {
			source: CodeAttributionSource.Interactive
		};
		props.positronConsoleInstance.executeCode(code, attribution);

		// Render the code editor widget.
		codeEditorWidgetRef.current.render(true);

		// Call the code executed callback.
		props.onCodeExecuted();

		// Code was executed.
		return true;
	};

	/**
	 * Engages the history browser with the given match strategy.
	 *
	 * @param strategy The new history match strategy.
	 */
	const engageHistoryBrowser = (strategy: HistoryMatchStrategy) => {
		// Apply the new match strategy.
		setHistoryMatchStrategy(strategy);

		// Look for the text to the left of the cursor to match against.
		const position = codeEditorWidgetRef.current.getSelection()?.getStartPosition();
		const value = codeEditorWidgetRef.current.getValue();
		const matchText = value.substring(0, (position?.column || value.length) - 1);

		// Get the initial set of matches.
		const matches = strategy.getMatches(matchText);
		setHistoryItems(matches);

		// Update the selected index to the last (most recent) item.
		setHistoryBrowserSelectedIndex(matches.length - 1);

		// Take down the autocomplete widget, if it's up. It conflicts with (and
		// eats keyboard events intended for) the history browser.
		SuggestController.get(codeEditorWidgetRef.current)?.cancelSuggestWidget();

		// Set the suppress completions disposable. This attaches an event
		// listener to the suggestion model that immediately knocks down the
		// suggestion widget when it is displayed. We use this to suppress
		// suggestions while we are showing the history browser.
		setSupressCompletions(
			SuggestController.get(codeEditorWidgetRef.current)?.model.onDidSuggest(() => {
				SuggestController.get(codeEditorWidgetRef.current)?.cancelSuggestWidget();
			}));

		// Make the history browser active.
		setHistoryBrowserActive(true);
	};

	/**
	 * Disengages the history browser.
	 */
	const disengageHistoryBrowser = () => {
		// Restore completions.
		if (suppressCompletionsRef.current) {
			suppressCompletionsRef.current.dispose();
			setSupressCompletions(undefined);
		}

		// Make the history browser inactive.
		setHistoryBrowserActive(false);
	};

	/**
	 * Accepts an item from the history browser.
	 *
	 * @param index The index of the history item to accept.
	 */
	const acceptHistoryMatch = (index: number) => {
		// Save the selection.
		const selection = codeEditorWidgetRef.current.getSelection();

		// Set the value of the code editor widget to the selected history item.
		codeEditorWidgetRef.current.setValue(historyItemsRef.current[index].input);

		// Attempt to restore the selection.
		if (selection) {
			codeEditorWidgetRef.current.setSelection(selection);
		}

		// Dismiss the history browser.
		disengageHistoryBrowser();
	};

	/**
	 * Consumes an event.
	 */
	const consumeKbdEvent = (e: IKeyboardEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};
	const navigateHistoryUp = (e: IKeyboardEvent) => {
		// If the history browser is present, Up should select the
		// previous history item.
		if (historyBrowserActiveRef.current) {
			setHistoryBrowserSelectedIndex(Math.max(
				0, historyBrowserSelectedIndexRef.current - 1));
			consumeKbdEvent(e);
			return;
		}

		// Get the position. If it's at line number 1, allow backward history navigation.
		const position = codeEditorWidgetRef.current.getPosition();
		if (position?.lineNumber === 1) {
			// Consume the event.
			consumeKbdEvent(e);

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
				updateCodeEditorWidgetPosition(Position.First, Position.Last);
			}
		}
	};

	const navigateHistoryDown = (e: IKeyboardEvent) => {

		// Get the position and text model. If it's on the last line, allow forward history
		// navigation.
		const position = codeEditorWidgetRef.current.getPosition();
		const textModel = codeEditorWidgetRef.current.getModel();
		if (position?.lineNumber === textModel?.getLineCount()) {
			// Consume the event.
			consumeKbdEvent(e);

			// If there are history entries, process the event.
			if (historyNavigatorRef.current) {
				// When the user reaches the end of the history entries, restore the current
				// code fragment.
				if (historyNavigatorRef.current.isAtEnd()) {
					if (currentCodeFragmentRef.current !== undefined) {
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
				updateCodeEditorWidgetPosition(Position.Last, Position.Last);
			}
		}
	}

	// Key down event handler.
	const keyDownHandler = async (e: IKeyboardEvent) => {
		/**
		 * Consumes an event.
		 */
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Determine whether the cmd or ctrl key is pressed.
		const cmdOrCtrlKey = isMacintosh ? e.metaKey : e.ctrlKey;

		// Check for a suggest widget in the DOM. If one exists, then don't
		// handle the key.
		//
		// TODO(Kevin): Ideally, we'd do this by checking the
		// 'suggestWidgetVisible' context key, but the way VSCode handles
		// 'scoped' contexts makes that challenging to access here, and I
		// haven't figured out the 'right' way to get access to those contexts.
		if (!cmdOrCtrlKey) {
			const suggestWidgets = DOM.getActiveWindow().document.getElementsByClassName('suggest-widget');
			for (const suggestWidget of suggestWidgets) {
				if (suggestWidget.classList.contains('visible')) {
					return;
				}
			}
		}

		// Process the key code.
		switch (e.keyCode) {
			// Ctrl-A handling.
			case KeyCode.KeyA: {
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
						props.onSelectAll();
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
				// Check for the right modifiers and if this is a Ctrl-C, process it.
				if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
					// Consume the event.
					consumeEvent();

					/**
					 * Interrupts the runtime.
					 */
					const interruptRuntime = () => {
						const code = codeEditorWidgetRef.current.getValue();
						props.positronConsoleInstance.interrupt(code);
					};

					// On macOS, Ctrl-C always interrupts the runtime. Otherwise, Ctrl-C will either
					// copy the selection to the clipboard or interrup the runtime.
					if (isMacintosh) {
						interruptRuntime();
					} else {
						// Get the selection.
						const selection = codeEditorWidgetRef.current.getSelection();

						// If there isn't a selection, the Ctrl-C interrupts the runtime. Otherwise,
						// Ctrl-C copies the selection to the clipboard.
						if (!selection || selection.isEmpty()) {
							interruptRuntime();
						} else {
							// Get the text model and, if there is one, copy the selection value to
							// the clipboard.
							const textModel = codeEditorWidgetRef.current.getModel();
							if (textModel) {
								// Get the selection value.
								const value = textModel.getValueInRange(selection);

								// Write the selection value to the clipboard.
								await positronConsoleContext.clipboardService.writeText(value);
							}
						}
					}
				}
				break;
			}

			// Ctrl-R handling.
			case KeyCode.KeyR: {
				// When Ctrl-R is pressed, engage a reverse history search (like bash).
				if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
					const entries = new HistoryNavigator2<IInputHistoryEntry>(
						positronConsoleContext.executionHistoryService.getInputEntries(
							props.positronConsoleInstance.runtimeMetadata.languageId
						)
					)
					engageHistoryBrowser(new HistoryInfixMatchStrategy(entries));
					consumeEvent();
				}

				break;
			}

			case KeyCode.KeyU: {
				// Bind Ctrl+U to `deleteAllLeft`
				if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
					consumeEvent();
					positronConsoleContext.commandService.executeCommand('deleteAllLeft');
					break;
				}
				break;
			}

			case KeyCode.KeyP: {
				// Bind Ctrl+P to navigate history up ("Previous"). This is a GNU
				// readline keybinding.
				//
				// <C-N> and <C-P> are only bound on macOS. This is because on
				// Windows and Linux, <C-P> is the binding for opening the
				// Command Palette.
				if (isMacintosh) {
					if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
						consumeEvent();
						navigateHistoryUp(e);
						break;
					}
				}
			}

			case KeyCode.KeyN: {
				// Bind Ctrl+N to navigate history down ("Next"). This is a GNU
				// readline keybinding.
				if (isMacintosh) {
					if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
						consumeEvent();
						navigateHistoryDown(e);
						break;
					}
				}
			}

			// Tab processing.
			case KeyCode.Tab: {
				// If the history browser is active, accept the selected history entry and
				// dismiss the history browser.
				if (historyBrowserActiveRef.current) {
					acceptHistoryMatch(historyBrowserSelectedIndexRef.current);
					consumeEvent();
				}
				break;
			}

			// Up arrow processing.
			case KeyCode.UpArrow: {
				if (cmdOrCtrlKey && !historyBrowserActiveRef.current) {
					// If the cmd or ctrl key is pressed, and the history
					// browser is not up, engage the history browser with the
					// prefix match strategy. This behavior mimics RStudio.
					const entries = new HistoryNavigator2<IInputHistoryEntry>(
						positronConsoleContext.executionHistoryService.getInputEntries(
							props.positronConsoleInstance.runtimeMetadata.languageId
						)
					)
					engageHistoryBrowser(new HistoryPrefixMatchStrategy(entries));
					consumeEvent();
					break;
				} else {
					navigateHistoryUp(e);
				}
				break;
			}

			// Down arrow processing.
			case KeyCode.DownArrow: {

				// If the history browser is up, update the selected index.
				if (historyBrowserActiveRef.current) {
					setHistoryBrowserSelectedIndex(Math.min(
						historyItemsRef.current.length - 1,
						historyBrowserSelectedIndexRef.current + 1));
					consumeEvent();
					break;
				} else {
					navigateHistoryDown(e);
				}

				break;
			}

			// Bind Home key to `cursorLineStart` (same as Ctrl+A)
			case KeyCode.Home: {
				if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
					consumeEvent();
					positronConsoleContext.commandService.executeCommand('cursorLineStart');
					break;
				}
				break;
			}

			// Bind End key to `cursorLineEnd` (same as Ctrl+E)
			case KeyCode.End: {
				if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
					consumeEvent();
					positronConsoleContext.commandService.executeCommand('cursorLineEnd');
					break;
				}
				break;
			}

			// Enter processing.
			case KeyCode.Enter: {
				// If the history browser is active, accept the selected history entry and
				// dismiss the history browser.
				if (historyBrowserActiveRef.current) {
					acceptHistoryMatch(historyBrowserSelectedIndexRef.current);
					consumeEvent();
					break;
				}

				// If the shift key is pressed, do not process the event because the user is
				// entering multiple lines.
				if (e.shiftKey) {
					break;
				}

				// If the console instance isn't ready, ignore the event.
				if (props.positronConsoleInstance.state !== PositronConsoleState.Ready) {
					if (!shouldExecuteOnStartRef.current) {
						shouldExecuteOnStartRef.current = true;
					}
					break;
				}

				// Try to execute the code editor widget's code.
				// Consume the event before the await to prevent it from being handled concurrently.
				consumeEvent();
				if (!await executeCodeEditorWidgetCodeIfPossible()) {
					// The code was not executed, insert a new line.
					positronConsoleContext.commandService.executeCommand('editor.action.insertLineAfter');
				}

				break;
			}

			// Esc processing.
			case KeyCode.Escape: {
				// If the history browser is active, dismiss it.
				if (historyBrowserActiveRef.current) {
					disengageHistoryBrowser();
					consumeEvent();
					break;
				}
			}
		}
	};

	// Main useLayoutEffect hook.
	useLayoutEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Build the history entries, if there is input history. This input
		// history is used for navigating inside this session with navigation
		// keys (e.g. up, down), so it includes only the current session's
		// input.
		const inputHistoryEntries = positronConsoleContext.executionHistoryService.getSessionInputEntries(
			props.positronConsoleInstance.sessionMetadata.sessionId
		);
		if (inputHistoryEntries.length) {
			// console.log(`There are input history entries for ${props.positronConsoleInstance.runtime.metadata.languageId}`);
			// inputHistoryEntries.forEach((inputHistoryEntry, index) => {
			// 	console.log(`    Entry: ${index} Code: ${inputHistoryEntry.input}`);
			// });

			// TODO@softwarenerd - Get 1000 from settings.
			setHistoryNavigator(new HistoryNavigator2<IInputHistoryEntry>(inputHistoryEntries.slice(-1000), 1000));
		}

		/**
		 * Creates the ILineNumbersOptions from IEditorOptions for the CodeEditorWidget.
		 * @returns The ILineNumbersOptions from IEditorOptions for the CodeEditorWidget.
		 */
		const createLineNumbersOptions = (): ILineNumbersOptions => {
			const session = props.positronConsoleInstance.attachedRuntimeSession;
			if (!session) {
				return { lineNumbers: () => '', lineNumbersMinChars: 0 };
			}
			return {
				lineNumbers: ((): LineNumbersType => {
					switch (props.positronConsoleInstance.state) {
						// When uninitialized, starting, or ready, use the show prompt line numbers
						// function.
						case PositronConsoleState.Uninitialized:
						case PositronConsoleState.Starting:
						case PositronConsoleState.Ready:
							return (lineNumber: number) => lineNumber < 2 ?
								session.dynState.inputPrompt :
								session.dynState.continuationPrompt;

						// In any other state, use the hide prompt line numbers function.
						default:
							return (_lineNumber: number) => '';
					}
				})(),
				lineNumbersMinChars: Math.max(
					session.dynState.inputPrompt.length,
					session.dynState.continuationPrompt.length
				)
			};
		};

		/**
		 * Creates the full set of IEditorOptions for the CodeEditorWidget.
		 * @returns The full set of IEditorOptions for the CodeEditorWidget.
		 */
		const createEditorOptions = (): IEditorOptions => ({
			// Configured IEditorOptions.
			...positronConsoleContext.configurationService.getValue<IEditorOptions>('editor'),
			// IEditorOptions we override from their configured values.
			...{
				readOnly: false,
				minimap: {
					enabled: false
				},
				glyphMargin: false,
				folding: false,
				fixedOverflowWidgets: true,
				lineDecorationsWidth: '1.0ch',
				renderLineHighlight: 'none',
				renderFinalNewline: 'on',
				wordWrap: 'bounded',
				wordWrapColumn: 2048,
				scrollbar: {
					vertical: 'hidden',
					useShadows: false
				},
				overviewRulerLanes: 0,
				// This appears to disable the ruler.
				// https://github.com/posit-dev/positron/issues/1080
				rulers: [],
				scrollBeyondLastLine: false,
				// This appears to disable validations to address:
				// https://github.com/posit-dev/positron/issues/979
				// https://github.com/posit-dev/positron/issues/1051
				renderValidationDecorations: 'off'
			},
			// The ILineNumbersOptions.
			...createLineNumbersOptions(),
		});

		// Create the code editor widget.
		const codeEditorWidget = positronConsoleContext.instantiationService.createInstance(
			CodeEditorWidget,
			codeEditorWidgetContainerRef.current,
			createEditorOptions(),
			{
				// Make the console input's code editor widget a "simple" widget. This prevents the
				// console input's code editor widget from being the active text editor (i.e. being
				// vscode.window.activeTextEditor).
				isSimpleWidget: true,
				contributions: EditorExtensionsRegistry.getSomeEditorContributions([
					SelectionClipboardContributionID,
					ContextMenuController.ID,
					SuggestController.ID,
					SnippetController2.ID,
					TabCompletionController.ID,
					ContentHoverController.ID,
					MarkerController.ID,
					ParameterHintsController.ID,
					FormatOnType.ID,
				])
			}
		);

		// This fixes https://github.com/posit-dev/positron/issues/2281 by stopping mouse down
		// events from propagating to the ConsoleInstance, which has its own context menu that was
		// showing instead of the CodeEditorWidget's context menu.
		codeEditorWidget.onMouseDown(e => {
			e.event.stopPropagation();
		});

		// Add the code editor widget to the disposables store.
		disposableStore.add(codeEditorWidget);
		setCodeEditorWidget(codeEditorWidget);

		// Provide a reference to the code editor.
		props.positronConsoleInstance.codeEditor = codeEditorWidget;

		// Attach the text model.
		codeEditorWidget.setModel(positronConsoleContext.modelService.createModel(
			'',
			positronConsoleContext.languageService.createById(
				props.positronConsoleInstance.runtimeMetadata.languageId
			),
			URI.from({
				scheme: Schemas.inMemory,
				path: `/repl-${props.positronConsoleInstance.runtimeMetadata.languageId}-${generateUuid()}`
			}),
			false
		));

		// Add the onDidChangeConfiguration event handler.
		disposableStore.add(
			positronConsoleContext.configurationService.onDidChangeConfiguration(
				configurationChangeEvent => {
					if (configurationChangeEvent.affectsConfiguration('editor')) {
						// When the editor configuration changes, we must update ALL the options.
						// So, in this case, use createEditorOptions() to get the full set.
						codeEditorWidget.updateOptions(createEditorOptions());
					}
				}
			)
		);

		// Set the key down event handler.
		disposableStore.add(codeEditorWidget.onKeyDown(keyDownHandler));

		// Set the blur event handler.
		disposableStore.add(codeEditorWidget.onDidBlurEditorWidget(() => {
			// If the history browser is active, deactivate it.
			if (historyBrowserActiveRef.current) {
				disengageHistoryBrowser();
			}
		}));

		// Set the value change handler.
		disposableStore.add(codeEditorWidget.onDidChangeModelContent(() => {
			// If the history browser is up, update the list of history item matches with the
			// current match strategy.
			if (historyBrowserActiveRef.current) {
				const position = codeEditorWidget.getSelection()?.getStartPosition();
				const matchText = codeEditorWidget.getValue().substring(0, position?.column || 0);

				// Update the list of history item matches from the current match strategy.
				const historyItems = historyMatchStrategyRef.current.getMatches(
					matchText);
				setHistoryItems(historyItems);

				// Select the last item.
				setHistoryBrowserSelectedIndex(historyItems.length - 1);
			}
		}));

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
			updateCodeEditorWidgetPosition(Position.Last, Position.Last);
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
						// If it's OK to take focus, drive focus into the code editor widget.
						if (okToTakeFocus()) {
							codeEditorWidget.focus();
						}
					}
				}
			)
		);

		// Add the onFocusInput event handler.
		disposableStore.add(props.positronConsoleInstance.onFocusInput(() => {
			// Focus the input editor when the Console takes focus, i.e. when the
			// user clicks somewhere on the console output
			codeEditorWidget.focus();
		}));

		// Add the onDidChangeState event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeState(state => {
			// Update just the line number options.
			codeEditorWidget.updateOptions(createLineNumbersOptions());
			if (state === PositronConsoleState.Ready && shouldExecuteOnStartRef.current) {
				shouldExecuteOnStartRef.current = false;
				executeCodeEditorWidgetCodeIfPossible();
			}
		}));

		// Add the onDidPasteText event handler.
		disposableStore.add(props.positronConsoleInstance.onDidPasteText(text => {
			// Get the selections. If there are no selections, there is no model, so return.
			let selections = codeEditorWidget.getSelections();
			if (!selections || !selections.length) {
				return;
			}

			// Split the text being pasted into lines.
			const lines = text.split('\n');

			// If the number of lines being pasted is the same as the number of selections, paste
			// each line over its corresponding selection. Otherwise, paste the text being pasted
			// over all the selections.
			const edits: ISingleEditOperation[] = [];
			if (lines.length === selections.length) {
				for (let i = 0; i < lines.length; i++) {
					edits.push(EditOperation.replace(selections[i], lines[i]));
				}
			} else {
				for (const selection of selections) {
					edits.push(EditOperation.replace(selection, text));
				}
			}

			// Execute the edits.
			codeEditorWidget.executeEdits('console', edits);

			// Update the resulting selections to be empty.
			selections = codeEditorWidget.getSelections();
			if (selections && selections.length) {
				const updatedSelections: ISelection[] = [];
				for (const selection of selections) {
					updatedSelections.push(selection.setStartPosition(
						selection.endLineNumber,
						selection.endColumn
					));
				}

				// Set the updated selections.
				codeEditorWidget.setSelections(
					updatedSelections,
					'console',
					CursorChangeReason.Paste
				);
			}

			// Ensure that the code editor widget is scrolled into view.
			codeEditorWidgetContainerRef.current?.scrollIntoView({
				behavior: 'auto',
				block: 'end'
			});
		}));

		// Add the onDidClearConsole event handler.
		disposableStore.add(props.positronConsoleInstance.onDidClearConsole(() => {
			// Focus the code editor widget.
			codeEditorWidget.focus();
		}));

		// Add the onDidClearInputHistory event handler.
		disposableStore.add(props.positronConsoleInstance.onDidClearInputHistory(() => {
			// Discard the history navigator.
			setHistoryNavigator(undefined);

			// Focus the code editor widget.
			codeEditorWidget.focus();
		}));

		// Add the onDidSetPendingCode event handler.
		disposableStore.add(props.positronConsoleInstance.onDidSetPendingCode(pendingCode => {
			codeEditorWidget.setValue(pendingCode || '');
			updateCodeEditorWidgetPosition(Position.Last, Position.Last);
		}));

		// Add the onDidExecuteCode event handler.
		disposableStore.add(props.positronConsoleInstance.onDidExecuteCode(({ code, mode }) => {
			// Trim the code
			const trimmedCode = code.trim();

			// If the code isn't empty and run interactively, add it to the history.
			if (trimmedCode.length && mode === RuntimeCodeExecutionMode.Interactive) {
				// Creates an IInputHistoryEntry.
				const createInputHistoryEntry = (): IInputHistoryEntry => ({
					when: new Date().getTime(),
					input: trimmedCode,
				});

				// Add the history entry, if it's not a duplicate.
				if (!historyNavigatorRef.current) {
					setHistoryNavigator(new HistoryNavigator2<IInputHistoryEntry>(
						[createInputHistoryEntry()],
						1000
					));
				} else {
					if (historyNavigatorRef.current.last().input !== trimmedCode) {
						historyNavigatorRef.current.add(createInputHistoryEntry());
					}
				}
			}
		}));

		// Add the onDidReceiveRuntimeMessagePromptConfig event handler.
		const session = props.positronConsoleInstance.attachedRuntimeSession;
		if (session) {
			disposableStore.add(
				session.onDidReceiveRuntimeMessagePromptConfig(() => {
					// Update just the line number options.
					codeEditorWidget.updateOptions(createLineNumbersOptions());

					// Render the code editor widget.
					codeEditorWidget.render(true);
				})
			);
		}

		// If it's OK to take focus, drive focus into the code editor widget.
		if (okToTakeFocus()) {
			codeEditorWidget.focus();
		}

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
		// eslint-disable-next-line react-hooks/exhaustive-deps
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
	}, [codeEditorWidgetRef, props.width, setCodeEditorWidth]);

	/**
	 * onFocus event handler.
	 * @param e A FocusEvent<HTMLDivElement, Element> that contains the event data.
	 */
	const focusHandler = (e: FocusEvent<HTMLDivElement, Element>) => {
		// Drive focus into the code editor widget, if it doesn't already have it. Checking for
		// hasTextFocus is part of the fix for https://github.com/posit-dev/positron/issues/2281.
		// Without this check, the CodeEditorWidget's context menu is shown and immediately hidden
		// by the unnecessary call to focus.
		if (codeEditorWidgetRef.current && !codeEditorWidgetRef.current.hasTextFocus) {
			codeEditorWidgetRef.current.focus();
		}
	};

	// If it's visible, anchor the history browser to the physical location of
	// the code editor. The history browser has to have a fixed position so it
	// can pop over the rest of the UI.
	let historyBrowserBottomPx = 0;
	let historyBrowserLeftPx = 0;
	if (codeEditorWidgetRef.current && historyBrowserActive) {
		// Get the code editor's DOM node.
		const editorElement = codeEditorWidgetRef.current.getDomNode();
		if (editorElement) {
			// Try to find the actual editor scrollable element (corresponds to
			// the point past the input prompt). If it doesn't exist, use the
			// editor element.
			let anchorElement: HTMLElement | null = editorElement.querySelector('.editor-scrollable');
			if (!anchorElement) {
				anchorElement = editorElement;
			}
			const anchorElementRect = anchorElement.getBoundingClientRect();

			// Get the browser's height and subtract the anchor's top to get the bottom.
			historyBrowserBottomPx = DOM.getActiveWindow().innerHeight - anchorElementRect.top + 5;
			historyBrowserLeftPx = anchorElementRect.left - 5;
		}
	}

	// Render.
	return (
		<div className={props.hidden ? 'console-input hidden' : 'console-input'} tabIndex={0} onFocus={focusHandler}>
			<div ref={codeEditorWidgetContainerRef} />
			{historyBrowserActive &&
				<HistoryBrowserPopup
					bottomPx={historyBrowserBottomPx}
					items={historyItems}
					leftPx={historyBrowserLeftPx}
					selectedIndex={historyBrowserSelectedIndex}
					onDismissed={disengageHistoryBrowser}
					onSelected={acceptHistoryMatch} />
			}
		</div>
	);
};

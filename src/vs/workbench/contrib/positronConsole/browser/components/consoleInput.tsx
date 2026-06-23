/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInput.css';

// React.
import { FocusEvent, useEffect, useLayoutEffect, useRef } from 'react';

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
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { SuggestController } from '../../../../../editor/contrib/suggest/browser/suggestController.js';
import { SnippetController2 } from '../../../../../editor/contrib/snippet/browser/snippetController2.js';
import { ContextMenuController } from '../../../../../editor/contrib/contextmenu/browser/contextmenu.js';
import { EditOperation, ISingleEditOperation } from '../../../../../editor/common/core/editOperation.js';
import { TabCompletionController } from '../../../snippets/browser/tabCompletion.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { ParameterHintsController } from '../../../../../editor/contrib/parameterHints/browser/parameterHints.js';
import { SelectionClipboardContributionID } from '../../../codeEditor/browser/selectionClipboard.js';
import { LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { PositronConsoleInputCursorBoundary } from '../../../../common/contextkeys.js';
import { HistoryBrowserPopup } from './historyBrowserPopup.js';
import { HistoryInfixMatchStrategy } from '../../common/historyInfixMatchStrategy.js';
import { HistoryPrefixMatchStrategy } from '../../common/historyPrefixMatchStrategy.js';
import { EmptyHistoryMatchStrategy, HistoryMatch, HistoryMatchStrategy } from '../../common/historyMatchStrategy.js';
import { IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ContentHoverController } from '../../../../../editor/contrib/hover/browser/contentHoverController.js';
import { IInputHistoryEntry } from '../../../../services/positronHistory/common/executionHistoryService.js';
import { CodeAttributionSource, IConsoleCodeAttribution } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { localize } from '../../../../../nls.js';
import { createConsoleInputEditorOptions, createConsoleInputLineNumbersOptions, ILineNumbersOptions } from './consoleInputOptions.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { getForegroundDebugState, isForegroundDebugSession } from '../../../debug/common/debug.js';

// Position enumeration.
const enum Position {
	First,
	Last
}

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
	const services = usePositronReactServicesContext();

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
	const [, setDebugHistoryNavigator, debugHistoryNavigatorRef] =
		useStateRef<HistoryNavigator2<IInputHistoryEntry> | undefined>(undefined);
	const [, setCurrentCodeFragment, currentCodeFragmentRef] =
		useStateRef<string | undefined>(undefined);
	const shouldExecuteOnStartRef = useRef(false);

	/**
	 * Gets the appropriate history navigator based on whether a debug session
	 * with toolbar is active. Uses the debug navigator when a session is active
	 * with the toolbar visible, and the default navigator otherwise (including
	 * when the debug toolbar is suppressed by an extension, e.g. positron-r).
	 *
	 * @returns The appropriate HistoryNavigator2 or undefined if none exists.
	 */
	const getHistoryNavigator = () => {
		if (isForegroundDebugSession(services.contextKeyService)) {
			return debugHistoryNavigatorRef.current;
		}
		return historyNavigatorRef.current;
	};

	/**
	 * Determines whether it is OK to take focus.
	 * @returns true if it is OK to take focus; otherwise, false.
	 */
	const okToTakeFocus = () => {
		// https://github.com/posit-dev/positron/issues/2802
		// It's only OK to take focus if there is no focused editor. This avoids stealing focus when
		// the user could be actively working in an editor.

		// Get the context key service context.
		const contextKeyContext = services.contextKeyService.getContext(
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

		// Determine whether the code is complete, incomplete, invalid, or
		// unknown. We handle errors here since callers don't handle them.
		let status = RuntimeCodeFragmentStatus.Unknown;
		try {
			status = await session.isCodeFragmentComplete(code);
		} catch (err) {
			if (err instanceof Error) {
				services.notificationService.error(
					localize('positronConsole.incompleteError', 'Cannot execute code: {0} ({1})', err.name, err.message)
				);
			} else {
				services.notificationService.error(
					localize('positronConsole.incompleteUnknownError', 'Cannot execute code: {0}', JSON.stringify(err))
				);
			}
			return false;
		}

		switch (status) {
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
				services.logService.warn(
					`Executing invalid code fragment: '${code}'`
				);
				break;

			// If the code fragment status is unknown, log a warning but execute it anyway (so the
			// user can see an error from the interpreter).
			case RuntimeCodeFragmentStatus.Unknown:
				services.logService.warn(
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
	 * Navigates the history up.
	 * @param e The optional keyboard event that triggered the navigation.
	 */
	const navigateHistoryUp = (e: IKeyboardEvent | undefined = undefined) => {
		// If the history browser is present, select the previous history item.
		if (historyBrowserActiveRef.current) {
			// Select the previous history item.
			setHistoryBrowserSelectedIndex(Math.max(0, historyBrowserSelectedIndexRef.current - 1));

			// Consume the event and return.
			if (e) {
				e.preventDefault();
				e.stopPropagation();
			}
			return;
		}

		// Get the position. If it's at line number 1, allow backward history navigation.
		const position = codeEditorWidgetRef.current.getPosition();
		if (position?.lineNumber === 1) {
			// Consume the event.
			if (e) {
				e.preventDefault();
				e.stopPropagation();
			}

			// If there are history entries, process the event.
			const historyNavigator = getHistoryNavigator();
			if (historyNavigator) {
				// When the user moves up from the end, and we don't have a current code editor
				// fragment, set the current code fragment. Otherwise, move to the previous
				// entry.
				if (historyNavigator.isAtEnd() &&
					currentCodeFragmentRef.current === undefined) {
					setCurrentCodeFragment(codeEditorWidgetRef.current.getValue());
				} else {
					historyNavigator.previous();
				}

				// Get the current history entry, set it as the value of the code editor widget.
				const inputHistoryEntry = historyNavigator.current();
				codeEditorWidgetRef.current.setValue(inputHistoryEntry.input);

				// Position the code editor widget.
				updateCodeEditorWidgetPosition(Position.First, Position.Last);
			}
		}
	};

	/**
	 * Navigates the history down.
	 * @param e The optional keyboard event that triggered the navigation.
	 */
	const navigateHistoryDown = (e: IKeyboardEvent | undefined = undefined) => {
		// If the history browser is up, update the selected index.
		if (historyBrowserActiveRef.current) {
			// Select the next history item.
			setHistoryBrowserSelectedIndex(Math.min(
				historyItemsRef.current.length - 1,
				historyBrowserSelectedIndexRef.current + 1
			));

			// Consume the event and return.
			if (e) {
				e.preventDefault();
				e.stopPropagation();
			}
			return;
		}

		// Get the position and text model. If it's on the last line, allow forward history
		// navigation.
		const position = codeEditorWidgetRef.current.getPosition();
		const textModel = codeEditorWidgetRef.current.getModel();
		if (position?.lineNumber === textModel?.getLineCount()) {
			// Consume the event.
			if (e) {
				e.preventDefault();
				e.stopPropagation();
			}

			// If there are history entries, process the event.
			const historyNavigator = getHistoryNavigator();
			if (historyNavigator) {
				// When the user reaches the end of the history entries, restore the current
				// code fragment.
				if (historyNavigator.isAtEnd()) {
					if (currentCodeFragmentRef.current !== undefined) {
						codeEditorWidgetRef.current.setValue(currentCodeFragmentRef.current);
						setCurrentCodeFragment(undefined);
					}
				} else {
					// Move to the next history entry and set it as the value of the code editor
					// widget.
					const inputHistoryEntry = historyNavigator.next();
					codeEditorWidgetRef.current.setValue(inputHistoryEntry.input);
				}

				// Position the code editor widget.
				updateCodeEditorWidgetPosition(Position.Last, Position.Last);
			}
		}
	};

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
								await services.clipboardService.writeText(value);
							}
						}
					}
				}
				break;
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
					services.commandService.executeCommand('editor.action.insertLineAfter');
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
		const inputHistoryEntries = services.executionHistoryService.getSessionInputEntries(
			props.positronConsoleInstance.sessionMetadata.sessionId
		);
		if (inputHistoryEntries.length) {
			// Partition entries into default (non-debug) and debug entries.
			const entries = inputHistoryEntries.filter(
				entry => !entry.debug || entry.debug === 'inactive'
			);
			const debugEntries = inputHistoryEntries.filter(
				entry => entry.debug && entry.debug !== 'inactive'
			);

			if (entries.length) {
				setHistoryNavigator(
					new HistoryNavigator2<IInputHistoryEntry>(entries.slice(-1000), 1000)
				);
			}
			if (debugEntries.length) {
				setDebugHistoryNavigator(
					new HistoryNavigator2<IInputHistoryEntry>(debugEntries.slice(-1000), 1000)
				);
			}
		}

		// Creates the state-driven line number (prompt) options. Thin wrapper
		// over the pure builder so the prompt's visibility is recomputed only on
		// console state / prompt-config changes.
		const createLineNumbersOptions = (): ILineNumbersOptions =>
			createConsoleInputLineNumbersOptions(props.positronConsoleInstance);

		// Creates the configuration-driven editor options. Thin wrapper over the
		// pure builder; deliberately excludes line number (prompt) options.
		const createEditorOptions = (): IEditorOptions =>
			createConsoleInputEditorOptions(services.configurationService);

		// Create the code editor widget. The initial options combine the
		// configuration-driven editor options with the state-driven line number
		// (prompt) options; thereafter the two are updated independently so that
		// configuration changes cannot affect the prompt (see createEditorOptions).
		const codeEditorWidget = services.instantiationService.createInstance(
			CodeEditorWidget,
			codeEditorWidgetContainerRef.current,
			{ ...createEditorOptions(), ...createLineNumbersOptions() },
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
		disposableStore.add(codeEditorWidget.onMouseDown(e => {
			e.event.stopPropagation();
		}));

		// Add the code editor widget to the disposables store.
		disposableStore.add(codeEditorWidget);
		setCodeEditorWidget(codeEditorWidget);

		// Provide a reference to the code editor.
		props.positronConsoleInstance.codeEditor = codeEditorWidget;

		// Attach the text model. Use a different URI path prefix for
		// notebook console inputs so that the notebook LSP can match
		// them via document selectors, while the console LSP skips them.
		const languageId = props.positronConsoleInstance.runtimeMetadata.languageId;
		const isNotebook = props.positronConsoleInstance.sessionMetadata.sessionMode === LanguageRuntimeSessionMode.Notebook;
		const replPrefix = isNotebook ? 'notebook-repl' : 'repl';
		codeEditorWidget.setModel(services.modelService.createModel(
			'',
			services.languageService.createById(languageId),
			URI.from({
				scheme: Schemas.inMemory,
				path: `/${replPrefix}-${languageId}-${generateUuid()}`
			}),
			false
		));

		// Add the onDidChangeConfiguration event handler.
		disposableStore.add(
			services.configurationService.onDidChangeConfiguration(
				configurationChangeEvent => {
					if (configurationChangeEvent.affectsConfiguration('editor') || configurationChangeEvent.affectsConfiguration('console')) {
						// When the editor configuration changes, update the
						// configuration-driven editor options. This deliberately
						// does not touch the line number (prompt) options, which
						// are driven by the console state instead; see
						// createEditorOptions and issue #13925.
						codeEditorWidget.updateOptions(createEditorOptions());
					}
				}
			)
		);

		// Set the key down event handler.
		disposableStore.add(codeEditorWidget.onKeyDown(keyDownHandler));

		// Bind and maintain the cursor-boundary context key. Drives `when` clauses for
		// keybindings that should only fire when the cursor is at the top or bottom of the
		// console input (e.g. up/down history navigation), so the keybindings don't steal
		// keystrokes when the cursor is on an interior line of multi-line input.
		const cursorBoundaryContext = PositronConsoleInputCursorBoundary.bindTo(services.contextKeyService);
		const updateCursorBoundary = () => {
			const position = codeEditorWidget.getPosition();
			const lineCount = codeEditorWidget.getModel()?.getLineCount() ?? 1;
			if (!position) {
				cursorBoundaryContext.set('none');
				return;
			}
			const atTop = position.lineNumber === 1;
			const atBottom = position.lineNumber === lineCount;
			cursorBoundaryContext.set(
				atTop && atBottom ? 'both' :
					atTop ? 'top' :
						atBottom ? 'bottom' : 'none');
		};
		disposableStore.add(codeEditorWidget.onDidChangeCursorPosition(updateCursorBoundary));
		disposableStore.add(codeEditorWidget.onDidChangeModelContent(updateCursorBoundary));
		disposableStore.add(codeEditorWidget.onDidFocusEditorWidget(updateCursorBoundary));
		updateCursorBoundary();

		// Set the blur event handler.
		disposableStore.add(codeEditorWidget.onDidBlurEditorWidget(() => {
			// If the history browser is active, deactivate it.
			if (historyBrowserActiveRef.current) {
				disengageHistoryBrowser();
			}
		}));

		// Set the value change handler.
		disposableStore.add(codeEditorWidget.onDidChangeModelContent(() => {
			// When the user types into the focused input while the console is scrolled up to
			// view history, scroll the input back into view. This keeps clicking from yanking
			// the viewport (#11772) while still bringing the cursor's context into view as soon
			// as the user starts typing (#13991).
			if (props.positronConsoleInstance.scrollLocked && codeEditorWidget.hasTextFocus()) {
				codeEditorWidgetContainerRef.current?.scrollIntoView({
					behavior: 'auto',
					block: 'end'
				});
			}

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
			services.positronConsoleService.onDidChangeActivePositronConsoleInstance(
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
		disposableStore.add(props.positronConsoleInstance.onFocusInput((options) => {
			// Focus the input editor when the Console takes focus, i.e. when the
			// user clicks somewhere on the console output.
			if (options.preventScroll) {
				// Focus the editor's editable element directly so the browser does not scroll
				// it into view, preserving the user's scroll position (#11772). Typing will
				// scroll the input back into view via onDidChangeModelContent (#13991). The
				// editable element is a <textarea> or, when the EditContext API is in use (the
				// Electron default), a .native-edit-context div; both support focus options.
				const editTarget = codeEditorWidget.getDomNode()
					?.querySelector<HTMLElement>('textarea, .native-edit-context');
				if (editTarget) {
					editTarget.focus({ preventScroll: true });
				} else {
					codeEditorWidget.focus();
				}
			} else {
				codeEditorWidget.focus();
			}
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

		// Add the onDidNavigateInputHistoryDown event handler.
		disposableStore.add(props.positronConsoleInstance.onDidNavigateInputHistoryDown(() => {
			navigateHistoryDown();
			codeEditorWidget.focus();
		}));

		// Add the onDidNavigateInputHistoryUp event handler.
		disposableStore.add(props.positronConsoleInstance.onDidNavigateInputHistoryUp(e => {
			// If the history browser is not active, engage the history browser with the prefix match
			// strategy. Otherwise, navigate history up.
			if (e.usingPrefixMatch && !historyBrowserActiveRef.current) {
				const isDebugMode = isForegroundDebugSession(services.contextKeyService);
				const entries = services.executionHistoryService.getInputEntries(
					props.positronConsoleInstance.runtimeMetadata.languageId
				).filter(entry => {
					// Show debug entries when in debug mode, non-debug entries otherwise.
					const isDebugEntry = entry.debug && entry.debug !== 'inactive';
					return isDebugMode ? isDebugEntry : !isDebugEntry;
				});
				engageHistoryBrowser(new HistoryPrefixMatchStrategy(entries));
			} else {
				navigateHistoryUp();
			}

			// Focus the code editor widget.
			codeEditorWidget.focus();
		}));

		// Add the onDidEngageHistoryInfixSearch event handler.
		disposableStore.add(props.positronConsoleInstance.onDidEngageHistoryInfixSearch(() => {
			// Engage a reverse history search (like bash) using the infix match strategy.
			const isDebugMode = isForegroundDebugSession(services.contextKeyService);
			const entries = services.executionHistoryService.getInputEntries(
				props.positronConsoleInstance.runtimeMetadata.languageId
			).filter(entry => {
				// Show debug entries when in debug mode, non-debug entries otherwise.
				const isDebugEntry = entry.debug && entry.debug !== 'inactive';
				return isDebugMode ? isDebugEntry : !isDebugEntry;
			});
			engageHistoryBrowser(new HistoryInfixMatchStrategy(entries));

			// Focus the code editor widget.
			codeEditorWidget.focus();
		}));

		// Add the onDidClearInputHistory event handler.
		disposableStore.add(props.positronConsoleInstance.onDidClearInputHistory(() => {
			// Discard both history navigators.
			setHistoryNavigator(undefined);
			setDebugHistoryNavigator(undefined);

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

			// If the code isn't empty and run interactively or non-interactively, add it to the history.
			if (trimmedCode.length && (mode === RuntimeCodeExecutionMode.Interactive || mode === RuntimeCodeExecutionMode.NonInteractive)) {
				const isDebugMode = isForegroundDebugSession(services.contextKeyService);

				const createInputHistoryEntry = (): IInputHistoryEntry => ({
					when: new Date().getTime(),
					input: trimmedCode,
					debug: getForegroundDebugState(services.contextKeyService)
				});

				// Add the history entry to the appropriate navigator based on debug state.
				if (isDebugMode) {
					// Add to debug history navigator.
					if (!debugHistoryNavigatorRef.current) {
						setDebugHistoryNavigator(new HistoryNavigator2<IInputHistoryEntry>(
							[createInputHistoryEntry()],
							1000
						));
					} else {
						if (debugHistoryNavigatorRef.current.last().input !== trimmedCode) {
							debugHistoryNavigatorRef.current.add(createInputHistoryEntry());
						}
					}
				} else {
					// Add to default history navigator.
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

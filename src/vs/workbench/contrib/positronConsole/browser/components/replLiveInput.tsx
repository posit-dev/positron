/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./replLiveInput';
import * as React from 'react';
import { forwardRef, useCallback, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { KeyCode } from 'vs/base/common/keyCodes';
import { generateUuid } from 'vs/base/common/uuid';
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
import { RuntimeCodeFragmentStatus } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleInstance';

// ReplLiveInputProps interface.
export interface ReplLiveInputProps {
	hidden: boolean;
	width: number;
	executeCode: (codeFragment: string) => void;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * ReplLiveInput component.
 * @param props A ReplLiveInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ReplLiveInput = forwardRef<HTMLDivElement, ReplLiveInputProps>((props: ReplLiveInputProps, ref) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();
	const refContainer = useRef<HTMLDivElement>(undefined!);
	const [, setHistoryNavigator, refHistoryNavigator] = useStateRef<HistoryNavigator2<IInputHistoryEntry> | undefined>(undefined);
	const [, setCodeEditorWidget, refCodeEditorWidget] = useStateRef<CodeEditorWidget>(undefined!);
	const [, setCurrentCodeFragment, refCurrentCodeFragment] = useStateRef<string | undefined>(undefined);
	const [, setCodeEditorWidth, refCodeEditorWidth] = useStateRef(props.width);

	/**
	 * Updates the code editor widget position to such that the cursor
	 * appers on the last line and the last column.
	 */
	const updateCodeEditorWidgetPositionToEnd = () => {
		// Get the model. If it isn't null (which it won't be), set the code editor widget
		// position.
		const textModel = refCodeEditorWidget.current.getModel();
		if (textModel) {
			const lineNumber = textModel.getLineCount();
			refCodeEditorWidget.current.setPosition({
				lineNumber,
				column: textModel.getLineContent(lineNumber).length + 1
			});

			// Ensure that the code editor widget is scrolled into view.
			refContainer.current?.scrollIntoView({ behavior: 'auto' });
		}
	};

	// Memoize the key down event handler.
	const keyDownHandler = useCallback(async (e: IKeyboardEvent) => {
		if (e.keyCode === KeyCode.UpArrow) {
			// If there are history entries, process the event.
			if (refHistoryNavigator.current) {
				// When the user moves up from the end, and we don't have a current code editor fragment, set the current code fragment.
				if (refHistoryNavigator.current.isAtEnd() && refCurrentCodeFragment.current === undefined) {
					const codeFragment = refCodeEditorWidget.current.getValue();
					setCurrentCodeFragment(codeFragment);
				}

				// Get the current history entry, set it as the value of the code editor widget, and move to the previous entry.
				const inputHistoryEntry = refHistoryNavigator.current.current();
				refCodeEditorWidget.current.setValue(inputHistoryEntry.input);
				refHistoryNavigator.current.previous();
				updateCodeEditorWidgetPositionToEnd();
			}

			// Eat the event.
			e.preventDefault();
			e.stopPropagation();
		} else if (e.keyCode === KeyCode.DownArrow) {
			// If there are history entries, process the event.
			if (refHistoryNavigator.current) {
				// When the user reaches the end of the history entries, restore the current code fragment.
				if (refHistoryNavigator.current.isAtEnd()) {
					if (refCurrentCodeFragment.current !== undefined) {
						refCodeEditorWidget.current.setValue(refCurrentCodeFragment.current);
						//refCodeEditorWidget.current.setPosition({ lineNumber: 1, column: refCurrentCodeFragment.current.length + 1 });
						setCurrentCodeFragment(undefined);
					}
				} else {
					// Move to the next history entry and set it as the value of the code editor widget.
					const inputHistoryEntry = refHistoryNavigator.current.next();
					refCodeEditorWidget.current.setValue(inputHistoryEntry.input);
					// refCodeEditorWidget.current.setPosition({ lineNumber: 1, column: inputHistoryEntry.input.length + 1 });
				}

				updateCodeEditorWidgetPositionToEnd();
			}

			// Eat the event.
			e.preventDefault();
			e.stopPropagation();
		} else if (e.keyCode === KeyCode.Enter) {
			// If the shift key is pressed, do not process the event because the user is entering multiple lines.
			if (e.shiftKey) {
				return;
			}

			// Get the code fragment from the editor.
			const codeFragment = refCodeEditorWidget.current.getValue();

			// Check on whether the code fragment is complete and can be executed.
			let executeCode;
			const runtimeCodeFragmentStatus = await props.positronConsoleInstance.runtime.isCodeFragmentComplete(codeFragment);
			switch (runtimeCodeFragmentStatus) {
				// If the code fragment is complete, execute it.
				case RuntimeCodeFragmentStatus.Complete:
					executeCode = true;
					break;

				// If the code fragment is incomplete, don't do anything. The user will just see a new line in the input area.
				case RuntimeCodeFragmentStatus.Incomplete:
					executeCode = false;
					break;

				// If the code is invalid (contains syntax errors), warn but execute it anyway (so the user can see a syntax error from
				// the interpreter).
				case RuntimeCodeFragmentStatus.Invalid:
					positronConsoleContext.logService.warn(`Executing invalid code fragment: '${codeFragment}'`);
					executeCode = true;
					break;

				// If the code is invalid (contains syntax errors), warn but execute it anyway (so the user can see a syntax error from
				// the interpreter).
				case RuntimeCodeFragmentStatus.Unknown:
					positronConsoleContext.logService.warn(`Could not determine whether code fragment: '${codeFragment}' is complete.`);
					executeCode = true;
					break;
			}

			// If we're supposed to execute the code fragment, do it.
			if (executeCode) {
				// Execute the code fragment.
				props.executeCode(codeFragment);

				// If the code fragment contains more than whitespace characters, add it to the history navigator.
				if (codeFragment.trim().length) {
					// Create the input history entry.
					const inputHistoryEntry = {
						when: new Date().getTime(),
						input: codeFragment,
					} satisfies IInputHistoryEntry;

					// Add the input history entry.
					if (refHistoryNavigator.current) {
						refHistoryNavigator.current.add(inputHistoryEntry);
					} else {
						setHistoryNavigator(new HistoryNavigator2<IInputHistoryEntry>([inputHistoryEntry], 1000)); // TODO@softwarenerd - get 1000 from settings.
					}
				}

				// Reset the model for the next input.
				refCodeEditorWidget.current.setValue('');
			}

			// Eat the event.
			e.preventDefault();
			e.stopPropagation();
		}
	}, []);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Build the history entries, if there is input history.
		const inputHistoryEntries = positronConsoleContext.executionHistoryService.getInputEntries(props.positronConsoleInstance.runtime.metadata.languageId);
		if (inputHistoryEntries.length) {
			console.log(`There are input history entries for ${props.positronConsoleInstance.runtime.metadata.languageId}`);
			inputHistoryEntries.forEach((inputHistoryEntry, index) => {
				console.log(`    Entry: ${index} Code: ${inputHistoryEntry.input}`);
			});
			setHistoryNavigator(new HistoryNavigator2<IInputHistoryEntry>(inputHistoryEntries.slice(-1000), 1000)); // TODO@softwarenerd - get 1000 from settings.
		}

		// Create the resource URI.
		const uri = URI.from({
			scheme: Schemas.inMemory,
			path: `/repl-${props.positronConsoleInstance.runtime.metadata.languageId}-${generateUuid()}`
		});

		// Create language selection.
		const languageSelection = positronConsoleContext.languageService.createById(props.positronConsoleInstance.runtime.metadata.languageId);

		// Create text model; this is the backing store for the Monaco editor that receives
		// the user's input.
		const textModel = positronConsoleContext.modelService.createModel(
			'',					// initial value
			languageSelection,  // language selection
			uri,          		// resource URI
			false               // this widget is not simple
		);

		// Create the code editor widget.
		const codeEditorWidget = positronConsoleContext.instantiationService.createInstance(
			CodeEditorWidget,
			refContainer.current,
			{
				wordWrap: 'on',
				wordWrapColumn: 2048
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

		// Set the key down handler.
		codeEditorWidget.onKeyDown(keyDownHandler);

		// Turn off most editor chrome.
		const editorOptions: IEditorOptions = {
			lineNumbers: (n: number) => {
				// Render the prompt as > for the first line; do not render
				// anything in the margin for following lines
				if (n < 2) {
					return '>';
				}
				return '';
			},
			minimap: {
				enabled: false
			},
			glyphMargin: false,
			lineDecorationsWidth: 0,
			// overviewRuleBorder: false,		// Not part of IEditorOptions. Don't know what to do.
			// enableDropIntoEditor: false,		// Not part of IEditorOptions. Don't know what to do.
			renderLineHighlight: 'none',
			wordWrap: 'bounded',
			// renderOverviewRuler: false,		// Not part of IEditorOptions. Don't know what to do.
			scrollbar: {
				vertical: 'hidden',
				useShadows: false
			},
			overviewRulerLanes: 0,
			scrollBeyondLastLine: false,
			// handleMouseWheel: false,			// Not part of IEditorOptions. Don't know what to do.
			// alwaysConsumeMouseWheel: false,	// Not part of IEditorOptions. Don't know what to do.
			lineNumbersMinChars: 3,
		};
		codeEditorWidget.updateOptions(editorOptions);

		// Auto-grow the editor as the internal content size changes (i.e. make
		// it grow vertically as the user enters additional lines of input)
		codeEditorWidget.onDidContentSizeChange(contentSizeChangedEvent => {
			codeEditorWidget.layout({ width: refCodeEditorWidth.current, height: codeEditorWidget.getContentHeight() });
		});

		// Forward mouse wheel events. We do this because it is not currently
		// possible to prevent the editor from trapping scroll events, so
		// instead we use this handle to forward the scroll events to the outer
		// scrollable region (consisting of all REPL cells)
		// this.onMouseWheel = this._editor.onMouseWheel;

		// Perform the initial layout.
		codeEditorWidget.layout();

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

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	// Experimental.
	useEffect(() => {
		if (refCodeEditorWidget.current) {
			setCodeEditorWidth(props.width);
			refCodeEditorWidget.current.layout({ width: props.width, height: refCodeEditorWidget.current.getContentHeight() });
		}
	}, [props.width]);

	// Experimental.
	useEffect(() => {
		if (!props.hidden && refCodeEditorWidget.current && !refCodeEditorWidget.current.hasTextFocus()) {
			refCodeEditorWidget.current.focus();
		}
	}, [props.hidden]);

	// Render.
	return (
		<div ref={ref} className='repl-live-input'>
			<div ref={refContainer} className='container'></div>
		</div>
	);
});

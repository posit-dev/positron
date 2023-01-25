/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplLiveInput';
import * as React from 'react';
import { forwardRef, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { KeyCode } from 'vs/base/common/keyCodes';
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { HistoryNavigator2 } from 'vs/base/common/history';
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
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/positronConsole';
import { IInputHistoryEntry } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { RuntimeCodeFragmentStatus } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplLiveInputProps interface.
export interface ConsoleReplLiveInputProps {
	width: number;
	executingCode: boolean;
	executeCode: (codeFragment: string) => void;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * ConsoleReplLiveInput component.
 * @param props A ConsoleReplLiveInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplLiveInput = forwardRef<HTMLDivElement, ConsoleReplLiveInputProps>((props: ConsoleReplLiveInputProps, ref) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();
	const refContainer = useRef<HTMLDivElement>(undefined!);
	const [, setHistoryNavigator, refHistoryNavigator] = useStateRef<HistoryNavigator2<IInputHistoryEntry> | undefined>(undefined);
	const [codeEditorWidget, setCodeEditorWidget] = useState<CodeEditorWidget>(undefined!);
	const [, setCodeEditorWidth, refCodeEditorWidth] = useStateRef(props.width);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Debug code.
		//positronConsoleContext.executionHistoryService.clearInputEntries(props.positronConsoleInstance.runtime.metadata.languageId);

		// Build the history entries, if there is input history.
		const inputHistoryEntries = positronConsoleContext.executionHistoryService.getInputEntries(props.positronConsoleInstance.runtime.metadata.languageId);
		if (inputHistoryEntries.length) {
			setHistoryNavigator(new HistoryNavigator2<IInputHistoryEntry>(inputHistoryEntries.slice(-1000), 1000)); // TODO@softwarenerd - get 1000 from settings.
		}

		// Create the code editor widget.
		const codeEditorWidget = positronConsoleContext.instantiationService.createInstance(
			CodeEditorWidget,
			refContainer.current,
			{},
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

		// Create the resource URI.
		const uri = URI.from({
			scheme: Schemas.inMemory,
			path: `/repl-${props.positronConsoleInstance.runtime.metadata.languageId}-${generateUuid()}`
		});

		// Create language selection.
		// const languageId = positronConsoleContext.languageService.getLanguageIdByLanguageName(props.positronConsoleInstance.runtime.metadata.language);
		const languageSelection = positronConsoleContext.languageService.createById(props.positronConsoleInstance.runtime.metadata.languageId);

		// Create text model; this is the backing store for the Monaco editor that receives
		// the user's input.
		const textModel = positronConsoleContext.modelService.createModel(
			'',					// initial value
			languageSelection,  // language selection
			uri,          		// resource URI
			false               // this widget is not simple
		);

		// Attach the text model.
		codeEditorWidget.setModel(textModel);

		// Add key down handler.
		codeEditorWidget.onKeyDown(async e => {
			if (e.keyCode === KeyCode.UpArrow) {
				if (refHistoryNavigator.current) {
					// Get the current history entry.
					const inputHistoryEntry = refHistoryNavigator.current.current();
					codeEditorWidget.setValue(inputHistoryEntry.input);
					codeEditorWidget.setPosition({ lineNumber: 1, column: inputHistoryEntry.input.length + 1 });
					refHistoryNavigator.current.previous();
				}

				// Eat the event.
				e.preventDefault();
				e.stopPropagation();
			} else if (e.keyCode === KeyCode.DownArrow) {
				if (refHistoryNavigator.current) {
					if (refHistoryNavigator.current.isAtEnd()) {
						codeEditorWidget.setValue('');
						codeEditorWidget.setPosition({ lineNumber: 1, column: 1 });
					} else {
						const inputHistoryEntry = refHistoryNavigator.current.next();
						codeEditorWidget.setValue(inputHistoryEntry.input);
						codeEditorWidget.setPosition({ lineNumber: 1, column: inputHistoryEntry.input.length + 1 });
					}
				}

				// Eat the event.
				e.preventDefault();
				e.stopPropagation();
			} else if (e.keyCode === KeyCode.Enter) {
				// If the shift key is pressed, do not attempt to execute the code fragment.
				if (e.shiftKey) {
					return;
				}

				// Get the code fragment from the editor.
				const codeFragment = codeEditorWidget.getValue();

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
					// // Execute the code.
					// const id = `fragment-${generateUuid()}`;
					// props.positronConsoleInstance.runtime.execute(
					// 	codeFragment,
					// 	id,
					// 	RuntimeCodeExecutionMode.Interactive,
					// 	RuntimeErrorBehavior.Continue);

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

					props.executeCode(codeFragment);

					// Reset the model for the next input.
					textModel.setValue('');
				}

				// this._onDidSubmitInput.fire(<IReplInputSubmitEvent>{
				// 	code: this._editor.getValue(),
				// 	focus: this._editor.hasTextFocus()
				// });
			}
		});

		// Turn off most editor chrome so we can host in the REPL
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
			console.log(`codeEditorWidget.onDidContentSizeChange with content width of ${codeEditorWidget.getContentWidth()}`);
			codeEditorWidget.layout({ width: refCodeEditorWidth.current, height: codeEditorWidget.getContentHeight() });
		});

		// Forward mouse wheel events. We do this because it is not currently
		// possible to prevent the editor from trapping scroll events, so
		// instead we use this handle to forward the scroll events to the outer
		// scrollable region (consisting of all REPL cells)
		// this.onMouseWheel = this._editor.onMouseWheel;

		// Perform the initial layout.
		codeEditorWidget.layout();

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	useEffect(() => {
		setCodeEditorWidth(props.width);
		if (codeEditorWidget) {
			codeEditorWidget.layout({ width: props.width, height: codeEditorWidget.getContentHeight() });
		}
	}, [props.width]);

	// Render.
	return (
		<div ref={ref} className='console-repl-live-input'>
			<div ref={refContainer} className='container'></div>
		</div>
	);
});

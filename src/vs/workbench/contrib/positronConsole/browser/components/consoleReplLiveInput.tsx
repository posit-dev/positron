/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplLiveInput';
import * as React from 'react';
import { forwardRef, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { KeyCode } from 'vs/base/common/keyCodes';
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
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
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplLiveInputProps interface.
export interface ConsoleReplLiveInputProps {
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

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

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

		// Create the resource URI.
		const uri = URI.from({
			scheme: Schemas.inMemory,
			path: `/repl-${props.positronConsoleInstance.runtime.metadata.language}-${generateUuid()}`
		});

		// Create language selection.
		const languageId = positronConsoleContext.languageService.getLanguageIdByLanguageName(props.positronConsoleInstance.runtime.metadata.language);
		const languageSelection = positronConsoleContext.languageService.createById(languageId);

		// Create text model; this is the backing store for the Monaco editor that receives
		// the user's input.
		const textModel = positronConsoleContext.modelService.createModel('', // initial value
			languageSelection,  // language selection
			uri,          		// resource URI
			false               // this widget is not simple
		);

		// Attach the text model.
		codeEditorWidget.setModel(textModel);

		// // Ask the kernel to determine whether the code fragment is a complete expression
		// this._runtime.isCodeFragmentComplete(code).then((result) => {
		// 	if (result === RuntimeCodeFragmentStatus.Complete) {
		// 		// Code is complete; we can run it as is
		// 		this.executeCode(code);
		// 	} else if (result === RuntimeCodeFragmentStatus.Incomplete) {
		// 		// Don't do anything if the code is incomplete; the user will just see
		// 		// a new line in the input area
		// 	} else if (result === RuntimeCodeFragmentStatus.Invalid) {
		// 		// If the code is invalid (contains syntax errors), warn but
		// 		// execute it anyway (so the user can see a syntax error from
		// 		// the interpreter)
		// 		this._logService.warn(`Execute invalid code fragment '${code}'`);
		// 		this.executeCode(code);
		// 	} else if (result === RuntimeCodeFragmentStatus.Unknown) {
		// 		// If we can't determine the status, warn but execute it anyway
		// 		this._logService.warn(`Could not determine fragment completion status for '${code}'`);
		// 		this.executeCode(code);
		// 	}
		// });

		codeEditorWidget.onKeyDown(async e => {
			if (e.keyCode === KeyCode.Enter) {
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
					const id = generateUuid();
					props.positronConsoleInstance.runtime.execute(
						codeFragment,
						id,
						RuntimeCodeExecutionMode.Interactive,
						RuntimeErrorBehavior.Continue);

					// Reset the model for the next input.
					textModel.setValue('');
				}

				// this._onDidSubmitInput.fire(<IReplInputSubmitEvent>{
				// 	code: this._editor.getValue(),
				// 	focus: this._editor.hasTextFocus()
				// });
			} else if (e.keyCode === KeyCode.UpArrow) {
				//props.consoleReplInstance.positronConsoleInstance.history.
				// if (this.historyNavigate(false)) {
				// 		e.preventDefault();
				// 	e.stopPropagation();
				// }
			} else if (e.keyCode === KeyCode.DownArrow) {
				// if (this.historyNavigate(true)) {
				// 		e.preventDefault();
				// 	e.stopPropagation();
				// }
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
				return '>>';
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
		codeEditorWidget.onDidContentSizeChange((e) => {
			// Don't attempt to measure while input area is hidden
			if (refContainer.current.classList.contains('repl-editor-hidden')) {
				return;
			}

			// Measure the size of the content and host and size the editor to fit them
			const contentWidth = refContainer.current.offsetWidth;
			const contentHeight = Math.min(2000000, codeEditorWidget.getContentHeight());
			refContainer.current.style.width = `${contentWidth}px`;
			refContainer.current.style.width = `100%`;
			refContainer.current.style.height = `${contentHeight}px`;

			codeEditorWidget.layout({ width: contentWidth, height: contentHeight });
		});

		// Forward mouse wheel events. We do this because it is not currently
		// possible to prevent the editor from trapping scroll events, so
		// instead we use this handle to forward the scroll events to the outer
		// scrollable region (consisting of all REPL cells)
		// this.onMouseWheel = this._editor.onMouseWheel;

		// For now, the best want to get the editor going is this timeout.
		const startupTimeout = setTimeout(() => {
			codeEditorWidget.layout();
			codeEditorWidget.render(true);
			codeEditorWidget.focus();
		}, 500);

		// Return the cleanup function that will dispose of the disposables.
		return () => {
			clearTimeout(startupTimeout);
			disposableStore.dispose();
		};
	}, []);

	// Render.
	return (
		<div ref={ref} className='console-repl-live-input'>
			<div ref={refContainer} className='container'></div>
		</div>
	);
});

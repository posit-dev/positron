/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplLiveInput';
import * as React from 'react';
import { useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { KeyCode } from 'vs/base/common/keyCodes';
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { ModesHoverController } from 'vs/editor/contrib/hover/browser/hover';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { MarkerController } from 'vs/editor/contrib/gotoError/browser/gotoError';
import { SuggestController } from 'vs/editor/contrib/suggest/browser/suggestController';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { SnippetController2 } from 'vs/editor/contrib/snippet/browser/snippetController2';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/browser/contextmenu';
import { TabCompletionController } from 'vs/workbench/contrib/snippets/browser/tabCompletion';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { ConsoleReplInstance } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplInstance';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplLiveInputProps interface.
export interface ConsoleReplLiveInputProps {
	consoleReplInstance: ConsoleReplInstance;
}

/**
 * ConsoleReplLiveInput component.
 * @param props A ConsoleReplLiveInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplLiveInput = (props: ConsoleReplLiveInputProps) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();
	const ref = useRef<HTMLDivElement>(undefined!);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		const editorConstructionOptions: IEditorConstructionOptions = {};
		const codeEditorWidgetOptions: ICodeEditorWidgetOptions = {
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
		};

		const editor = positronConsoleContext.instantiationService.createInstance(
			CodeEditorWidget,
			ref.current,
			editorConstructionOptions,
			codeEditorWidgetOptions);
		disposableStore.add(editor);

		// Form URI for input control
		const foo = generateUuid();
		const uri = URI.from({
			scheme: Schemas.inMemory,
			path: `/repl-${props.consoleReplInstance.positronConsoleInstance.runtime.metadata.language}-${foo}`
		});

		// Create language selection.
		const languageId = positronConsoleContext.languageService.getLanguageIdByLanguageName(props.consoleReplInstance.positronConsoleInstance.runtime.metadata.language);
		const languageSelection = positronConsoleContext.languageService.createById(languageId);

		// Create text model; this is the backing store for the Monaco editor that receives
		// the user's input
		const textModel = positronConsoleContext.modelService.createModel('', // initial value
			languageSelection,  // language selection
			uri,          		// resource URI
			false               // this widget is not simple
		);

		textModel.setValue('');

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

		editor.setModel(textModel);
		editor.onKeyDown((e: IKeyboardEvent) => {
			if (e.keyCode === KeyCode.Enter) {
				const id = generateUuid();
				props.consoleReplInstance.positronConsoleInstance.runtime.execute(editor.getValue(), id, RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Continue);
				// // If the user was holding down Shift, don't submit
				// if (e.shiftKey) {
				// 	return;
				// }
				// this._onDidSubmitInput.fire(<IReplInputSubmitEvent>{
				// 	code: this._editor.getValue(),
				// 	focus: this._editor.hasTextFocus()
				// });
			} else if (e.keyCode === KeyCode.UpArrow) {
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
			// overviewRuleBorder: false,
			// enableDropIntoEditor: false,
			renderLineHighlight: 'none',
			wordWrap: 'bounded',
			// renderOverviewRuler: false,
			scrollbar: {
				vertical: 'hidden',
				useShadows: false
			},
			overviewRulerLanes: 0,
			scrollBeyondLastLine: false,
			// handleMouseWheel: false,
			// alwaysConsumeMouseWheel: false, // Note: Not currently respected in updateOptions
			lineNumbersMinChars: 3,
		};
		editor.updateOptions(editorOptions);

		// Auto-grow the editor as the internal content size changes (i.e. make
		// it grow vertically as the user enters additional lines of input)
		editor.onDidContentSizeChange((e) => {
			// Don't attempt to measure while input area is hidden
			if (ref.current.classList.contains('repl-editor-hidden')) {
				return;
			}

			// Measure the size of the content and host and size the editor to fit them
			const contentWidth = ref.current.offsetWidth;
			const contentHeight = Math.min(500, editor.getContentHeight());
			ref.current.style.width = `${contentWidth}px`;
			ref.current.style.width = `100%`;
			ref.current.style.height = `${contentHeight}px`;

			editor.layout({ width: contentWidth, height: contentHeight });
		});

		// Forward mouse wheel events. We do this because it is not currently
		// possible to prevent the editor from trapping scroll events, so
		// instead we use this handle to forward the scroll events to the outer
		// scrollable region (consisting of all REPL cells)
		// this.onMouseWheel = this._editor.onMouseWheel;

		// For now, the best want to get the editor going is this timeout.
		const startupTimeout = setTimeout(() => {
			editor.layout();
			editor.render(true);
			editor.focus();
		}, 500);

		// Return the cleanup function that will dispose of the disposables.
		return () => {
			clearTimeout(startupTimeout);
			disposableStore.dispose();
		};
	}, []);

	// Render.
	return (
		<div className='console-repl-live-input'>
			<div ref={ref} className='container'></div>
		</div>
	);
};

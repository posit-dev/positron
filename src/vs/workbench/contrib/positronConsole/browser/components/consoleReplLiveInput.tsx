/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplLiveInput';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { KeyCode } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { ModesHoverController } from 'vs/editor/contrib/hover/browser/hover';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { MarkerController } from 'vs/editor/contrib/gotoError/browser/gotoError';
// import { MenuPreventer } from 'vs/workbench/contrib/codeEditor/browser/menuPreventer';
import { SuggestController } from 'vs/editor/contrib/suggest/browser/suggestController';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { SnippetController2 } from 'vs/editor/contrib/snippet/browser/snippetController2';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/browser/contextmenu';
import { TabCompletionController } from 'vs/workbench/contrib/snippets/browser/tabCompletion';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

// ConsoleReplLiveInputProps interface.
export interface ConsoleReplLiveInputProps {
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
	const [editor, setEditor] = useState<CodeEditorWidget>(undefined!);

	useEffect(() => {
		console.log('*****************************************************************');
		console.log('*****************************************************************');
		console.log('*****************************************************************');
		console.log('*****************************************************************');
		console.log('*****************************************************************');

		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		const editorConstructionOptions: IEditorConstructionOptions = {};
		const codeEditorWidgetOptions: ICodeEditorWidgetOptions = {
			isSimpleWidget: false,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				// MenuPreventer.ID,
				SelectionClipboardContributionID,
				ContextMenuController.ID,
				SuggestController.ID,
				SnippetController2.ID,
				TabCompletionController.ID,
				ModesHoverController.ID,
				MarkerController.ID,
			])
		};

		console.log(`We are here and ref is ${ref.current}`);

		const editor = positronConsoleContext.instantiationService.createInstance(
			CodeEditorWidget,
			ref.current,
			editorConstructionOptions,
			codeEditorWidgetOptions);
		disposableStore.add(editor);

		// Form URI for input control
		const uri = URI.from({
			scheme: Schemas.inMemory,
			path: `/repl-r-1` // ${this._language}-${this._handle}
		});

		// Create language selector
		const languageId = positronConsoleContext.languageService.getLanguageIdByLanguageName('r');
		const languageSelection = positronConsoleContext.languageService.createById(languageId);

		// Create text model; this is the backing store for the Monaco editor that receives
		// the user's input
		const textModel = positronConsoleContext.modelService.createModel('', // initial value
			languageSelection,  // language selection
			uri,          		// resource URI
			false               // this widget is not simple
		);

		editor.setModel(textModel);
		editor.onKeyDown((e: IKeyboardEvent) => {
			console.log(`onKeyDown: hasTextFocus ${editor.hasTextFocus()} code: ${editor.getValue()}`);
			if (e.keyCode === KeyCode.Enter) {
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
				return '';
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
			console.log(`++++++++++++++++++++ onDidContentSizeChange was called ${e.contentWidth}x${e.contentHeight}`);

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

		setInterval(() => {
			editor.layout();
			editor.render(true);
			editor.focus();
		}, 100);

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='console-repl-live-input' onClick={() => ref.current.focus()}>
			<div ref={ref} className='container'></div>
		</div>
	);
};

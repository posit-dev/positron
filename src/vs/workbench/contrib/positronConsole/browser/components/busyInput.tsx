/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./busyInput';
import * as React from 'react';
import { forwardRef, useCallback, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { KeyCode } from 'vs/base/common/keyCodes';
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { IFocusReceiver } from 'vs/base/browser/positronReactRenderer';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { ModesHoverController } from 'vs/editor/contrib/hover/browser/hover';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { MarkerController } from 'vs/editor/contrib/gotoError/browser/gotoError';
import { SuggestController } from 'vs/editor/contrib/suggest/browser/suggestController';
import { SnippetController2 } from 'vs/editor/contrib/snippet/browser/snippetController2';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/browser/contextmenu';
import { TabCompletionController } from 'vs/workbench/contrib/snippets/browser/tabCompletion';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';

// BusyInputProps interface.
export interface BusyInputProps {
	readonly width: number;
	readonly hidden: boolean;
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly focusReceiver: IFocusReceiver;
}

/**
 * BusyInput component.
 * @param props A BusyInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const BusyInput = forwardRef<HTMLDivElement, BusyInputProps>((props: BusyInputProps, ref) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();
	const refContainer = useRef<HTMLDivElement>(undefined!);
	const [, setCodeEditorWidget, refCodeEditorWidget] = useStateRef<CodeEditorWidget>(undefined!);
	const [, setCodeEditorWidth, refCodeEditorWidth] = useStateRef(props.width);

	// Memoize the key down event handler.
	const keyDownHandler = useCallback(async (e: IKeyboardEvent) => {
		/**
		 * Eats the event.
		 */
		const eatEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Process the key code.
		switch (e.keyCode) {
			// Escape handling.
			case KeyCode.Escape: {
				// Interrupt the runtime.
				props.positronConsoleInstance.runtime.interrupt();

				// Eat the event.
				eatEvent();
				break;
			}

			// Ctrl-C handling.
			case KeyCode.KeyC: {
				// Check for the right modifiers and if this is a Ctrl-C, interrupt the runtime.
				if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.altGraphKey) {
					// Interrupt the runtime.
					props.positronConsoleInstance.runtime.interrupt();

					// Eat the event.
					eatEvent();
				}
				break;
			}
		}
	}, []);

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

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

		// The editor options we override.
		const editorOptions = {
			lineNumbers: (n: number) => {
				// Render the input prompt for the first line; do not render
				// anything in the margin for following lines
				if (n < 2) {
					return props.positronConsoleInstance.runtime.metadata.inputPrompt;
				}
				return '';
			},
			minimap: {
				enabled: false
			},
			glyphMargin: false,
			lineDecorationsWidth: 0,
			// overviewRuleBorder: false,		// Not part of IEditorOptions.
			// enableDropIntoEditor: false,		// Not part of IEditorOptions.
			renderLineHighlight: 'none',
			wordWrap: 'bounded',
			wordWrapColumn: 2048,
			// renderOverviewRuler: false,		// Not part of IEditorOptions.
			scrollbar: {
				vertical: 'hidden',
				useShadows: false
			},
			overviewRulerLanes: 0,
			scrollBeyondLastLine: false,
			// handleMouseWheel: false,			// Not part of IEditorOptions.
			// alwaysConsumeMouseWheel: false,	// Not part of IEditorOptions.
			lineNumbersMinChars: 3,
		} satisfies IEditorOptions;

		// Create the code editor widget.
		const codeEditorWidget = positronConsoleContext.instantiationService.createInstance(
			CodeEditorWidget,
			refContainer.current,
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

		// Set the key down handler.
		codeEditorWidget.onKeyDown(keyDownHandler);

		// Auto-grow the editor as the internal content size changes (i.e. make
		// it grow vertically as the user enters additional lines of input)
		codeEditorWidget.onDidContentSizeChange(contentSizeChangedEvent => {
			codeEditorWidget.layout({
				width: refCodeEditorWidth.current,
				height: codeEditorWidget.getContentHeight()
			});
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

		// Add the onDidChangeConfiguration event handler.
		disposableStore.add(
			positronConsoleContext.configurationService.onDidChangeConfiguration(configurationChangeEvent => {
				if (configurationChangeEvent.affectsConfiguration('editor')) {
					codeEditorWidget.updateOptions({
						...positronConsoleContext.configurationService.getValue<IEditorOptions>('editor'),
						...editorOptions
					});
				}
			})
		);

		// Add the onFocused event handler.
		disposableStore.add(props.focusReceiver.onFocused(() => {
			if (!props.hidden) {
				codeEditorWidget.focus();
			}
		}));

		// Focus the console.
		codeEditorWidget.focus();

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, []);

	// Experimental.
	useEffect(() => {
		if (refCodeEditorWidget.current) {
			setCodeEditorWidth(props.width);
			refCodeEditorWidget.current.layout({
				width: props.width,
				height: refCodeEditorWidget.current.getContentHeight()
			});
		}
	}, [props.width]);

	// Render.
	return (
		<div ref={ref} className='busy-input'>
			<div ref={refContainer}></div>
		</div>
	);
});

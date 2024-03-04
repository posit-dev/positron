/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleInstance';
import * as React from 'react';
import { KeyboardEvent, MouseEvent, UIEvent, useEffect, useLayoutEffect, useRef, useState, WheelEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { generateUuid } from 'vs/base/common/uuid';
import { isMacintosh } from 'vs/base/common/platform';
import { PixelRatio } from 'vs/base/browser/pixelRatio';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IAction, Separator } from 'vs/base/common/actions';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { applyFontInfo } from 'vs/editor/browser/config/domFontInfo';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { POSITRON_PLOTS_VIEW_ID } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { ConsoleInput } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInput';
import { RuntimeTrace } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeTrace';
import { RuntimeExited } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeExited';
import { RuntimeStartup } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartup';
import { RuntimeStarted } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStarted';
import { RuntimeOffline } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeOffline';
import { RuntimeItemTrace } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemTrace';
import { RuntimeStarting } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStarting';
import { RuntimeActivity } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeActivity';
import { RuntimeItemExited } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemExited';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStartup';
import { RuntimeItemStarted } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStarted';
import { RuntimeItemOffline } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemOffline';
import { RuntimeItemStarting } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStarting';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemActivity';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { RuntimeReconnected } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeReconnected';
import { RuntimePendingInput } from 'vs/workbench/contrib/positronConsole/browser/components/runtimePendingInput';
import { RuntimeRestartButton } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeRestartButton';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemReconnected';
import { RuntimeStartupFailure } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartupFailure';
import { RuntimeItemPendingInput } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemPendingInput';
import { RuntimeItemRestartButton } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemRestartButton';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { RuntimeItemStartupFailure } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemStartupFailure';
import { POSITRON_CONSOLE_COPY, POSITRON_CONSOLE_CUT, POSITRON_CONSOLE_PASTE, POSITRON_CONSOLE_SELECT_ALL } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleIdentifiers';

// ConsoleInstanceProps interface.
interface ConsoleInstanceProps {
	readonly active: boolean;
	readonly width: number;
	readonly height: number;
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * Gets the font info for the editor font.
 *
 * @param editorContainer The HTML element containing the editor, if known.
 * @param configurationService The configuration service.
 *
 * @returns The font info.
 */
const getEditorFontInfo = (
	editorContainer: HTMLElement | undefined,
	configurationService: IConfigurationService) => {

	// Get the editor options and read the font info.
	const editorOptions = configurationService.getValue<IEditorOptions>('editor');

	// Use the editor container to get the window, if it's available. Otherwise, use the active
	// window.
	const window = editorContainer ?
		DOM.getActiveWindow() :
		DOM.getWindow(editorContainer);

	return FontMeasurements.readFontInfo(
		window,
		BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.getInstance(window).value)
	);
};

/**
 * ConsoleInstance component.
 * @param props A ConsoleInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleInstance = (props: ConsoleInstanceProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const consoleInstanceRef = useRef<HTMLDivElement>(undefined!);
	const runtimeItemsRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [editorFontInfo, setEditorFontInfo] =
		useState<FontInfo>(getEditorFontInfo(undefined, positronConsoleContext.configurationService));
	const [trace, setTrace] = useState(props.positronConsoleInstance.trace);
	const [wordWrap, setWordWrap] = useState(props.positronConsoleInstance.wordWrap);
	const [marker, setMarker] = useState(generateUuid());
	const [, setLastScrollTop, lastScrollTopRef] = useStateRef(0);
	const [, setScrollLock, scrollLockRef] = useStateRef(false);
	const [, setIgnoreNextScrollEvent, ignoreNextScrollEventRef] = useStateRef(false);

	/**
	 * Gets the selection.
	 * @returns The selection or null.
	 */
	const getSelection = () => {
		// Get the selection.
		const selection = DOM.getActiveWindow().document.getSelection();
		if (selection) {
			// If the selection is outside the element, return null.
			for (let i = 0; i < selection.rangeCount; i++) {
				const range = selection.getRangeAt(i);
				if (!consoleInstanceRef.current.contains(range.commonAncestorContainer)) {
					return null;
				}
			}
		}

		// Return the selection.
		return selection;
	};

	/**
	 * Pastes text.
	 * @param text The text to paste.
	 */
	const pasteText = (text: string) => {
		// Scroll to the bottom so the pasted text will be visible.
		scrollToBottom();

		// Paste the text.
		props.positronConsoleInstance.pasteText(text);
	};

	/**
	 * Shows the context menu.
	 * @param x The x coordinate.
	 * @param y The y coordinate.
	 */
	const showContextMenu = async (x: number, y: number): Promise<void> => {
		// Get the selection and the clipboard text.
		const selection = getSelection();
		const clipboardText = await positronConsoleContext.clipboardService.readText();

		// The actions that are built below.
		const actions: IAction[] = [];

		// Add the cut action. This action is never enabled here. It exists here so that the user
		// will see a consistent set of Cut, Copy, Paste actions in this context menu and the code
		// editor widget's context menu.
		actions.push({
			id: POSITRON_CONSOLE_CUT,
			label: nls.localize('positron.console.cut', "Cut"),
			tooltip: '',
			class: undefined,
			enabled: false,
			run: () => { }
		});

		// Add the copy action.
		actions.push({
			id: POSITRON_CONSOLE_COPY,
			label: nls.localize('positron.console.copy', "Copy"),
			tooltip: '',
			class: undefined,
			enabled: selection?.type === 'Range',
			run: () => {
				// Copy the selection to the clipboard.
				if (selection) {
					positronConsoleContext.clipboardService.writeText(selection.toString());
				}
			}
		});

		// Add the paste action.
		actions.push({
			id: POSITRON_CONSOLE_PASTE,
			label: nls.localize('positron.console.paste', "Paste"),
			tooltip: '',
			class: undefined,
			enabled: clipboardText !== '',
			run: () => pasteText(clipboardText)
		});

		// Push a separator.
		actions.push(new Separator());

		// Add the select all action.
		actions.push({
			id: POSITRON_CONSOLE_SELECT_ALL,
			label: nls.localize('positron.console.selectAll', "Select All"),
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => selectAllRuntimeItems()
		});

		// Show the context menu.
		positronConsoleContext.contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({ x, y }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

	/**
	 * selectAllRuntimeItems selects all runtime items.
	 */
	const selectAllRuntimeItems = () => {
		const selection = DOM.getActiveWindow().document.getSelection();
		if (selection) {
			selection.selectAllChildren(runtimeItemsRef.current);
		}
	};

	// Main useEffect hook.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Apply the font info to the console instance.
		applyFontInfo(consoleInstanceRef.current, editorFontInfo);

		// Add the onDidChangeConfiguration event handler.
		disposableStore.add(positronConsoleContext.configurationService.onDidChangeConfiguration(
			configurationChangeEvent => {
				// When something in the editor changes, determine whether it's font-related
				// and, if it is, apply the new font info to the container.
				if (configurationChangeEvent.affectsConfiguration('editor')) {
					if (configurationChangeEvent.affectedKeys.has('editor.fontFamily') ||
						configurationChangeEvent.affectedKeys.has('editor.fontWeight') ||
						configurationChangeEvent.affectedKeys.has('editor.fontSize') ||
						configurationChangeEvent.affectedKeys.has('editor.fontLigatures') ||
						configurationChangeEvent.affectedKeys.has('editor.fontVariations') ||
						configurationChangeEvent.affectedKeys.has('editor.lineHeight') ||
						configurationChangeEvent.affectedKeys.has('editor.letterSpacing')
					) {
						// Get the font info.
						const editorFontInfo = getEditorFontInfo(
							consoleInstanceRef.current,
							positronConsoleContext.configurationService
						);

						// Set the editor font info.
						setEditorFontInfo(editorFontInfo);

						// Apply the font info to the console instance.
						applyFontInfo(consoleInstanceRef.current, editorFontInfo);
					}
				}
			}
		));

		// Add the onSaveScrollPosition event handler.
		disposableStore.add(props.reactComponentContainer.onSaveScrollPosition(() => {
			setLastScrollTop(consoleInstanceRef.current.scrollTop);
		}));

		// Add the onRestoreScrollPosition event handler.
		disposableStore.add(props.reactComponentContainer.onRestoreScrollPosition(() => {
			consoleInstanceRef.current.scrollTop = lastScrollTopRef.current;
		}));

		// Add the onDidChangeState event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeState(state => {
		}));

		// Add the onDidChangeTrace event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeTrace(trace => {
			setTrace(trace);
		}));

		// Add the onDidChangeWordWrap event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeWordWrap(wordWrap => {
			setWordWrap(wordWrap);
		}));

		// Add the onDidChangeRuntimeItems event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeRuntimeItems(() => {
			setMarker(generateUuid());
		}));

		// Add the onDidExecuteCode event handler.
		disposableStore.add(props.positronConsoleInstance.onDidExecuteCode(_code => {
			scrollVertically(consoleInstanceRef.current.scrollHeight);
		}));

		// Add the onDidSelectPlot event handler.
		disposableStore.add(props.positronConsoleInstance.onDidSelectPlot(plotId => {
			// Ensure that the Plots pane is visible.
			positronConsoleContext.viewsService.openView(POSITRON_PLOTS_VIEW_ID, false);

			// Select the plot in the Plots pane.
			positronConsoleContext.positronPlotsService.selectPlot(plotId);
		}));

		// Add the onDidRequestRestart event handler.
		disposableStore.add(props.positronConsoleInstance.onDidRequestRestart(() => {
			const session = positronConsoleContext.activePositronConsoleInstance?.session;
			if (session) {
				positronConsoleContext.runtimeSessionService.restartSession(
					session.sessionId,
					'Restart requested from activity in the Console tab');
			}
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	useLayoutEffect(() => {
		// If the view is not scroll locked, scroll to the bottom to reveal the most recent items.
		if (!scrollLockRef.current) {
			scrollVertically(consoleInstanceRef.current.scrollHeight);
		}
	}, [marker]);

	/**
	 * onClick event handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const clickHandler = (e: MouseEvent<HTMLDivElement>) => {
		const selection = getSelection();
		if (!selection || selection.type !== 'Range') {
			props.positronConsoleInstance.focusInput();
		}
	};

	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLDivElement>) => {
		/**
		 * Consumes an event.
		 */
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Determine whether the cmd or ctrl key is pressed.
		const cmdOrCtrlKey = isMacintosh ? e.metaKey : e.ctrlKey;

		// Calculates the page height.
		const pageHeight = () =>
			Math.max(
				Math.floor(consoleInstanceRef.current.clientHeight / editorFontInfo.lineHeight) - 1,
				1
			) * editorFontInfo.lineHeight;

		// Handle the key.
		if (!cmdOrCtrlKey) {
			// Handle scrolling keys.
			switch (e.code) {
				// Page up key.
				case 'PageUp':
					consumeEvent();
					setScrollLock(scrollable());
					scrollVertically(consoleInstanceRef.current.scrollTop - pageHeight());
					break;

				// Page down key.
				case 'PageDown':
					consumeEvent();
					scrollVertically(consoleInstanceRef.current.scrollTop + pageHeight());
					break;

				// Home key.
				case 'Home':
					// Consume the event, set scroll lock, and scroll to the top.
					consumeEvent();
					setScrollLock(scrollable());
					scrollVertically(0);
					break;

				// End key.
				case 'End':
					consumeEvent();
					scrollToBottom();
					break;

				// Any other key gets driven to the input.
				default: {
					scrollToBottom();
					props.positronConsoleInstance.focusInput();
					break;
				}
			}
		} else {
			// Process the key.
			switch (e.code) {
				// A key.
				case 'KeyA': {
					// Handle select all shortcut.
					if (getSelection()) {
						// Consume the event.
						consumeEvent();

						// Select all runtime items.
						selectAllRuntimeItems();
					}
					break;
				}

				// C key.
				case 'KeyC': {
					// Consume the event.
					consumeEvent();

					// Get the selection. If there is one, copy it to the clipboard.
					const selection = getSelection();
					if (selection) {
						// Copy the selection to the clipboard.
						positronConsoleContext.clipboardService.writeText(selection.toString());
					}
					break;
				}

				// V key.
				case 'KeyV': {
					// Consume the event.
					consumeEvent();

					// Paste text.
					pasteText(await positronConsoleContext.clipboardService.readText());
					break;
				}
			}
		}
	};

	/**
	 * onMouseDown event handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLDivElement>) => {
		// Show the context menu.
		if ((e.button === 0 && isMacintosh && e.ctrlKey) || e.button === 2) {
			// Do this on the next tick. Otherwise, the document selection won't be up to date.
			setTimeout(async () => await showContextMenu(e.clientX, e.clientY), 0);
			return;
		}

		// Get the selection.
		const selection = getSelection();

		// If there is a range of text selected, see of the user clicked inside of it.
		if (selection && selection.type === 'Range') {
			// Enumerate the ranges and see if the click was inside the selection.
			let insideSelection = false;
			for (let i = 0; i < selection.rangeCount && !insideSelection; i++) {
				// Get the range.
				const range = selection.getRangeAt(i);

				// Get the rects for the range and sort them from top to bottom.
				const rects = Array.from(range.getClientRects()).sort((a, b) => {
					if (a.top < b.top) {
						return -1;
					} else if (a.top > b.top) {
						return 1;
					} else {
						return 0;
					}
				});

				// Determine whether the click is inside one of the client rects. Because of layout
				// heights, we run the rects into one another, top to bottom.
				for (let j = 0; j < rects.length; j++) {
					const rect = rects[j];
					const bottom = j < rects.length - 1 ? rects[j + 1].top : rect.bottom;
					if (e.clientX >= rect.x && e.clientX <= rect.right &&
						e.clientY >= rect.y && e.clientY <= bottom) {
						insideSelection = true;
						break;
					}
				}
			}

			// If the click was inside the selection, copy the selection to the clipboard.
			if (insideSelection) {
				positronConsoleContext.clipboardService.writeText(selection.toString());
				props.positronConsoleInstance.focusInput();
				return;
			}
		}
	};

	/**
	 * onScroll event handler.
	 * @param e A UIEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const scrollHandler = (e: UIEvent<HTMLDivElement>) => {
		// If we are ignoring the next scroll event
		if (ignoreNextScrollEventRef.current) {
			setIgnoreNextScrollEvent(false);
		} else {
			// Calculate the scroll position.
			const scrollPosition = Math.abs(
				consoleInstanceRef.current.scrollHeight -
				consoleInstanceRef.current.clientHeight -
				consoleInstanceRef.current.scrollTop
			);

			// Update scroll lock.
			setScrollLock(scrollPosition >= 1);
		}
	};

	/**
	 * onWheel event handler.
	 * @param e A WheelEvent<HTMLDivElement> that describes a user interaction with the wheel.
	 */
	const wheelHandler = (e: WheelEvent<HTMLDivElement>) => {
		// Negative delta Y immediantly engages scroll lock, if the console is scrollable.
		if (e.deltaY < 0 && !scrollLockRef.current) {
			setScrollLock(scrollable());
			return;
		}
	};

	// Determines whether the console is scrollable.
	const scrollable = () =>
		consoleInstanceRef.current.scrollHeight > consoleInstanceRef.current.clientHeight;

	// Scrolls to the bottom.
	const scrollToBottom = () => {
		setScrollLock(false);
		setIgnoreNextScrollEvent(true);
		scrollVertically(consoleInstanceRef.current.scrollHeight);
	};

	// Scrolls the console vertically.
	const scrollVertically = (y: number) => {
		consoleInstanceRef.current.scrollTo(consoleInstanceRef.current.scrollLeft, y);
	};

	// Calculate the adjusted width (to account for indentation of the entire console instance).
	const adjustedWidth = props.width - 10;

	// Compute the console input width. If the vertical scrollbar is visible, subtract its width,
	// which is set to 14px in consoleInstance.css, from the adjusted width.
	let consoleInputWidth = adjustedWidth;
	if (consoleInstanceRef.current?.scrollHeight >= consoleInstanceRef.current?.clientHeight) {
		consoleInputWidth -= 14;
	}

	// Forward the console input width to the console instance.
	props.positronConsoleInstance.setWidthInChars(
		Math.floor(consoleInputWidth / editorFontInfo.spaceWidth));

	// Render.
	return (
		<div
			ref={consoleInstanceRef}
			className='console-instance'
			style={{
				width: adjustedWidth,
				height: props.height,
				whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
				zIndex: props.active ? 'auto' : -1
			}}
			onClick={clickHandler}
			onKeyDown={keyDownHandler}
			onMouseDown={mouseDownHandler}
			onWheel={wheelHandler}
			onScroll={scrollHandler}>
			<div ref={runtimeItemsRef} className='runtime-items'>
				<div className='top-spacer' />
				{props.positronConsoleInstance.runtimeItems.map(runtimeItem => {
					if (runtimeItem instanceof RuntimeItemActivity) {
						return <RuntimeActivity key={runtimeItem.id} fontInfo={editorFontInfo} runtimeItemActivity={runtimeItem} positronConsoleInstance={props.positronConsoleInstance} />;
					} else if (runtimeItem instanceof RuntimeItemPendingInput) {
						return <RuntimePendingInput key={runtimeItem.id} fontInfo={editorFontInfo} runtimeItemPendingInput={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStartup) {
						return <RuntimeStartup key={runtimeItem.id} runtimeItemStartup={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemReconnected) {
						return <RuntimeReconnected key={runtimeItem.id} runtimeItemReconnected={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStarting) {
						return <RuntimeStarting key={runtimeItem.id} runtimeItemStarting={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStarted) {
						return <RuntimeStarted key={runtimeItem.id} runtimeItemStarted={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemOffline) {
						return <RuntimeOffline key={runtimeItem.id} runtimeItemOffline={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemExited) {
						return <RuntimeExited key={runtimeItem.id} runtimeItemExited={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemRestartButton) {
						return <RuntimeRestartButton key={runtimeItem.id} runtimeItemRestartButton={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemStartupFailure) {
						return <RuntimeStartupFailure key={runtimeItem.id} runtimeItemStartupFailure={runtimeItem} />;
					} else if (runtimeItem instanceof RuntimeItemTrace) {
						return trace && <RuntimeTrace key={runtimeItem.id} runtimeItemTrace={runtimeItem} />;
					} else {
						// This indicates a bug.
						return null;
					}
				})}
			</div>
			{!props.positronConsoleInstance.promptActive &&
				<ConsoleInput
					width={consoleInputWidth}
					positronConsoleInstance={props.positronConsoleInstance}
					selectAll={() => selectAllRuntimeItems()}
				/>
			}
		</div>
	);
};

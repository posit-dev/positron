/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInstance.css';

// React.
import React, { KeyboardEvent, MouseEvent, UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState, WheelEvent } from 'react';

// Other dependencies.
import * as nls from '../../../../../nls.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { isMacintosh, isWeb } from '../../../../../base/common/platform.js';
import { PixelRatio } from '../../../../../base/browser/pixelRatio.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import { applyFontInfo } from '../../../../../editor/browser/config/domFontInfo.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { BareFontInfo, FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { FontMeasurements } from '../../../../../editor/browser/config/fontMeasurements.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { POSITRON_PLOTS_VIEW_ID } from '../../../../services/positronPlots/common/positronPlots.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { ConsoleInstanceItems } from './consoleInstanceItems.js';
import { IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { POSITRON_CONSOLE_COPY, POSITRON_CONSOLE_PASTE, POSITRON_CONSOLE_SELECT_ALL } from '../positronConsoleIdentifiers.js';

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
	const consoleInstanceContainerRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [editorFontInfo, setEditorFontInfo] =
		useState<FontInfo>(getEditorFontInfo(undefined, positronConsoleContext.configurationService));
	const [trace, setTrace] = useState(props.positronConsoleInstance.trace);
	const [wordWrap, setWordWrap] = useState(props.positronConsoleInstance.wordWrap);
	const [marker, setMarker] = useState(generateUuid());
	const [runtimeAttached, setRuntimeAttached] = useState(props.positronConsoleInstance.runtimeAttached);
	const [, setIgnoreNextScrollEvent, ignoreNextScrollEventRef] = useStateRef(false);
	const [disconnected, setDisconnected] = useState(false);

	// Determines whether the console is scrollable.
	const scrollable = () =>
		consoleInstanceRef.current.scrollHeight > consoleInstanceRef.current.clientHeight;

	// Scroll to the bottom.
	// Wrapped in a `useCallback()` because the function is used as dependency
	// in a `useEffect()`. Caching it prevents the `useEffect()` from being
	// called on every rerender.
	const scrollToBottom = useCallback(() => {
		props.positronConsoleInstance.scrollLocked = false;
		setIgnoreNextScrollEvent(true);
		scrollVertically(consoleInstanceRef.current.scrollHeight);
	}, [props.positronConsoleInstance, setIgnoreNextScrollEvent]);

	// Scrolls the console vertically.
	const scrollVertically = (y: number) => {
		consoleInstanceRef.current.scrollTo(consoleInstanceRef.current.scrollLeft, y);
	};

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
			selection.selectAllChildren(consoleInstanceContainerRef.current);
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

		// Add the onDidChangeState event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeState(state => {
			if (state === PositronConsoleState.Starting) {
				// Scroll to bottom when restarting
				// https://github.com/posit-dev/positron/issues/2807
				scrollToBottom();
			}

			setDisconnected(state === PositronConsoleState.Disconnected);
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
		disposableStore.add(props.positronConsoleInstance.onDidExecuteCode(() => {
			scrollToBottom();
		}));

		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(visible => {
			if (visible) {
				// The browser will automatically set scrollTop to 0 on child
				// components that have been hidden and made visible. (This is
				// called "desperate" elsewhere in Visual Studio Code.  Search
				// for that word and you'll see other examples of hacks that
				// have been added to to fix this problem.).  To counteract this
				// we restore the scroll state saved on the last scroll event.
				//
				// We restore in the next tick because otherwise our scrolling
				// gets overwritten by whatever is setting the scrollTop to 0 on
				// redraw. This is also what VS Code's debug console does.
				//
				// Note that the scroll-to-zero somehow only happens when we are
				// not scrolled all the way to the bottom. In this case, the
				// scrolling to 0 followed by our scroll to `lastScrollTop` is
				// unfortunately noticeable, though not too bad.
				const restoreScrollTop = () => {
					if (props.positronConsoleInstance.scrollLocked) {
						scrollVertically(props.positronConsoleInstance.lastScrollTop);
					} else {
						scrollToBottom();
					}
				};
				disposableTimeout(restoreScrollTop, 0, disposableStore);
			}
		}));

		disposableStore.add(props.reactComponentContainer.onSizeChanged(_ => {
			if (!props.positronConsoleInstance.scrollLocked) {
				scrollToBottom();
			}
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
			const sessionId =
				positronConsoleContext.activePositronConsoleInstance?.sessionId;
			if (sessionId) {
				positronConsoleContext.runtimeSessionService.restartSession(
					sessionId,
					'Restart requested from activity in the Console tab');
			}
		}));

		disposableStore.add(props.positronConsoleInstance.onDidSelectAll(text => {
			selectAllRuntimeItems();
		}));

		disposableStore.add(props.positronConsoleInstance.onDidAttachSession((runtime) => {
			setRuntimeAttached(!!runtime);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [editorFontInfo, positronConsoleContext.activePositronConsoleInstance?.attachedRuntimeSession, positronConsoleContext.activePositronConsoleInstance, positronConsoleContext.configurationService, positronConsoleContext.positronPlotsService, positronConsoleContext.runtimeSessionService, positronConsoleContext.viewsService, props.positronConsoleInstance, props.reactComponentContainer, scrollToBottom]);

	useLayoutEffect(() => {
		// If the view is not scroll locked, scroll to the bottom to reveal the most recent items.
		if (!props.positronConsoleInstance.scrollLocked) {
			scrollVertically(consoleInstanceRef.current.scrollHeight);
		}
	}, [marker, props.positronConsoleInstance.scrollLocked]);

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

		// Determine that a key is pressed without any modifiers
		const noModifierKey = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

		// Determine whether the cmd or ctrl key is pressed without other modifiers.
		const onlyCmdOrCtrlKey = (isMacintosh ? e.metaKey : e.ctrlKey) &&
			(isMacintosh ? !e.ctrlKey : !e.metaKey) &&
			!e.shiftKey &&
			!e.altKey;

		// Shift key is pressed without other modifiers.
		const onlyShiftKey = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

		// Calculates the page height.
		const pageHeight = () =>
			Math.max(
				Math.floor(consoleInstanceRef.current.clientHeight / editorFontInfo.lineHeight) - 1,
				1
			) * editorFontInfo.lineHeight;

		// Handle the key.
		if (noModifierKey) {
			// Handle scrolling keys.
			switch (e.key) {
				// Page up key.
				case 'PageUp':
					consumeEvent();
					props.positronConsoleInstance.scrollLocked = scrollable();
					scrollVertically(consoleInstanceRef.current.scrollTop - pageHeight());
					return;

				// Page down key.
				case 'PageDown':
					consumeEvent();
					scrollVertically(consoleInstanceRef.current.scrollTop + pageHeight());
					return;

				// Home key.
				case 'Home':
					// Consume the event, set scroll lock, and scroll to the top.
					consumeEvent();
					props.positronConsoleInstance.scrollLocked = scrollable();
					scrollVertically(0);
					return;

				// End key.
				case 'End':
					consumeEvent();
					scrollToBottom();
					return;
			}
		}

		if (onlyCmdOrCtrlKey) {
			// Process the key.
			switch (e.key) {
				// We don't handle 'x' here because:
				// - It's already correctly disabled in the read-only parts
				//   of the output. It's also disabled when the selection
				//   overlaps writable and read-only sections.
				// - It's easier to let the native command handle the writable
				//   parts.

				// A key.
				case 'a': {
					// Handle select all shortcut.
					if (getSelection()) {
						// Consume the event.
						consumeEvent();

						// Select all runtime items.
						selectAllRuntimeItems();
					}
					return;
				}

				// C key.
				case 'c': {
					// Consume the event.
					consumeEvent();

					// Get the selection. If there is one, copy it to the clipboard.
					const selection = getSelection();
					if (selection) {
						// Copy the selection to the clipboard.
						positronConsoleContext.clipboardService.writeText(selection.toString());
					}
					return;
				}

				// V key.
				case 'v': {
					// Consume the event.
					consumeEvent();

					// Paste text.
					pasteText(await positronConsoleContext.clipboardService.readText());
					return;
				}
			}
		}

		// Typing keys get driven to the input.
		if (noModifierKey || onlyShiftKey) {
			scrollToBottom();
			props.positronConsoleInstance.focusInput();
			return;
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

			// Update scroll lock state
			props.positronConsoleInstance.scrollLocked = scrollPosition >= 1;

			// This used to be saved in an event handler when visibility changed
			// to `false` but the `scrollTop` already became 0 at that point.
			props.positronConsoleInstance.lastScrollTop = consoleInstanceRef.current.scrollTop;
		}
	};

	/**
	 * Fixes the scroll event override that VS Code drops to prevent gesture navigation.
	 * @param e A WheelEvent<HTMLDivElement>
	 */
	const scrollOverrideHandler = (e: WheelEvent<HTMLDivElement>) => {
		if (isWeb) {
			consoleInstanceRef.current.scrollBy(e.deltaX, e.deltaY);
		}
	};

	/**
	 * onWheel event handler.
	 * @param e A WheelEvent<HTMLDivElement> that describes a user interaction with the wheel.
	 */
	const wheelHandler = (e: WheelEvent<HTMLDivElement>) => {
		// Negative delta Y immediantly engages scroll lock, if the console is scrollable.
		if (e.deltaY < 0 && !props.positronConsoleInstance.scrollLocked) {
			props.positronConsoleInstance.scrollLocked = scrollable();
			return;
		}
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
			aria-controls={`panel-${props.positronConsoleInstance.sessionMetadata.sessionId}`}
			className='console-instance'
			data-testid={`console-${props.positronConsoleInstance.sessionMetadata.sessionId}`}
			style={{
				width: adjustedWidth,
				height: props.height,
				whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
				zIndex: props.active ? 'auto' : -1
			}}
			onClick={clickHandler}
			onKeyDown={keyDownHandler}
			onMouseDown={mouseDownHandler}
			onScroll={scrollHandler}
			onWheel={wheelHandler}>
			<div
				ref={consoleInstanceContainerRef}
				className='console-instance-container'
				onWheel={scrollOverrideHandler}
			>
				<ConsoleInstanceItems
					consoleInputWidth={consoleInputWidth}
					disconnected={disconnected}
					editorFontInfo={editorFontInfo}
					positronConsoleInstance={props.positronConsoleInstance}
					runtimeAttached={runtimeAttached}
					trace={trace}
					onSelectAll={() => selectAllRuntimeItems()}
				/>
			</div>
		</div>
	);
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './consoleInstance.css';

// React.
import { KeyboardEvent, MouseEvent, UIEvent, useCallback, useEffect, useLayoutEffect, useRef, useState, WheelEvent } from 'react';

// Other dependencies.
import { getActiveWindow } from '../../../../../base/browser/dom.js';
import * as nls from '../../../../../nls.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { ConsoleInstanceItems } from './consoleInstanceItems.js';
import { SubmittingOverlay } from './submittingOverlay.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { isMacintosh, isWeb } from '../../../../../base/common/platform.js';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import { FontConfigurationManager } from '../../../../browser/fontConfigurationManager.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { PlotsDisplayLocation, POSITRON_PLOTS_VIEW_ID } from '../../../../services/positronPlots/common/positronPlots.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { POSITRON_CONSOLE_COPY, POSITRON_CONSOLE_PASTE, POSITRON_CONSOLE_SELECT_ALL } from '../positronConsoleIdentifiers.js';
import { IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

// ConsoleInstanceProps interface.
interface ConsoleInstanceProps {
	readonly active: boolean;
	readonly width: number;
	readonly height: number;
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly reactComponentContainer: IReactComponentContainer;
}

// Snapshot of the scroll container's size at a point in time. Used to detect phantom
// scroll events from layout changes (see scrollHandler).
interface ObservedSize {
	readonly scrollHeight: number;
	readonly clientHeight: number;
}

/**
 * ConsoleInstance component.
 * @param props A ConsoleInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleInstance = (props: ConsoleInstanceProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const consoleInstanceRef = useRef<HTMLDivElement>(undefined!);
	const consoleInstanceContainerRef = useRef<HTMLDivElement>(undefined!);

	// Tracks scroll / client height as observed by the most recent real scroll event. Used in
	// scrollHandler to detect phantom scroll events from layout changes (where the user did not
	// scroll, but the container resized between the scroll write and the scroll event firing).
	const lastObservedSizeRef = useRef<ObservedSize | null>(null);

	// State hooks.
	const [fontInfo, setFontInfo] = useState(FontConfigurationManager.getFontInfo(services.configurationService, 'console'));
	const [trace, setTrace] = useState(props.positronConsoleInstance.trace);
	const [wordWrap, setWordWrap] = useState(props.positronConsoleInstance.wordWrap);
	const [marker, setMarker] = useState(generateUuid());
	const [runtimeAttached, setRuntimeAttached] = useState(props.positronConsoleInstance.runtimeAttached);
	const [, setIgnoreNextScrollEvent, ignoreNextScrollEventRef] = useStateRef(false);
	const [disconnected, setDisconnected] = useState(false);

	// Whether the "Submitting..." + Cancel overlay should be shown. Set 1000ms
	// after a submission starts (and only if it is still in progress), cleared
	// as soon as the submission finishes.
	const [showSubmittingOverlay, setShowSubmittingOverlay] = useState(false);

	// Attach the find widget DOM node to the console container.
	useEffect(() => {
		const domNode = props.positronConsoleInstance.findWidgetDomNode;
		if (!consoleInstanceRef.current || !domNode) {
			return;
		}
		consoleInstanceRef.current.prepend(domNode);
		return () => {
			// Remove the DOM node when the component unmounts or the instance changes.
			// The find widget will create a new DOM node when the instance changes,
			// so we need to remove the old one.
			domNode.remove();
		};
	}, [props.positronConsoleInstance]);

	// Re-apply find highlights when this tab becomes active. The CSS Custom
	// Highlight API is global per-document, so only the active tab's
	// highlights should be registered.
	useEffect(() => {
		if (props.active) {
			props.positronConsoleInstance.refreshFindHighlights();
		}
	}, [props.active, props.positronConsoleInstance]);

	// Update find widget layout when width changes.
	useEffect(() => {
		props.positronConsoleInstance.layoutFindWidget(props.width);
	}, [props.positronConsoleInstance, props.width]);

	// Debounce the "Submitting..." + Cancel overlay: show it 1000ms after a
	// submission starts (and only if it is still in progress), and hide it as
	// soon as the submission finishes.
	useEffect(() => {
		const instance = props.positronConsoleInstance;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const disposable = instance.onDidChangeCodeSubmissionInProgress(inProgress => {
			if (inProgress) {
				timer = setTimeout(() => {
					timer = undefined;
					if (instance.codeSubmissionInProgress) {
						setShowSubmittingOverlay(true);
					}
				}, 1000);
			} else {
				if (timer) {
					clearTimeout(timer);
					timer = undefined;
				}
				setShowSubmittingOverlay(false);
			}
		});
		return () => {
			if (timer) {
				clearTimeout(timer);
			}
			disposable.dispose();
		};
	}, [props.positronConsoleInstance]);

	// Anchor to bottom on shrink. The browser auto-clamps scrollTop on grow but not on shrink, so
	// we need to set it ourselves. ResizeObserver fires between layout and paint, keeping the
	// correction in the same frame as the size change — a useLayoutEffect would run a frame later
	// because it waits for VS Code's onSizeChanged → React state → re-render. See consoleCore.css
	// for the overall layout scheme.
	useEffect(() => {
		// Get the console instance element. If it doesn't exist, do nothing.
		const consoleInstanceElement = consoleInstanceRef.current;
		if (!consoleInstanceElement) {
			return;
		}

		// Get the window element for the console instance element and create a ResizeObserver for
		// it that will scroll to the bottom if the view is not scroll locked.
		const window = DOM.getWindow(consoleInstanceElement);
		const resizeObserver = new window.ResizeObserver(() => {
			if (!props.positronConsoleInstance.scrollLocked) {
				setIgnoreNextScrollEvent(true);
				consoleInstanceElement.scrollTo(
					consoleInstanceElement.scrollLeft,
					consoleInstanceElement.scrollHeight
				);
			}
		});

		// Observe the console instance element for size changes.
		resizeObserver.observe(consoleInstanceElement);

		// Disconnect the observer on cleanup.
		return () => resizeObserver.disconnect();
	}, [props.positronConsoleInstance, setIgnoreNextScrollEvent]);

	// Determines whether the console is scrollable.
	const scrollable = () => consoleInstanceRef.current.scrollHeight > consoleInstanceRef.current.clientHeight;

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
		const clipboardText = await services.clipboardService.readText();

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
					getActiveWindow().document.execCommand('copy');
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
		services.contextMenuService.showContextMenu({
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

		// Add the font configuration watcher.
		disposableStore.add(FontConfigurationManager.fontConfigurationWatcher(
			services.configurationService,
			'console',
			consoleInstanceRef.current,
			(fontInfo: FontInfo) => setFontInfo(fontInfo)
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

		// Add the onDidSelectPlot event handler.
		disposableStore.add(props.positronConsoleInstance.onDidSelectPlot(plotId => {
			// Ensure that the Plots pane is visible in the main window.
			// Don't open the main window view if plots are displayed in the auxiliary window.
			if (services.positronPlotsService.displayLocation === PlotsDisplayLocation.MainWindow) {
				services.viewsService.openView(POSITRON_PLOTS_VIEW_ID, false);
			}

			// Select the plot in the Plots pane.
			services.positronPlotsService.selectPlot(plotId);
		}));

		// Add the onDidRequestRestart event handler.
		disposableStore.add(props.positronConsoleInstance.onDidRequestRestart(() => {
			const sessionId =
				positronConsoleContext.activePositronConsoleInstance?.sessionId;
			if (sessionId) {
				services.runtimeSessionService.restartSession(
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

		// Add the onDidRequestRevealExecution event handler.
		disposableStore.add(props.positronConsoleInstance.onDidRequestRevealExecution((executionId) => {
			// Find the element with the matching data-execution-id attribute.
			// eslint-disable-next-line no-restricted-syntax
			const element = consoleInstanceRef.current.querySelector(
				`[data-execution-id="${executionId}"]`
			);
			if (!element) {
				return;
			}

			// Find the activity-input element within this activity.
			// eslint-disable-next-line no-restricted-syntax
			const activityInput = element.querySelector('.activity-input');
			if (!activityInput) {
				return;
			}

			// Scroll the element into view.
			element.scrollIntoView({ behavior: 'smooth', block: 'center' });

			// Add the 'revealed' class to trigger the highlight animation.
			activityInput.classList.add('revealed');

			// Remove the 'revealed' class after the animation completes (2 seconds).
			disposableTimeout(() => {
				activityInput.classList.remove('revealed');
			}, 2000, disposableStore);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [positronConsoleContext.activePositronConsoleInstance?.attachedRuntimeSession, positronConsoleContext.activePositronConsoleInstance, services.configurationService, services.positronPlotsService, services.runtimeSessionService, services.viewsService, props.positronConsoleInstance, props.reactComponentContainer, scrollToBottom]);

	useLayoutEffect(() => {
		// If the view is not scroll locked, scroll to the bottom to reveal the most recent items.
		// Set ignoreNextScrollEvent so the scroll event from our scrollTo write is not interpreted
		// as the user scrolling away from the bottom — the scroll handler runs later and may see a
		// different clientHeight than we used, producing a non-zero scrollPosition that would
		// incorrectly flip scrollLocked = true.
		if (!props.positronConsoleInstance.scrollLocked) {
			setIgnoreNextScrollEvent(true);
			scrollVertically(consoleInstanceRef.current.scrollHeight);
		}
	}, [marker, props.positronConsoleInstance.scrollLocked, setIgnoreNextScrollEvent]);

	/**
	 * onClick event handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const clickHandler = (e: MouseEvent<HTMLDivElement>) => {
		const selection = getSelection();
		if (!selection || selection.type !== 'Range') {
			// Move the cursor to the console input. When the user has scrolled up to view
			// history, focus without scrolling so the viewport stays put (#11772); typing
			// will scroll the input back into view (#13991).
			props.positronConsoleInstance.focusInput({
				preventScroll: props.positronConsoleInstance.scrollLocked
			});
		}
	};

	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLDivElement>) => {
		// Ignore keydown events originating from within the find widget so
		// they can bubble to the keybinding service on the window.
		const target = e.target as HTMLElement;
		if (target.closest?.('.simple-find-part')) {
			return;
		}

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
				Math.floor(consoleInstanceRef.current.clientHeight / fontInfo.lineHeight) - 1,
				1
			) * fontInfo.lineHeight;

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
					// When the keydown originates from the console input editor,
					// let it bubble to the keybinding service so the input's Home
					// binding (cursorLineStart) handles it. Only scroll the output
					// to the top when focus is elsewhere in the console.
					if (target.closest?.('.console-input')) {
						return;
					}
					// Consume the event, set scroll lock, and scroll to the top.
					consumeEvent();
					props.positronConsoleInstance.scrollLocked = scrollable();
					scrollVertically(0);
					return;

				// End key.
				case 'End':
					// As with Home, let input-originated End bubble to the
					// keybinding service (cursorLineEnd); otherwise scroll to the
					// bottom of the output.
					if (target.closest?.('.console-input')) {
						return;
					}
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
						getActiveWindow().document.execCommand('copy');
					}
					return;
				}

				// V key.
				case 'v': {
					// Consume the event.
					consumeEvent();

					// Paste text.
					pasteText(await services.clipboardService.readText());
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
				getActiveWindow().document.execCommand('copy');
				// Move the cursor to the console input. When the user has scrolled up to
				// view history, focus without scrolling so the viewport stays put (#11772).
				props.positronConsoleInstance.focusInput({
					preventScroll: props.positronConsoleInstance.scrollLocked
				});
				return;
			}
		}
	};

	/**
	 * onScroll event handler.
	 * @param e A UIEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const scrollHandler = (e: UIEvent<HTMLDivElement>) => {
		// Get the console instance element. If it doesn't exist, do nothing.
		const consoleInstanceElement = consoleInstanceRef.current;
		if (!consoleInstanceElement) {
			return;
		}

		// Get the current size of the console instance element.
		const currentSize: ObservedSize = {
			scrollHeight: consoleInstanceElement.scrollHeight,
			clientHeight: consoleInstanceElement.clientHeight,
		};

		// Skip if this scroll event was triggered by our own scrollTo (e.g. from the
		// ResizeObserver or scrollToBottom). Otherwise the lock-update logic below would
		// interpret it as the user scrolling away from the bottom and incorrectly set
		// scrollLocked = true.
		if (ignoreNextScrollEventRef.current) {
			setIgnoreNextScrollEvent(false);
			lastObservedSizeRef.current = currentSize;
		} else {
			// Phantom scroll events from cascading layout changes: a ResizeObserver-driven
			// scrollTo runs once, but its scroll event fires later — by then the container may
			// have shrunk further, leaving scrollTop short of the new max. If the size changed
			// since the last real scroll, treat this as a phantom and skip the scroll lock update.
			const sizeChanged = lastObservedSizeRef.current !== null &&
				(
					currentSize.scrollHeight !== lastObservedSizeRef.current.scrollHeight ||
					currentSize.clientHeight !== lastObservedSizeRef.current.clientHeight
				);
			lastObservedSizeRef.current = currentSize;
			if (sizeChanged) {
				return;
			}

			// Calculate the scroll position.
			const scrollPosition = Math.abs(
				consoleInstanceElement.scrollHeight -
				consoleInstanceElement.clientHeight -
				consoleInstanceElement.scrollTop
			);

			// Update scroll lock state
			props.positronConsoleInstance.scrollLocked = scrollPosition >= 1;

			// This used to be saved in an event handler when visibility changed
			// to `false` but the `scrollTop` already became 0 at that point.
			props.positronConsoleInstance.lastScrollTop = consoleInstanceElement.scrollTop;
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
	props.positronConsoleInstance.setWidthInChars(Math.floor(consoleInputWidth / fontInfo.spaceWidth));

	// Render.
	return (
		<div
			ref={consoleInstanceRef}
			aria-labelledby={`console-panel-${props.positronConsoleInstance.sessionMetadata.sessionId}`}
			className='console-instance'
			data-testid={`console-${props.positronConsoleInstance.sessionMetadata.sessionId}`}
			role='tabpanel'
			style={{
				width: adjustedWidth,
				whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
				zIndex: props.active ? 'auto' : -1
			}}
			onClick={clickHandler}
			onKeyDown={keyDownHandler}
			onMouseDown={mouseDownHandler}
			onScroll={scrollHandler}
			onWheel={wheelHandler}
		>
			<div
				ref={consoleInstanceContainerRef}
				className='console-instance-container'
				onWheel={scrollOverrideHandler}
			>
				<ConsoleInstanceItems
					consoleInputWidth={consoleInputWidth}
					disconnected={disconnected}
					fontInfo={fontInfo}
					positronConsoleInstance={props.positronConsoleInstance}
					runtimeAttached={runtimeAttached}
					trace={trace}
					onSelectAll={() => selectAllRuntimeItems()}
				/>
			</div>
			<SubmittingOverlay
				visible={showSubmittingOverlay}
				onCancel={() => props.positronConsoleInstance.cancelCodeSubmission()}
			/>
		</div>
	);
};

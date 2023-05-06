/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleInstance';
import * as React from 'react';
import { KeyboardEvent, MouseEvent, UIEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { PixelRatio } from 'vs/base/browser/browser';
import { isMacintosh } from 'vs/base/common/platform';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { applyFontInfo } from 'vs/editor/browser/config/domFontInfo';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConsoleInput } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInput';
import { RuntimeTrace } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeTrace';
import { RuntimeExited } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeExited';
import { RuntimeStartup } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartup';
import { RuntimeStarted } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStarted';
import { RuntimeOffline } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeOffline';
import { RuntimeItemTrace } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemTrace';
import { RuntimeStarting } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStarting';
import { RuntimeActivity } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeActivity';
import { RuntimeItemExited } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemExited';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartup';
import { RuntimeItemStarted } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarted';
import { RuntimeItemOffline } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemOffline';
import { RuntimeItemStarting } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarting';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { RuntimeReconnected } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeReconnected';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemReconnected';
import { RuntimeStartupFailure } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartupFailure';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';
import { RuntimeItemStartupFailure } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartupFailure';

// ConsoleInstanceProps interface.
interface ConsoleInstanceProps {
	readonly active: boolean;
	readonly width: number;
	readonly height: number;
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * Editor font tracker.
 * @param configurationService The configuratio service.
 * @param element The element to apply the editor font info to.
 * @returns An IDisposable that should be disposed when the editor font tracker is no longer needed.
 */
const editorFontTracker = (
	configurationService: IConfigurationService,
	element: HTMLDivElement
): IDisposable => {
	// Get the editor options and read the font info.
	const editorOptions = configurationService.getValue<IEditorOptions>('editor');
	const fontInfo = FontMeasurements.readFontInfo(
		BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.value)
	);

	// Apply the font info to the element.
	applyFontInfo(element, fontInfo);

	// Watch for configuratio changes.
	return configurationService.onDidChangeConfiguration(
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
					// Get the editor options and read the font info.
					const fontInfo = FontMeasurements.readFontInfo(
						BareFontInfo.createFromRawSettings(
							configurationService.
								getValue<IEditorOptions>('editor'),
							PixelRatio.value
						)
					);

					// Apply the font info to the Positron environment container.
					applyFontInfo(element, fontInfo);
				}
			}
		}
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
	const consoleInputRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [trace, setTrace] = useState(props.positronConsoleInstance.trace);
	const [marker, setMarker] = useState(generateUuid());
	const [, setLastScrollTop, lastScrollTopRef] = useStateRef(0);

	// useEffect for appending items.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the editor font tracker.
		disposableStore.add(editorFontTracker(
			positronConsoleContext.configurationService,
			consoleInstanceRef.current
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

		// Add the onDidChangeRuntimeItems event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeRuntimeItems(runtimeItems => {
			setMarker(generateUuid());
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Experimental.
	useEffect(() => {
		consoleInputRef.current?.scrollIntoView({ behavior: 'auto' });
	}, [marker]);

	/**
	 * onClick event handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const clickHandler = (e: MouseEvent<HTMLDivElement>) => {
		// Get the document selection.
		const selection = document.getSelection();

		// If there is a document selection, and its type is Caret (as opposed to Range), drive
		// focus into the console input.
		if (!selection || selection.type === 'Caret') {
			consoleInputRef.current?.focus();
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

		// Process the key.
		switch (e.code) {
			// C key.
			case 'KeyC': {
				// Handle copy.
				if (cmdOrCtrlKey) {
					// Consume the event.
					consumeEvent();

					// Get the selection. If there is one, copy it to the clipboard.
					const selection = document.getSelection();
					if (selection) {
						positronConsoleContext.clipboardService.writeText(selection.toString());
					}

					// The event has been fully processed.
					return;
				}
				break;
			}

			// Other keys.
			default: {
				// When the user presses another key, drive focus to the console input. This has the
				// effect of driving the onKeyDown event to the CodeEditorWidget.
				if (!cmdOrCtrlKey) {
					consoleInputRef.current?.focus();
				}
				break;
			}
		}
	};

	/**
	 * onMouseDown event handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLDivElement>) => {
		// Get the selection.
		const selection = document.getSelection();

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
			}

			// Drive focus into the console input.
			consoleInputRef.current?.focus();
		}
	};

	/**
	 * onScroll event handler.
	 * @param e A UIEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const scrollHandler = (e: UIEvent<HTMLDivElement>) => {
		if (props.active) {
			setLastScrollTop(consoleInstanceRef.current.scrollTop);
		}
	};

	// Calculate the adjusted width (to account for indentation of the entire console instance).
	const adjustedWidth = props.width - 10;

	// Render.
	return (
		<div
			ref={consoleInstanceRef}
			className='console-instance'
			style={{ width: adjustedWidth, height: props.height, zIndex: props.active ? 1 : -1 }}
			tabIndex={0}
			onClick={clickHandler}
			onKeyDown={keyDownHandler}
			onMouseDown={mouseDownHandler}
			onScroll={scrollHandler}>
			{props.positronConsoleInstance.runtimeItems.map(runtimeItem => {
				if (runtimeItem instanceof RuntimeItemActivity) {
					return <RuntimeActivity key={runtimeItem.id} runtimeItemActivity={runtimeItem} positronConsoleInstance={props.positronConsoleInstance} />;
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
				} else if (runtimeItem instanceof RuntimeItemStartupFailure) {
					return <RuntimeStartupFailure key={runtimeItem.id} runtimeItemStartupFailure={runtimeItem} />;
				} else if (runtimeItem instanceof RuntimeItemTrace) {
					return trace && <RuntimeTrace key={runtimeItem.id} runtimeItemTrace={runtimeItem} />;
				} else {
					// This indicates a bug.
					return null;
				}
			})}
			{!props.positronConsoleInstance.promptActive &&
				<ConsoleInput
					ref={consoleInputRef}
					width={adjustedWidth}
					positronConsoleInstance={props.positronConsoleInstance}
				/>
			}
		</div>
	);
};

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleCore';
import * as React from 'react';
import { MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ActionBar } from 'vs/workbench/contrib/positronConsole/browser/components/actionBar';
import { ConsoleInstance } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInstance';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

// ConsoleCoreProps interface.
interface ConsoleCoreProps {
	readonly width: number;
	readonly height: number;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * ConsoleCore component.
 * @param props A ConsoleCoreProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleCore = (props: ConsoleCoreProps) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// If there are no console instances, render nothing.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (!positronConsoleContext.positronConsoleInstances.length) {
		return null;
	}

	/**
	 * Click handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 * @param e The event.
	 */
	const onClickHandler = (e: MouseEvent<HTMLElement>) => {
		const selection = document.getSelection();
		if (!selection || selection.type === 'Caret') {
			props.reactComponentContainer.takeFocus();
		}
	};

	/**
	 * MouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
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

			// Drive focus into the container.
			props.reactComponentContainer.takeFocus();
		}
	};

	// Render.
	return (
		<div className='console-core'>
			<ActionBar {...props} />
			<div
				className='console-instances-container'
				style={{ width: props.width, height: props.height - 32 }}
				onMouseDown={mouseDownHandler}
				onClick={onClickHandler}
			>
				{positronConsoleContext.positronConsoleInstances.map(positronConsoleInstance =>
					<ConsoleInstance
						key={positronConsoleInstance.runtime.metadata.languageId}
						width={props.width}
						height={props.height - 32}
						positronConsoleInstance={positronConsoleInstance}
						focusReceiver={props.reactComponentContainer}
						hidden={positronConsoleInstance !== positronConsoleContext.activePositronConsoleInstance} />
				)}
			</div>
		</div>
	);
};

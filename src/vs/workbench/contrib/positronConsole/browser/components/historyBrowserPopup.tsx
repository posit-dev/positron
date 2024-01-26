/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./historyBrowserPopup';
import * as nls from 'vs/nls';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { HistoryCompletionItem } from 'vs/workbench/contrib/positronConsole/browser/components/historyCompletionItem';

// eslint-disable-next-line no-duplicate-imports
import { useEffect } from 'react';
import { HistoryMatch } from 'vs/workbench/contrib/positronConsole/common/historyMatchStrategy';

export interface HistoryBrowserPopupProps {
	/// The list of history items to display.
	items: HistoryMatch[];

	/// The index of the selected item.
	selectedIndex: number;

	/// The bottom position of the popup in pixels.
	bottomPx: number;

	/// The left position of the popup in pixels.
	leftPx: number;

	/// The callback to invoke when the user selects an item with the mouse.
	onSelected: (index: number) => void;

	/// The callback to invoke when the popup is dismissed.
	onDismissed: () => void;
}

/**
 * HistoryBrowserPopup component.
 *
 * This component shows a scrollable list of history items as a popup that
 * displays inside the Console.
 *
 * @returns The rendered component.
 */
export const HistoryBrowserPopup = (props: HistoryBrowserPopupProps) => {
	const popupRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (popupRef.current) {
			// Find the first child that has a CSS class of 'selected' and scroll it into view.
			const selectedChild = popupRef.current.querySelector('.selected');
			if (selectedChild) {
				selectedChild.scrollIntoView();
			}
		}

		// Add a click handler to the active window to dismiss the popup if the user clicks
		// anywhere outside of the popup.
		const clickHandler = (ev: MouseEvent) => {
			// Is the event targeted for somewhere within the popup?
			const target = ev.target as HTMLElement;
			const popup = popupRef.current;
			if (popup && popup.contains(target)) {
				// Yes, so do nothing.
				return;
			}
			// No, so dismiss the popup.
			props.onDismissed();
		};

		DOM.getActiveWindow().addEventListener('click', clickHandler);
		return () => {
			DOM.getActiveWindow().removeEventListener('click', clickHandler);
		};
	}, [props.selectedIndex]);

	const noMatch = nls.localize('positronConsoleHistoryMatchesEmpty', "No matching history items");

	return <div className='suggest-widget history-browser-popup' ref={popupRef}
		style={{ bottom: props.bottomPx, left: props.leftPx }}>
		{props.items.length === 0 && <div className='no-results'>{noMatch}</div>}
		{props.items.length > 0 &&
			<ul>
				{props.items.map((item, index) => {
					const onSelected = () => {
						props.onSelected(index);
					};
					return <HistoryCompletionItem
						match={item}
						selected={props.selectedIndex === index}
						onSelected={onSelected} />;
				})}
			</ul>
		}
	</div>;
};

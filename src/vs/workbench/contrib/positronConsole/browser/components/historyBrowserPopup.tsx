/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./historyBrowserPopup';
import * as React from 'react';
import { HistoryCompletionItem } from 'vs/workbench/contrib/positronConsole/browser/components/historyCompletionItem';

// eslint-disable-next-line no-duplicate-imports
import { useEffect } from 'react';
import { HistoryMatch } from 'vs/workbench/contrib/positronConsole/common/historyMatchStrategy';

export interface HistoryBrowserPopupProps {
	items: HistoryMatch[];
	selectedIndex: number;
	bottomPx: number;
	leftPx: number;
	onSelected: (index: number) => void;
}

/**
 * HistoryBrowserPopup component.
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
	}, [props.selectedIndex]);

	return <div className='suggest-widget history-browser-popup' ref={popupRef}
		style={{ bottom: props.bottomPx, left: props.leftPx }}>
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
	</div>;
};

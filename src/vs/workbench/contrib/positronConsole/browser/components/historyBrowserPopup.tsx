/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./historyBrowserPopup';
import * as React from 'react';
import { HistoryCompletionItem } from 'vs/workbench/contrib/positronConsole/browser/components/historyCompletionItem';

// eslint-disable-next-line no-duplicate-imports
import { useEffect } from 'react';

export interface HistoryBrowserPopupProps {
	items: string[];
	selectedIndex: number;
}

/**
 * HistoryBrowserPopup component.
 *
 * @returns The rendered component.
 */
export const HistoryBrowserPopup = (props: HistoryBrowserPopupProps) => {
	const popupRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (popupRef.current && popupRef.current.scrollTop === 0) {
			popupRef.current.scrollTop = popupRef.current.scrollHeight;
		}
	});

	return <div className='suggest-widget history-browser-popup' ref={popupRef}>
		<ul>
			{props.items.map((item, index) => {
				return <HistoryCompletionItem label={item} selected={props.selectedIndex === index} />;
			})}
		</ul>
	</div>;
};

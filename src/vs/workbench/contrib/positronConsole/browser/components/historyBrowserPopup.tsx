/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./historyBrowserPopup';
import * as React from 'react';
import { HistoryCompletionItem } from 'vs/workbench/contrib/positronConsole/browser/components/historyCompletionItem';

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
	return <ul className='suggest-widget history-browser-popup'>
		{props.items.map((item, index) => {
			return <HistoryCompletionItem label={item} selected={props.selectedIndex === index} />;
		})}
	</ul>;
};

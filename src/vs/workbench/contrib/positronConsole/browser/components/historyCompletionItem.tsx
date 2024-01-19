/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./historyCompletionItem';
import * as React from 'react';

export interface HistoryCompletionItemProps {
	readonly label: string;
}

export const HistoryCompletionItem = (props: HistoryCompletionItemProps) => {
	return <li className='history-completion-item'>{props.label}</li>;
};

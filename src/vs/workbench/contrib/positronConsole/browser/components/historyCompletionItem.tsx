/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./historyCompletionItem';
import * as React from 'react';
import { HistoryMatch } from 'vs/workbench/contrib/positronConsole/common/historyMatchStrategy';

export interface HistoryCompletionItemProps {
	readonly match: HistoryMatch;
	readonly selected: boolean;
	readonly onSelected: () => void;
}

/**
 * HistoryCompletionItem component.
 *
 * This component renders a single history item in the history browser popup. The history
 * entry is rendered as a link with the matched portion of the entry highlighted.
 *
 * @param props The properties for the HistoryCompletionItem component.
 *
 * @returns The rendered component.
 */
export const HistoryCompletionItem = (props: HistoryCompletionItemProps) => {
	const match = props.match;
	const preMatch = match.input.substring(0, match.highlightStart);
	const inMatch = match.input.substring(match.highlightStart, match.highlightEnd);
	const postMatch = match.input.substring(match.highlightEnd);
	return <li className={'history-completion-item' + (props.selected ? ' selected' : '')}>
		<a href='#' onClick={props.onSelected}>
			<span className='unmatched'>{preMatch}</span>
			<span className='matched'>{inMatch}</span>
			<span className='unmatched'>{postMatch}</span>
		</a>
	</li>;
};

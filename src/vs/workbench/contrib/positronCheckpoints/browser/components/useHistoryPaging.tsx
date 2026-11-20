/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { HISTORY_PAGE_SIZE } from './useCheckpointsState.js';

/**
 * Identifies a first page of history by the id, title, and shared flag of each row. Older pages
 * stay valid exactly while the first page keeps its signature.
 */
export function pageSignature(page: readonly ICheckpoint[]): string {
	return JSON.stringify(page.map(checkpoint => [checkpoint.id, checkpoint.title, checkpoint.shared]));
}

/** Appends `page` to `list` and leaves out every checkpoint whose id is already in `list`. */
export function appendUnique(list: readonly ICheckpoint[], page: readonly ICheckpoint[]): ICheckpoint[] {
	const ids = new Set(list.map(checkpoint => checkpoint.id));
	return [...list, ...page.filter(checkpoint => !ids.has(checkpoint.id))];
}

/** The older pages loaded so far, and the first page they belong to. */
interface IPaged {
	signature: string;
	older: ICheckpoint[];
	exhausted: boolean;
}

/** What `useHistoryPaging` gives the history list. */
export interface IHistoryPaging {
	/** The first page followed by the older pages, without duplicates. */
	checkpoints: ICheckpoint[];
	/** True when another page may exist. */
	hasMore: boolean;
	/** Loads the page after the last row. */
	loadMore(): Promise<void>;
}

/**
 * Pages through the history after its first page. The older pages are derived from the current
 * first page during render, so a render never mixes pages of two different first pages. They are
 * dropped when the first page changes. A page that arrives after the first page changed, or
 * after a newer load started, is dropped, and the offset of a load is the length of the list at
 * the moment it starts.
 *
 * @param firstPage The first page, as the view loaded it.
 * @param fetchPage Reads `limit` checkpoints after the first `skip`.
 * @param onFailure Called when `fetchPage` rejects. "Show more" stays available.
 */
export function useHistoryPaging(
	firstPage: readonly ICheckpoint[],
	fetchPage: (skip: number, limit: number) => Promise<ICheckpoint[]>,
	onFailure: (error: unknown) => void
): IHistoryPaging {
	const signature = useMemo(() => pageSignature(firstPage), [firstPage]);
	const [paged, setPaged] = useState<IPaged>({ signature, older: [], exhausted: false });
	const current: IPaged = paged.signature === signature ? paged : { signature, older: [], exhausted: false };

	const checkpoints = useMemo(() => appendUnique(firstPage, current.older), [firstPage, current.older]);
	const hasMore = !current.exhausted && (current.older.length > 0 || firstPage.length >= HISTORY_PAGE_SIZE);

	// Counts loads, so that a response from a superseded load is dropped.
	const latestRequest = useRef(0);
	const latest = useRef({ signature, length: checkpoints.length });
	useLayoutEffect(() => {
		latest.current = { signature, length: checkpoints.length };
	});

	const loadMore = useCallback(async () => {
		const request = ++latestRequest.current;
		const started = latest.current;
		let page: ICheckpoint[];
		try {
			page = await fetchPage(started.length, HISTORY_PAGE_SIZE);
		} catch (error) {
			if (request === latestRequest.current && latest.current.signature === started.signature) {
				onFailure(error);
			}
			return;
		}
		if (request !== latestRequest.current || latest.current.signature !== started.signature) {
			return;
		}
		setPaged(previous => {
			const base: IPaged = previous.signature === started.signature ? previous : { signature: started.signature, older: [], exhausted: false };
			return {
				signature: started.signature,
				older: appendUnique(base.older, page),
				exhausted: page.length < HISTORY_PAGE_SIZE,
			};
		});
	}, [fetchPage, onFailure]);

	return { checkpoints, hasMore, loadMore };
}

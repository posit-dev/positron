/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPositronConnectionItem, IPositronConnectionEntry } from '../common/interfaces/positronConnectionsInstance.js';



class PositronConnectionEntry extends Disposable implements IPositronConnectionEntry {

	error?: string;

	constructor(
		private readonly item: IPositronConnectionItem,
		readonly level: number,
		readonly expanded: boolean | undefined
	) {
		super();
	}

	get id() {
		return this.item.id;
	}

	get name() {
		return this.item.name;
	}

	get kind() {
		return this.item.kind;
	}

	get dtype() {
		return this.item.dtype;
	}

	get icon() {
		return this.item.icon;
	}

	get preview() {
		return this.item.preview;
	}
}

/**
 * Flattens an instance of PositronConnectionsInstance into a list of connection entries
 * that can be used by the UI. A flat list is usable so we can use react-window to efficiently
 * render the schema tree.
 */
export async function flatten_children(children: IPositronConnectionItem[], expanded_entries: Set<string>): Promise<IPositronConnectionEntry[]> {
	return await flatten_items(children, expanded_entries);
}

async function flatten_items(items: IPositronConnectionItem[], expanded_entries: Set<string>, level = 0): Promise<IPositronConnectionEntry[]> {
	const entries: IPositronConnectionEntry[] = [];
	for (const item of items) {

		const expanded = item.getChildren === undefined ?
			undefined :
			expanded_entries.has(item.id);

		const entry = new PositronConnectionEntry(item, level, expanded);
		entries.push(entry);

		if (item.error) {
			entry.error = item.error;
		}

		// expanded is undefined if the item is not expandable. but TS doesn't know that.
		if (expanded && item.getChildren) {
			let children;
			try {
				children = await item.getChildren();
			} catch (err: any) {
				// If some error happened we want to be able
				// display it for users.
				entry.error = err.message;
				continue;
			}
			const newItems = await flatten_items(children, expanded_entries, level + 1);
			entries.push(...newItems);
		}
	}

	return entries;
}

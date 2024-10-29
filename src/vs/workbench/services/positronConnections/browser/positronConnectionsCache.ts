/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { PositronConnectionsInstance } from 'vs/workbench/services/positronConnections/browser/positronConnectionsInstance';

export interface IPositronConnectionEntry extends IPositronConnectionItem {
	/***
	 * The list of connections entries is flat. Level allows us to find
	 * how nested an entry is.
	 */
	level: number;

	// If an error happens during some evaluation for that element
	// we try to display some information .
	error?: string;
}

class PositronConnectionEntry extends Disposable implements IPositronConnectionEntry {

	error?: string;

	constructor(
		private readonly item: IPositronConnectionItem,
		readonly level: number
	) {
		super();
	}

	get id() {
		return this.item.id;
	}

	get expanded() {
		return this.item.expanded;
	}

	get onToggleExpandEmitter() {
		return this.item.onToggleExpandEmitter;
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
export async function flatten_instance(instance: PositronConnectionsInstance): Promise<IPositronConnectionEntry[]> {
	return await flatten_items(await instance.getChildren());
}

async function flatten_items(items: IPositronConnectionItem[], level = 0): Promise<IPositronConnectionEntry[]> {
	const entries: IPositronConnectionEntry[] = [];
	for (const item of items) {

		const entry = new PositronConnectionEntry(item, level);
		entries.push(entry);

		if (item.error) {
			entry.error = item.error;
		}

		const expanded = item.expanded;
		const active = 'active' in item ? item.active : true;

		// To show children, the connection must be expanded, have a getChildren() method
		// and be active.
		if (expanded && item.getChildren && active) {
			let children;
			try {
				children = await item.getChildren();
			} catch (err: any) {
				// If some error happened we want to be able
				// display it for users.
				entry.error = err.message;
				continue;
			}
			const newItems = await flatten_items(children, level + 1);
			entries.push(...newItems);
		}
	}

	return entries;
}

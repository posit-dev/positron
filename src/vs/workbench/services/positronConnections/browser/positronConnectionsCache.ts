/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronConnectionInstance, IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';


export interface IPositronConnectionEntry {
	/***
	 * The list of connections entries is flat. Level allows us to find
	 * how nested an entry is.
	 */
	level: number;

	/***
	 * Used to indentify unique connection entries.
	 */
	id: string;

	name: string;
	active: boolean;

	icon: Promise<string | undefined>;
	dtype?: string;
	kind?: string;

	/**
	 * Wether the connection is expanded or not. Undefined
	 * if the connection is not expandable.
	 */
	expanded: boolean | undefined;

	/**
	 * Front-end may fire this event whenever the user clicks the
	 * toggle expand button. Must be implemented if the item is
	 * expandable.
	 */
	onToggleExpandEmitter?: Emitter<void>;

	/**
	 * Causes the item to disconnect.
	 */
	disconnect?(): void;
}

/**
 * Mosly wraps a PositronConnectionItem adding level and id fields
 * and removing access to getChildren() and hasChildren() methods.
 */
class PositronConnectionEntry extends Disposable implements IPositronConnectionEntry {
	constructor(
		readonly item: IPositronConnectionItem,
		readonly level: number,
		readonly id: string
	) {
		super();
	}

	get name() {
		return this.item.name;
	}

	get kind() {
		return this.item.kind;
	}

	get icon() {
		return this.item.getIcon().then((icon) => {
			if (icon === '') {
				return undefined;
			}
			return icon;
		});
	}

	get active() {
		return this.item.active;
	}

	get expanded() {
		return this.item.expanded;
	}

	get onToggleExpandEmitter() {
		return this.item.onToggleExpandEmitter;
	}

	disconnect() {
		if (this.item.disconnect) {
			this.item.disconnect();
		}
	}
}

export class PositronConnectionsCache {

	private _entries: IPositronConnectionEntry[] = [];

	constructor(
		private readonly service: IPositronConnectionsService,
	) { }

	get entries(): IPositronConnectionEntry[] {
		return this._entries;
	}

	async refreshConnectionEntries() {
		const entries = await this.getConnectionsEntries(this.service.getConnections());
		this._entries = entries;
	}

	async getConnectionsEntries(items: IPositronConnectionItem[], level = 0, parent = '') {
		return await items.reduce<Promise<IPositronConnectionEntry[]>>(async (entries, item, index) => {
			const _entries = await entries;

			let id: string | undefined;

			if (level === 0) {
				// When level === 0 we have a root connection instance, and they
				// might have a clientId which we can use as Id.
				// This id is then used ton close the connection.
				id = (item as IPositronConnectionInstance).getClientId();
			}

			if (!id) {
				id = `${parent}-${level}-${index}`;
			}

			_entries.push(new PositronConnectionEntry(
				item,
				level,
				id,
			));

			const expanded = item.expanded;
			const active = item.active;

			// To show children, the connection must be expanded, have a getChildren() method
			// and be active.
			if (expanded && item.getChildren && active) {
				const children = await item.getChildren();
				const newItems = await this.getConnectionsEntries(children, level + 1, `${parent}-${index}`);
				_entries.push(...newItems);
			}

			return _entries;
		}, Promise.resolve([]));
	}
}

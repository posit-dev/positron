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
	 * Connections and children of connections must all have unique ids.
	 */
	id: string;

	/**
	 * Wether the connection entry is currently active.
	 */
	active: boolean;

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


	// Entry properties that may be displayed in the UI.
	name: string;
	kind?: string;
	dtype?: string;
	language_id?: string;
	icon?: string;

	/**
	 * Enables the behavior of the connect button. Only
	 * enabled when the entry is not active.
	 */
	connect?(): Promise<void>;

	/**
	 * Causes the item to disconnect.
	 */
	disconnect?(): Promise<void>;

	/**
	 * Refresh the connection data.
	 */
	refresh?(): Promise<void>;

	/**
	 * Causes the a viewer to open for that item.
	 * Currently, used to open tables and views in the data explorer.
	 */
	preview?(): Promise<void>;
}

/**
 * Wraps ConnectionInstance or ConnectionItems to provide a flat list of entries.
 */
class PositronConnectionEntry extends Disposable implements IPositronConnectionEntry {
	constructor(
		private readonly item: IPositronConnectionItem | IPositronConnectionInstance,
		readonly level: number,
	) {
		super();
	}

	get id() {
		const id = this.item.id;
		return id;
	}

	get active() {
		if ('active' in this.item) {
			return this.item.active;
		}

		// Child objects are always 'active'.
		return true;
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

	get language_id() {
		if ('language_id' in this.item) {
			return this.item.language_id;
		}

		return undefined;
	}

	get icon() {
		return this.item.icon;
	}

	get disconnect() {
		if ('disconnect' in this.item) {
			const instance = this.item;
			return async () => { instance.disconnect?.(); };
		}

		return undefined;
	}

	get connect() {
		if ('connect' in this.item) {
			const instance = this.item;
			return async () => { instance.connect?.(); }
		}

		return undefined;
	}

	get preview() {
		return this.item.preview;
	}

	get refresh() {
		if ('refresh' in this.item) {
			const instance = this.item;
			return async () => { instance.refresh?.(); };
		}

		return undefined;
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
		console.log('refreshing entries?');
		const entries = await this.getConnectionsEntries(this.service.getConnections());
		this._entries = entries;
	}

	async getConnectionsEntries(items: IPositronConnectionItem[], level = 0) {
		console.log('level', level, 'root items', items);

		const entries: IPositronConnectionEntry[] = [];
		for (const item of items) {
			entries.push(new PositronConnectionEntry(
				item,
				level,
			));

			const expanded = item.expanded;
			const active = 'active' in item ? item.active : true;

			// To show children, the connection must be expanded, have a getChildren() method
			// and be active.
			if (expanded && item.getChildren && active) {
				const children = await item.getChildren();
				const newItems = await this.getConnectionsEntries(children, level + 1);
				entries.push(...newItems);
			}
		}

		return entries;
	}
}

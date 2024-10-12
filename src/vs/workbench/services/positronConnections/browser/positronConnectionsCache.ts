/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import Severity from 'vs/base/common/severity';
import { INotificationHandle } from 'vs/platform/notification/common/notification';
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

	// If an error happens during soem evaluation for that element
	// we try to display some information .
	error?: string;
}

/**
 * Wraps ConnectionInstance or ConnectionItems to provide a flat list of entries.
 */
class PositronConnectionEntry extends Disposable implements IPositronConnectionEntry {

	error?: string;

	constructor(
		private readonly item: IPositronConnectionItem | IPositronConnectionInstance,
		private notify: (message: string, severity: Severity) => INotificationHandle,
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
			return async () => {
				try {
					return await instance.disconnect?.();
				} catch (err: any) {
					// An error that happens during disconnected should be shown
					// as a notification to users.
					this.notify(
						`Error disconnecting ${this.id}: ${err.message}`,
						Severity.Error
					);
				}
			};
		}

		return undefined;
	}

	get connect() {
		if ('connect' in this.item) {
			const instance = this.item;
			return async () => {
				try {
					return await instance.connect?.();
				} catch (err: any) {
					this.notify(
						`Error creating connection ${this.id}: ${err.message}`,
						Severity.Error
					);
				}
			};
		}

		return undefined;
	}

	get preview() {
		if (this.item.preview) {
			return undefined;
		}


		return async () => {
			try {
				this.item.preview?.();
			} catch (err: any) {
				this.notify(
					`Error previewing object ${this.id}: ${err.message}`,
					Severity.Error
				);
			}
		};
	}

	get refresh() {
		if ('refresh' in this.item) {
			const instance = this.item;
			return async () => {
				try {
					instance.refresh?.();
				} catch (err: any) {
					this.notify(
						`Error refreshing connection ${this.id}: ${err.message}`,
						Severity.Error
					);
				}
			};
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
		const entries = await this.getConnectionsEntries(this.service.getConnections());
		this._entries = entries;
	}

	async getConnectionsEntries(items: IPositronConnectionItem[], level = 0) {

		const entries: IPositronConnectionEntry[] = [];
		for (const item of items) {

			const entry = new PositronConnectionEntry(
				item,
				(message, severity) => this.service.notify(message, severity),
				level,
			);
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
				const newItems = await this.getConnectionsEntries(children, level + 1);
				entries.push(...newItems);
			}
		}

		return entries;
	}
}

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
	 * The id of the root connection. This is the id of the connection
	 * that is at the top of the hierarchy.
	 */
	root_id: string;

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
	icon?: string;

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
		readonly root_id: string
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

	get preview() {
		if (!this.item.preview) {
			return undefined;
		}

		return async () => {
			try {
				await this.item.preview?.();
			} catch (err: any) {
				this.notify(
					`Error previewing object ${this.id}: ${err.message}`,
					Severity.Error
				);
			}
		};
	}
}

export class PositronConnectionsCache {

	private _entries: IPositronConnectionEntry[] = [];

	constructor(
		private readonly service: IPositronConnectionsService,
		private readonly instance: IPositronConnectionInstance,
	) { }

	get entries(): IPositronConnectionEntry[] {
		return this._entries;
	}

	async refreshConnectionEntries() {
		const entries = await this.getConnectionsEntries([this.instance]);
		this._entries = entries;
	}

	async getConnectionsEntries(items: IPositronConnectionItem[], level = 0, root_id: string | undefined = undefined) {

		const entries: IPositronConnectionEntry[] = [];
		for (const item of items) {

			const id_root = root_id ?? item.id;

			const entry = new PositronConnectionEntry(
				item,
				(message, severity) => this.service.notify(message, severity),
				level,
				id_root
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
				const newItems = await this.getConnectionsEntries(children, level + 1, id_root);
				entries.push(...newItems);
			}
		}

		return entries;
	}
}

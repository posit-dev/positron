/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import Severity from 'vs/base/common/severity';
import { INotificationHandle } from 'vs/platform/notification/common/notification';
import { IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
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

/**
 * Wraps ConnectionInstance or ConnectionItems to provide a flat list of entries.
 */
class PositronConnectionEntry extends Disposable implements IPositronConnectionEntry {

	error?: string;

	constructor(
		private readonly item: IPositronConnectionItem,
		private notify: (message: string, severity: Severity) => INotificationHandle,
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
		private readonly instance: PositronConnectionsInstance,
	) { }

	get entries(): IPositronConnectionEntry[] {
		return this._entries;
	}

	async refreshConnectionEntries() {
		const entries = await this.getConnectionsEntries(await this.instance.getChildren());
		this._entries = entries;
	}

	async getConnectionsEntries(items: IPositronConnectionItem[], level = 0) {

		const entries: IPositronConnectionEntry[] = [];
		for (const item of items) {

			const entry = new PositronConnectionEntry(
				item,
				(message, severity) => this.service.notify(message, severity),
				level
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

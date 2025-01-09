/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';

export interface IConnectionMetadata {
	name: string;
	language_id: string;
	host?: string;
	type?: string;
	code?: string;
	icon?: string;
}

export class ConnectionMetadata implements IConnectionMetadata {
	name: string;
	language_id: string;
	host?: string;
	type?: string;
	code?: string;
	icon?: string;

	constructor(metadata: IConnectionMetadata) {
		this.name = metadata.name;
		this.language_id = metadata.language_id;
		this.code = metadata.code;
		this.update(metadata);
	}

	update(values: Partial<IConnectionMetadata>): void {
		console.log(values);
		Object.assign(this, values);
		console.log(this);
	}
}

/***
 * A Connection Instance represents the root of a connection to a data
 * source. Children of a connection instance are tables, views, and other
 * objects that can be queried and are represented by Connection Items.
 */
export interface IPositronConnectionInstance {
	id: string;
	active: boolean;
	metadata: ConnectionMetadata;

	connect?(): Promise<void>;
	disconnect?(): Promise<void>;
	refresh?(): Promise<void>;

	onDidChangeEntries: Event<IPositronConnectionEntry[]>;
	onDidChangeStatus: Event<boolean>;
	refreshEntries(): Promise<void>;
	getEntries(): IPositronConnectionEntry[];

	onToggleExpandEmitter: Emitter<string>;
}

/***
 * A connection item represents a child object of a connection instance, such as a schema,
 * catalog, table, or view.
 */
export interface IPositronConnectionItem {
	id: string; // An id is essential for rendering with React
	name: string; // Every item needs a name in order for it to be displayed
	kind: string; // The kind of the item, eg. table, view, schema, catalog, etc.
	dtype?: string; // The data type of the item, usually only implemented if kind == field
	icon?: string; // The icon that should be displayed next to the item
	error?: string; // Any initialization error for the item.

	/**
	 * If the item can be previewed, it should implement this method.
	 */
	preview?(): Promise<void>;

	hasChildren?(): Promise<boolean>;
	getChildren?(): Promise<IPositronConnectionItem[]>;
}

export interface IPositronConnectionEntry extends IPositronConnectionItem {
	/***
	 * The list of connections entries is flat. Level allows us to find
	 * how nested an entry is.
	 */
	level: number;

	/***
	 * If the entry is expanded or not. Undefined if the entry is not expandable.
	 */
	expanded?: boolean;

	// If an error happens during some evaluation for that element
	// we try to display some information .
	error?: string;
}

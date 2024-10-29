/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IPositronConnectionEntry } from 'vs/workbench/services/positronConnections/browser/positronConnectionsCache';

export interface ConnectionMetadata {
	name: string;
	language_id: string;
	host?: string;
	type?: string;
	code?: string;
	icon?: string;
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

	expanded: boolean | undefined; // Wether the item is currently expanded

	/**
	 * Front-end may fire this event whenever the user clicks the
	 * toggle expand button. Must be implemented if the item is
	 * expandable.
	 */
	onToggleExpandEmitter?: Emitter<void>;

	/**
	 * If the item can be previewed, it should implement this method.
	 */
	preview?(): Promise<void>;

	hasChildren?(): Promise<boolean>;
	getChildren?(): Promise<IPositronConnectionItem[]>;
}

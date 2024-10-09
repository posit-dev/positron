/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';

export interface IPositronConnectionInstance extends IPositronConnectionItem {
	getClientId(): string | undefined;
	disconnect(): void;
}

// This is the interface the front-end needs from a connection instance
// in order to be able to render it nicely.
export interface IPositronConnectionItem {
	name: string;
	kind?: string;

	/**
	 * Those endpoints must make an API call to obtain their values
	 * thus they are async.
	 */
	getIcon(): Promise<string>;
	hasChildren(): Promise<boolean>;
	getChildren?(): Promise<IPositronConnectionItem[]>;

	/**
	 * Wether the connection item is currently expanded.
	 * Should return undefined if the item is not expandable
	 */
	expanded: boolean | undefined;

	/**
	 * Wether the connection item is currently active.
	 * In general it only makes sense for connection roots
	 * that might be in a disconnected state.
	 */
	active: boolean;

	/**
	 * Front-end may fire this event whenever the user clicks the
	 * toggle expand button. Must be implemented if the item is
	 * expandable.
	 */
	onToggleExpandEmitter?: Emitter<void>;

	/**
	 * Items fire this event whenever their data has changed.
	 * Eg. The connections is turned off, or some child was expanded.
	 */
	onDidChangeDataEmitter?: Emitter<void>;

	/***
	 * Items could implement disconnect - but this method is only called
	 * with top level connections.
	 */
	disconnect?(): void;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';

export interface IPositronConnectionInstance extends IPositronConnectionItem {
	getClientId(): string | undefined;
}

// This is the interface the front-end needs from a connection instance
// in order to be able to render it nicely.
export interface IPositronConnectionItem {

	icon(): string;
	name(): string;
	getChildren?(): IPositronConnectionItem[];

	/**
	 * Wether the connection is expanded or not. Undefined
	 * if the connection doesn't is not expandable.
	 */
	expanded(): boolean | undefined;

	/**
	 * Front-end may fire this event whenever the user clicks the
	 * toggle expand button. Must be implemented if the item is
	 * expandable.
	 */
	onToggleExpandEmitter?: Emitter<void>;
}

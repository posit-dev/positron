/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPositronConnectionInstance extends IPositronConnectionItem {
	getClientId(): string | undefined;
}

// This is the interface the front-end needs from a connection instance
// in order to be able to render it nicely.
export interface IPositronConnectionItem {
	getChildren(): IPositronConnectionItem[];
	hasChildren(): boolean;
	icon(): string;
	name(): string;
	/**
	 * Wether the connection is expanded or not. Undefined
	 * if the connection doesn't is not expandable.
	 */
	expanded(): boolean | undefined;
}

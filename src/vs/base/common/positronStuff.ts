/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';

/**
 * IListItem interface.
 */
export interface IListItem {
	/**
	 * Gets the ID of the list item.
	 */
	readonly id: string;

	/**
	 * Gets the height of the list item.
	 */
	readonly height: number;

	/**
	 * Gets the list item element.
	 */
	readonly element: JSX.Element;
}

/**
 * IListItemsProvider interface.
 */
export interface IListItemsProvider {
	/**
	 * Gets the items.
	 */
	readonly listItems: IListItem[];

	/**
	 * Fired when list items changed.
	 */
	onDidChangeListItems: Event<void>;
}

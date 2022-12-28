/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
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
	 * Gets the number of pages.
	 */
	readonly pages: number;

	/**
	 * Gets or sets the current page.
	 */
	currentPage: number;

	/**
	 * Gets the items for the current page.
	 */
	readonly listItems: IListItem[];

	/**
	 * Fired when list items changed.
	 */
	onDidChangeListItems: Event<void>;
}

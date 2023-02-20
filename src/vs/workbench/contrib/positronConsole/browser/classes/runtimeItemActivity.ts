/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/contrib/positronConsole/browser/classes/runtimeItem';
import { ActivityItem } from 'vs/workbench/contrib/positronConsole/browser/classes/activityItem';

/**
 * RuntimeItemActivity class.
 */
export class RuntimeItemActivity extends RuntimeItem {
	//#region Private Properties

	/**
	 * The activity items.
	 */
	public readonly activityItems: ActivityItem[] = [];

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param activityItem The initial activity item.
	 */
	constructor(id: string, activityItem: ActivityItem) {
		super(id);
		this.activityItems.push(activityItem);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an activity item.
	 * @param activityItem The activity item.
	 */
	addActivityItem(activityItem: ActivityItem) {
		this.activityItems.push(activityItem);
	}

	//#endregion Public Methods
}

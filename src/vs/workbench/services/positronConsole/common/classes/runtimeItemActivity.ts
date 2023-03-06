/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';

/**
 * RuntimeItemActivity class.
 */
export class RuntimeItemActivity extends RuntimeItem {
	//#region Private Properties

	/**
	 * The activity items.
	 */
	public readonly activityItems: ActivityItem[] = [];

	// public readonly activityRuns:

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
		this.verifyActivityItemsOrder();
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Verifies the activity items order and resorts the activities, if one is out of order.
	 */
	private verifyActivityItemsOrder() {
		for (let i = 1; i < this.activityItems.length; i++) {
			if (this.activityItems[i].when < this.activityItems[i - 1].when) {
				this.activityItems.sort((x, y) => y.when.getTime() - x.when.getTime());
				return;
			}
		}
	}

	//#endregion Private Methods
}

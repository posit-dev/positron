/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ActivityItemError } from 'vs/workbench/services/positronConsole/common/classes/ativityItemError';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { ActivityItemOutput } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutput';
import { ActivityItemOutputGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputGroup';

/**
 * RuntimeItemActivity class.
 */
export class RuntimeItemActivity extends RuntimeItem {
	//#region Private Properties

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * The activity items.
	 */
	readonly activityItems: (ActivityItemOutputGroup | ActivityItemInput | ActivityItemError)[] = [];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param activityItem The initial activity item.
	 */
	constructor(id: string, activityItem: ActivityItemOutput | ActivityItemInput | ActivityItemError) {
		// Call the base class's constructor.
		super(id);

		// Add the initial activity item.
		this.addActivityItem(activityItem);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an activity item.
	 * @param activityItem The activity item.
	 */
	addActivityItem(activityItem: ActivityItemOutput | ActivityItemInput | ActivityItemError) {
		if (activityItem instanceof ActivityItemOutput) {
			if (this.activityItems.length) {
				const lastActivityItem = this.activityItems[this.activityItems.length - 1];
				if (lastActivityItem instanceof ActivityItemOutputGroup &&
					activityItem.parentId === lastActivityItem.parentId) {
					lastActivityItem.addActivityItemOutput(activityItem);
					return;
				}
			}

			// Push a new output group activity item.
			this.activityItems.push(new ActivityItemOutputGroup(activityItem));
			return;
		}

		this.activityItems.push(activityItem);
		this.verifyActivityItemsOrder();
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Verifies the activity items order and resorts the activities, if one is out of order.
	 */
	private verifyActivityItemsOrder() {
		// for (let i = 1; i < this.activityItems.length; i++) {
		// 	if (this.activityItems[i].when < this.activityItems[i - 1].when) {
		// 		this.activityItems.sort((x, y) => y.when.getTime() - x.when.getTime());
		// 		return;
		// 	}
		// }
	}

	//#endregion Private Methods
}

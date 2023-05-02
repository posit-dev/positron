/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { ActivityItemPrompt } from 'vs/workbench/services/positronConsole/common/classes/activityItemPrompt';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';
import { ActivityItemErrorStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStream';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorMessage';
import { ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStream';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';

/**
 * The ActivityItem type alias.
 */
export type ActivityItem =
	ActivityItemErrorMessage |
	ActivityItemErrorStream |
	ActivityItemInput |
	ActivityItemOutputMessage |
	ActivityItemOutputPlot |
	ActivityItemOutputStream |
	ActivityItemPrompt;

/**
 * RuntimeItemActivity class.
 */
export class RuntimeItemActivity extends RuntimeItem {
	//#region Public Properties

	/**
	 * The activity items.
	 */
	readonly activityItems: ActivityItem[] = [];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param activityItem The initial activity item.
	 */
	constructor(id: string, activityItem: ActivityItem) {
		// Call the base class's constructor.
		super(id);

		// Add the initial activity item.
		this.addActivityItem(activityItem);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an activity item.
	 * @param activityItem The activity item to add.
	 */
	addActivityItem(activityItem: ActivityItem) {
		// Group ActivityItemOutputStreams with the same parent identifier.
		if (activityItem instanceof ActivityItemOutputStream) {
			// If the last activity item is an ActivityItemOutputStream, and it's for the same
			// parent as this ActivityItemOutputStream, add this ActivityItemOutputStream to it.
			if (this.activityItems.length) {
				const lastActivityItem = this.activityItems[this.activityItems.length - 1];
				if (lastActivityItem instanceof ActivityItemOutputStream &&
					activityItem.parentId === lastActivityItem.parentId) {
					lastActivityItem.addActivityItemOutputStream(activityItem);
					return;
				}
			}
		} else if (activityItem instanceof ActivityItemErrorStream) {
			// If the last activity item is an ActivityItemErrorStream, and it's for the same
			// parent as this ActivityItemErrorStream, add this ActivityItemErrorStream to it.
			if (this.activityItems.length) {
				const lastActivityItem = this.activityItems[this.activityItems.length - 1];
				if (lastActivityItem instanceof ActivityItemErrorStream &&
					activityItem.parentId === lastActivityItem.parentId) {
					lastActivityItem.addActivityItemErrorStream(activityItem);
					return;
				}
			}
		}

		// Push the activity item.
		this.activityItems.push(activityItem);
	}

	//#endregion Public Methods
}

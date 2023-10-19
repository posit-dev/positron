/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ActivityItemPrompt } from 'vs/workbench/services/positronConsole/common/classes/activityItemPrompt';
import { ActivityItemOutputHtml } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputHtml';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';
import { ActivityItemInput, ActivityItemInputState } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { ActivityItemErrorStream, ActivityItemOutputStream, ActivityItemStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemStream';

/**
 * The ActivityItem type alias.
 */
export type ActivityItem =
	ActivityItemErrorMessage |
	ActivityItemErrorStream |
	ActivityItemInput |
	ActivityItemOutputHtml |
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
	public addActivityItem(activityItem: ActivityItem) {
		// Perform activity item processing if this is not the first activity item.
		if (this.activityItems.length) {
			// If the activity item being added is an ActivityItemStream, see if we can append it to
			// the last ActivityItemStream of the same time and with the same parent identifier.
			if (activityItem instanceof ActivityItemStream) {
				// Get the last activity item.
				const lastActivityItem = this.activityItems[this.activityItems.length - 1];

				// If the last activity item is an ActivityItemStream of the same type with the same
				// parent identifier, append this ActivityItemStream to it. If this returns another
				// ActivityItemStream, then it becomes the activity item to add.
				if (lastActivityItem instanceof ActivityItemStream &&
					typeof activityItem === typeof lastActivityItem &&
					activityItem.parentId === lastActivityItem.parentId) {
					const activityItemStream = lastActivityItem.addActivityItemStream(activityItem);
					if (!activityItemStream) {
						return;
					}

					// Set the activity item to add.
					activityItem = activityItemStream;
				}
			} else if (activityItem instanceof ActivityItemInput &&
				activityItem.state !== ActivityItemInputState.Provisional) {
				// When a non-provisional ActivityItemInput is being added, see if there's a
				// provisional ActivityItemInput for it in the activity items. If there is, replace
				// the provisional ActivityItemInput with the actual ActivityItemInput.
				for (let i = this.activityItems.length - 1; i >= 0; --i) {
					const activityItemToCheck = this.activityItems[i];
					if (activityItemToCheck instanceof ActivityItemInput) {
						if (activityItemToCheck.state === ActivityItemInputState.Provisional &&
							activityItemToCheck.parentId === activityItem.parentId) {
							this.activityItems[i] = activityItem;
							return;
						}
						break;
					}
				}
			}
		}

		// Push the activity item.
		this.activityItems.push(activityItem);
	}

	//#endregion Public Methods
}

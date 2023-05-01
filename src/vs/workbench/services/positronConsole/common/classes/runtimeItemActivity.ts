/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';
import { ActivityItemErrorStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStream';
import { ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStream';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';
import { ActivityItemErrorStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStreamGroup';
import { ActivityItemOutputStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStreamGroup';

/**
 * The ActivityItem type alias.
 */
export type ActivityItem =
	ActivityItemInput |
	ActivityItemOutputStream |
	ActivityItemErrorStream |
	ActivityItemOutputMessage |
	ActivityItemOutputPlot |
	ActivityItemErrorMessage;

/**
 * The RenderActivityItem type alias.
 */
export type RenderActivityItem =
	ActivityItemInput |
	ActivityItemOutputStreamGroup |
	ActivityItemErrorStreamGroup |
	ActivityItemOutputMessage |
	ActivityItemOutputPlot |
	ActivityItemErrorMessage;

/**
 * RuntimeItemActivity class.
 */
export class RuntimeItemActivity extends RuntimeItem {
	//#region Public Properties

	/**
	 * The render activity items.
	 */
	readonly renderActivityItems: RenderActivityItem[] = [];

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
		// Group ActivityItemOutputStreams into ActivityItemOutputStreamGroups.
		if (activityItem instanceof ActivityItemOutputStream) {
			// If the last activity item is an ActivityItemOutputStreamGroup, and it's for the same
			// parent as this ActivityItemOutputStream, add this ActivityItemOutputStream to it.
			if (this.renderActivityItems.length) {
				const lastActivityItem = this.renderActivityItems[this.renderActivityItems.length - 1];
				if (lastActivityItem instanceof ActivityItemOutputStreamGroup &&
					activityItem.parentId === lastActivityItem.parentId) {
					lastActivityItem.addActivityItemOutputStream(activityItem);
					return;
				}
			}

			// Push a new ActivityItemOutputStreamGroup.
			this.renderActivityItems.push(new ActivityItemOutputStreamGroup(activityItem));
			return;
		}

		// Group ActivityItemErrorStreams into ActivityItemErrorStreamGroups.
		if (activityItem instanceof ActivityItemErrorStream) {
			// If the last activity item is an ActivityItemErrorStreamGroup, and it's for the same
			// parent as this ActivityItemErrorStream, add this ActivityItemErrorStream to it.
			if (this.renderActivityItems.length) {
				const lastActivityItem = this.renderActivityItems[this.renderActivityItems.length - 1];
				if (lastActivityItem instanceof ActivityItemErrorStreamGroup &&
					activityItem.parentId === lastActivityItem.parentId) {
					lastActivityItem.addActivityItemErrorStream(activityItem);
					return;
				}
			}

			// Push a new ActivityItemErrorStreamGroup.
			this.renderActivityItems.push(new ActivityItemErrorStreamGroup(activityItem));
			return;
		}

		// Push the activity item.
		this.renderActivityItems.push(activityItem);
	}

	//#endregion Public Methods
}

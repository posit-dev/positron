/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { ActivityItemErrorStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStream';
import { ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStream';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';
import { ActivityItemErrorStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStreamGroup';
import { ActivityItemOutputStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStreamGroup';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';

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
	readonly activityItems: (ActivityItemInput | ActivityItemOutputStreamGroup | ActivityItemErrorStreamGroup | ActivityItemOutputMessage | ActivityItemOutputPlot | ActivityItemErrorMessage)[] = [];

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param activityItem The initial activity item.
	 */
	constructor(id: string, activityItem: ActivityItemInput | ActivityItemOutputStream | ActivityItemErrorStream | ActivityItemOutputMessage | ActivityItemOutputPlot | ActivityItemErrorMessage) {
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
	addActivityItem(activityItem: ActivityItemInput | ActivityItemOutputStream | ActivityItemErrorStream | ActivityItemOutputMessage | ActivityItemOutputPlot | ActivityItemOutputPlot | ActivityItemErrorMessage) {
		if (activityItem instanceof ActivityItemOutputStream) {
			if (this.activityItems.length) {
				const lastActivityItem = this.activityItems[this.activityItems.length - 1];
				if (lastActivityItem instanceof ActivityItemOutputStreamGroup &&
					activityItem.parentId === lastActivityItem.parentId) {
					lastActivityItem.addActivityItemOutputStream(activityItem);
					return;
				}
			}

			this.activityItems.push(new ActivityItemOutputStreamGroup(activityItem));
			return;
		}

		if (activityItem instanceof ActivityItemErrorStream) {
			if (this.activityItems.length) {
				const lastActivityItem = this.activityItems[this.activityItems.length - 1];
				if (lastActivityItem instanceof ActivityItemErrorStreamGroup &&
					activityItem.parentId === lastActivityItem.parentId
				) {
					lastActivityItem.addActivityItemErrorStream(activityItem);
					return;
				} else {
				}
			}

			this.activityItems.push(new ActivityItemErrorStreamGroup(activityItem));
			return;
		}

		this.activityItems.push(activityItem);
	}

	//#endregion Public Methods

	//#region Private Methods

	//#endregion Private Methods
}

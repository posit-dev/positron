/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItem';
import { ActivityItemPrompt } from 'vs/workbench/services/positronConsole/browser/classes/activityItemPrompt';
import { ActivityItemOutputHtml } from 'vs/workbench/services/positronConsole/browser/classes/activityItemOutputHtml';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/browser/classes/activityItemOutputPlot';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/browser/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/browser/classes/activityItemOutputMessage';
import { ActivityItemInput, ActivityItemInputState } from 'vs/workbench/services/positronConsole/browser/classes/activityItemInput';
import { ActivityItemErrorStream, ActivityItemOutputStream, ActivityItemStream } from 'vs/workbench/services/positronConsole/browser/classes/activityItemStream';

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
 * Checks whether two ActivityItemStream objects are of the same type and have the same parent ID.
 * @param activityItemStream1
 * @param activityItemStream2
 * @returns
 */
const isSameActivityItemStream = (
	activityItemStream1: ActivityItemStream,
	activityItemStream2: ActivityItemStream
) =>
	(
		(activityItemStream1 instanceof ActivityItemOutputStream &&
			activityItemStream2 instanceof ActivityItemOutputStream) ||
		(activityItemStream1 instanceof ActivityItemErrorStream &&
			activityItemStream2 instanceof ActivityItemErrorStream)
	) && activityItemStream1.parentId === activityItemStream2.parentId;

/**
 * RuntimeItemActivity class.
 */
export class RuntimeItemActivity extends RuntimeItem {
	//#region Private Properties

	/**
	 * Gets or sets the activity items.
	 */
	private _activityItems: ActivityItem[] = [];

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the activity items.
	 */
	public get activityItems() {
		return this._activityItems;
	}

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
		if (this._activityItems.length) {
			// If the activity item being added is an ActivityItemStream, see if we can append it to
			// the last ActivityItemStream of the same type with the same parent identifier.
			if (activityItem instanceof ActivityItemStream) {
				// Get the last activity item.
				const lastActivityItem = this._activityItems[this._activityItems.length - 1];
				if (lastActivityItem instanceof ActivityItemStream) {
					// If the ActivityItemStream being added and the last ActivityItemStream are of
					// the same type with the same parent identifier, add the ActivityItemStream
					// being added to the last ActivityItemStream.
					if (isSameActivityItemStream(lastActivityItem, activityItem)) {

						// Add the ActivityItemStream being added to the last ActivityItemStream. If
						// an ActivityItemStream is returned, it becomes the next activity item to
						// add.
						const activityItemStream = lastActivityItem.addActivityItemStream(activityItem);
						if (!activityItemStream) {
							return;
						}

						// Set the activity item to add.
						activityItem = activityItemStream;
					}
				}
			} else if (activityItem instanceof ActivityItemInput &&
				activityItem.state !== ActivityItemInputState.Provisional) {
				// When a non-provisional ActivityItemInput is being added, see if there's a
				// provisional ActivityItemInput for it in the activity items. If there is, replace
				// the provisional ActivityItemInput with the actual ActivityItemInput.
				for (let i = this._activityItems.length - 1; i >= 0; --i) {
					const activityItemToCheck = this._activityItems[i];
					if (activityItemToCheck instanceof ActivityItemInput) {
						if (activityItemToCheck.state === ActivityItemInputState.Provisional &&
							activityItemToCheck.parentId === activityItem.parentId) {
							this._activityItems[i] = activityItem;
							return;
						}
						break;
					}
				}
			}
		}

		// Push the activity item.
		this._activityItems.push(activityItem);
	}

	/**
	 * Trims activity items.
	 * @param max The maximum number of activity items to keep.
	 */
	public trimActivityItems(max: number) {
		// Slice the array of activity items.
		this._activityItems = this._activityItems.slice(-max);

		// Return the count of activity items.
		return this._activityItems.length;
	}

	//#endregion Public Methods
}

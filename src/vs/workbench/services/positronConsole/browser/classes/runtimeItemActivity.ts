/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from './runtimeItem.js';
import { ActivityItemStream } from './activityItemStream.js';
import { ActivityItemPrompt } from './activityItemPrompt.js';
import { ActivityItemOutputHtml } from './activityItemOutputHtml.js';
import { ActivityItemOutputPlot } from './activityItemOutputPlot.js';
import { ActivityItemErrorMessage } from './activityItemErrorMessage.js';
import { ActivityItemOutputMessage } from './activityItemOutputMessage.js';
import { ActivityItemInput, ActivityItemInputState } from './activityItemInput.js';

/**
 * The ActivityItem type alias.
 */
export type ActivityItem =
	ActivityItemStream |
	ActivityItemErrorMessage |
	ActivityItemInput |
	ActivityItemOutputHtml |
	ActivityItemOutputMessage |
	ActivityItemOutputPlot |
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
	activityItemStream1.type === activityItemStream2.type &&
	activityItemStream1.parentId === activityItemStream2.parentId;

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
			} else if (activityItem instanceof ActivityItemInput && activityItem.state !== ActivityItemInputState.Provisional) {
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
	 * Gets the clipboard representation of the runtime item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the runtime item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return this._activityItems.flatMap(activityItem =>
			activityItem.getClipboardRepresentation(commentPrefix)
		);
	}

	/**
	 * Optimizes scrollback.
	 * @param scrollbackSize The scrollback size.
	 * @returns The remaining scrollback size.
	 */
	public override optimizeScrollback(scrollbackSize: number) {
		// If scrollback size is zero, hide the item and return zero.
		if (scrollbackSize === 0) {
			this._isHidden = true;
			return 0;
		}

		// Unhide the item.
		this._isHidden = false;

		// Optimize scrollback for each activity item in reverse order.
		for (let i = this._activityItems.length - 1; i >= 0; i--) {
			scrollbackSize = this._activityItems[i].optimizeScrollback(scrollbackSize);
		}

		// Return the remaining scrollback size.
		return scrollbackSize;
	}

	//#endregion Public Methods
}

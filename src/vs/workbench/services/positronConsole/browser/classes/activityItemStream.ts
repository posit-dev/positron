/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * ActivityItemStreamType enum.
 */
export enum ActivityItemStreamType {
	OUTPUT = 'output',
	ERROR = 'error'
}

/**
 * ActivityItemStream class.
 */
export class ActivityItemStream extends ActivityItem {
	//#region Private Properties

	/**
	 * Gets or sets a value which indicates whether this ActivityItemStream is terminated.
	 */
	private _terminated = false;

	/**
	 * Gets the ActivityItemStream array.
	 */
	private _activityItemStreams: ActivityItemStream[] = [];

	/**
	 * Gets the ANSIOutput.
	 */
	private _ansiOutput = new ANSIOutput();

	/**
	 * Gets or sets the scrollback size. This is used to truncate the output lines for display.
	 */
	private _scrollbackSize?: number;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	get outputLines(): readonly ANSIOutputLine[] {
		// Process the activity items streams.
		this.processActivityItemStreams();

		// If scrollback size is undefined, return all of the output lines.
		if (this._scrollbackSize === undefined) {
			return this._ansiOutput.outputLines;
		}

		// Return the truncated output lines.
		return this._ansiOutput.truncatedOutputLines(this._scrollbackSize);
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param type The type.
	 * @param text The text.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly type: ActivityItemStreamType,
		readonly text: string
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Initialize.
		this._activityItemStreams.push(this);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemStream to this ActivityItemStream.
	 * @param activityItemStream The ActivityItemStream to add.
	 * @returns The remainder ActivityItemStream, or undefined.
	 */
	public addActivityItemStream(activityItemStream: ActivityItemStream): ActivityItemStream | undefined {
		// If this ActivityItemStream is terminated, copy its styles to the ActivityItemStream being
		// added and return it as the remainder ActivityItemStream to be processed.
		if (this._terminated) {
			activityItemStream._ansiOutput.copyStylesFrom(this._ansiOutput);
			return activityItemStream;
		}

		// Get the index of the last newline in the ActivityItemStream that's being added. If there
		// isn't a newline in the ActivityItemStream that's being added, then just add it to the
		// activity item streams and return undefined, indicating that there is no remainder
		// ActivityItemStream to be processed.
		const newlineIndex = activityItemStream.text.lastIndexOf('\n');
		if (newlineIndex === -1) {
			this._activityItemStreams.push(activityItemStream);
			return undefined;
		}

		// Split the text of the ActivityItemStream that's being added at the last newline.
		const textWithNewline = activityItemStream.text.substring(0, newlineIndex + 1);
		const remainderText = activityItemStream.text.substring(newlineIndex + 1);

		// Add an ActivityItemStream with the text containing the newline.
		this._activityItemStreams.push(activityItemStream.clone(textWithNewline));

		// Process the activity item streams so we can tell if the ANSIOutput winds up in the
		// buffering state.
		this.processActivityItemStreams();

		// Update the terminated flag.
		this._terminated = !this._ansiOutput.isBuffering;

		// If there is no remainder text, return undefined, indicating that there is no remainder
		// ActivityItemStream to be processed.
		if (!remainderText.length) {
			return undefined;
		}

		// Create the remainder ActivityItemStream.
		activityItemStream = activityItemStream.clone(remainderText);

		// If this ActivityItemStream isn't terminated, push the remainder ActivityItemStream to it
		// and return undefined, indicating that there is no remainder ActivityItemStream to be
		// processed.
		if (!this._terminated) {
			this._activityItemStreams.push(activityItemStream);
			return undefined;
		}

		// Return the remainder ActivityItemStream to be processed.
		activityItemStream._ansiOutput.copyStylesFrom(this._ansiOutput);
		return activityItemStream;
	}

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return formatOutputLinesForClipboard(this._ansiOutput.outputLines, commentPrefix);
	}

	/**
	 * Optimizes scrollback.
	 * @param scrollbackSize The scrollback size.
	 * @returns The remaining scrollback size.
	 */
	public override optimizeScrollback(scrollbackSize: number) {
		// Process the activity items streams.
		this.processActivityItemStreams();

		// If there are fewer output lines than the scrollback size, clear the scrollback size
		// as all of them will be displayed, and return the remaining scrollback size.
		if (this._ansiOutput.outputLines.length <= scrollbackSize) {
			this._scrollbackSize = undefined;
			return scrollbackSize - this._ansiOutput.outputLines.length;
		}

		// Set the scrollback size and return 0
		this._scrollbackSize = scrollbackSize;
		return 0;
	}

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Clones this ActivityItemStream with new text.
	 * @param text The new text.
	 * @returns A clone of this ActivityItemStream with new text.
	 */
	private clone(text: string) {
		return new ActivityItemStream(
			this.id,
			this.parentId,
			this.when,
			this.type,
			text
		);
	}

	/**
	 * Processes the activity item streams.
	 */
	private processActivityItemStreams() {
		// If there are no activity item streams, return.
		if (!this._activityItemStreams.length) {
			return;
		}

		// Process the activity item streams.
		for (const activityItemStream of this._activityItemStreams) {
			this._ansiOutput.processOutput(activityItemStream.text);
		}

		// Clear the activity item streams.
		this._activityItemStreams = [];
	}

	//#endregion Private Methods
}

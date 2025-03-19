/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
import { ScrollbackStrategy } from '../positronConsoleService.js';
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
	private terminated = false;

	/**
	 * Gets the ActivityItemStream array.
	 */
	private activityItemStreams: ActivityItemStream[] = [];

	/**
	 * Gets the ANSIOutput.
	 */
	private ansiOutput = new ANSIOutput();

	/**
	 * Gets or sets the scrollback size. This is used to truncate the output lines for display.
	 */
	private scrollbackSize?: number;

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	get outputLines(): ANSIOutputLine[] {
		// Process the activity items streams.
		this.processActivityItemStreams();

		// If scrollback size is undefined, return all of the output lines.
		if (this.scrollbackSize === undefined) {
			return this.ansiOutput.outputLines;
		}

		// Return the truncated output lines.
		return this.ansiOutput.truncatedOutputLines(this.scrollbackSize);
	}

	/**
	 * Gets the clipboard representation.
	 */
	get clipboardRepresentation() {
		return this.ansiOutput.clipboardRepresentation;
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
		this.activityItemStreams.push(this);
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
		if (this.terminated) {
			activityItemStream.ansiOutput.copyStylesFrom(this.ansiOutput);
			return activityItemStream;
		}

		// Get the index of the last newline in the ActivityItemStream that's being added. If there
		// isn't a newline in the ActivityItemStream that's being added, then just add it to the
		// activity item streams and return undefined, indicating that there is no remainder
		// ActivityItemStream to be processed.
		const newlineIndex = activityItemStream.text.lastIndexOf('\n');
		if (newlineIndex === -1) {
			this.activityItemStreams.push(activityItemStream);
			return undefined;
		}

		// Split the text of the ActivityItemStream that's being added at the last newline.
		const textWithNewline = activityItemStream.text.substring(0, newlineIndex + 1);
		const remainderText = activityItemStream.text.substring(newlineIndex + 1);

		// Add an ActivityItemStream with the text containing the newline.
		this.activityItemStreams.push(activityItemStream.clone(textWithNewline));

		// Process the activity item streams so we can tell if the ANSIOutput winds up in the
		// buffering state.
		this.processActivityItemStreams();

		// Update the terminated flag.
		this.terminated = !this.ansiOutput.isBuffering;

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
		if (!this.terminated) {
			this.activityItemStreams.push(activityItemStream);
			return undefined;
		}

		// Return the remainder ActivityItemStream to be processed.
		activityItemStream.ansiOutput.copyStylesFrom(this.ansiOutput);
		return activityItemStream;
	}

	/**
	 * Optimizes scrollback.
	 * @param scrollbackSize The scrollback size.
	 * @param scrollbackStrategy The scrollback strategy.
	 * @returns The remaining scrollback size.
	 */
	public override optimizeScrollback(scrollbackSize: number, scrollbackStrategy: ScrollbackStrategy) {
		// Process the activity items streams.
		this.processActivityItemStreams();

		// If there are fewer output lines than the scrollback size, clear the scrollback size
		// as all of them will be displayed, and return the remaining scrollback size.
		if (this.ansiOutput.outputLines.length <= scrollbackSize) {
			this.scrollbackSize = undefined;
			return scrollbackSize - this.ansiOutput.outputLines.length;
		}

		// Set the scrollback size and return 0
		this.scrollbackSize = scrollbackSize;
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
		if (!this.activityItemStreams.length) {
			return;
		}

		// Process the activity item streams.
		for (const activityItemStream of this.activityItemStreams) {
			this.ansiOutput.processOutput(activityItemStream.text);
		}

		// Clear the activity item streams.
		this.activityItemStreams = [];
	}

	//#endregion Private Methods
}

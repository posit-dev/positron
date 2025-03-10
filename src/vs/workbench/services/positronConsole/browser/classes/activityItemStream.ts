/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
export class ActivityItemStream {
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
	 * Gets the ANSIOutput that is processing this ActivityItemStream.
	 */
	private ansiOutput = new ANSIOutput();

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	get outputLines(): ANSIOutputLine[] {
		// Process the activity items streams.
		this.processActivityItemStreams();

		// Return the output lines.
		return this.ansiOutput.outputLines;
	}

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param type The type.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param text The text.
	 */
	constructor(
		readonly type: ActivityItemStreamType,
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly text: string
	) {
		this.activityItemStreams.push(this);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Adds an ActivityItemStream to this ActivityItemStream.
	 * @param activityItemStream The ActivityItemStream to add.
	 * @returns The remainder ActivityItemStream, or undefined.
	 */
	public addActivityItemStream(
		activityItemStream: ActivityItemStream
	): ActivityItemStream | undefined {
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

	//#endregion Public Methods

	//#region Private Methods

	/**
	 * Clones this ActivityItemStream with new text.
	 * @param text The new text.
	 * @returns A clone of this ActivityItemStream with new text.
	 */
	private clone(text: string) {
		return new ActivityItemStream(
			this.type,
			this.id,
			this.parentId,
			this.when,
			text
		);
	}

	/**
	 * Processes the activity item streams.
	 */
	private processActivityItemStreams() {
		if (this.activityItemStreams.length) {
			for (const activityItemStream of this.activityItemStreams) {
				this.ansiOutput.processOutput(activityItemStream.text);
			}

			this.activityItemStreams = [];
		}
	}

	//#endregion Private Methods
}

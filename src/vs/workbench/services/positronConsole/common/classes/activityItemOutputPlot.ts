/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';

/**
 * ActivityItemOutputPlot class.
 */
export class ActivityItemOutputPlot {
	//#region Public Properties

	/**
	 * Gets the message output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	/**
	 * Gets the plot data, as a Base64-encoded string suitable for use in a data URI.
	 */
	readonly plotUri: string;

	/**
	 * Gets the plot's MIME type, e.g. "image/png" or "image/jpeg"
	 */
	readonly mimeType: string;

	//#endregion Public Properties

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param data The data.
	 */
	constructor(
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly data: Record<string, string>
	) {
		// Get the output; this will serve as the figure caption.
		const output = data['text/plain'];

		// Find the first key in the data that starts with "image/". This is the MIME type, and is
		// guaranteed to exist since we only create this object if there is an image.
		const imageKey = Object.keys(data).find(key => key.startsWith('image/'));

		// Get the MIME type and data.
		this.mimeType = imageKey!;
		this.plotUri = `data:${this.mimeType};base64,${data[imageKey!]}`;

		// If the output is empty, don't render any output lines; otherwise, process the output into
		// output lines.
		this.outputLines = !output ? [] : ANSIOutput.processOutput(output);
	}

	//#endregion Constructor
}

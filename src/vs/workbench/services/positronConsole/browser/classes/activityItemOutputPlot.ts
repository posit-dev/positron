/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * ActivityItemOutputPlot class.
 */
export class ActivityItemOutputPlot extends ActivityItem {
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
	 * @param onSelected A callback that is invoked when the item is selected.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly data: Record<string, string>,
		readonly onSelected: () => void
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Get the output; this will serve as the figure caption.
		const output = data['text/plain'];

		// Find the first key in the data that starts with "image/". This is the MIME type, and is
		// guaranteed to exist since we only create this object if there is an image.
		const imageKey = Object.keys(data).find(key => key.startsWith('image/'));

		// Get the MIME type and data.
		this.mimeType = imageKey!;
		if (this.mimeType === 'image/svg+xml') {
			const svgData = encodeURIComponent(data[imageKey!]);
			this.plotUri = `data:${this.mimeType};utf8,${svgData}`;
		} else {
			this.plotUri = `data:${this.mimeType};base64,${data[imageKey!]}`;
		}

		// If the output is empty, don't render any output lines; otherwise, process the output into
		// output lines.
		this.outputLines = !output ? [] : ANSIOutput.processOutput(output);
	}

	//#endregion Constructor
}

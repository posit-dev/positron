/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem, TrimScrollbackResult } from './activityItem.js';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';
import { ILanguageRuntimeMessageOutputData } from '../../../languageRuntime/common/languageRuntimeService.js';

/**
 * ActivityItemOutputPlot class.
 */
export class ActivityItemOutputPlot extends ActivityItem {
	//#region Public Properties

	/**
	 * Gets the output lines.
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
	 * @param outputId The optional identifier of the output associated with this activity item.
	 * @param isNotebookConsolePlot Whether this plot was emitted by a notebook
	 *   and previewed in its console. When true, the preview height (and whether
	 *   the preview is shown at all) is governed by the
	 *   `console.notebookPlotPreviewHeight` setting.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly data: ILanguageRuntimeMessageOutputData,
		readonly onSelected: () => void,
		readonly outputId?: string,
		readonly isNotebookConsolePlot: boolean = false,
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
			const svgData = encodeURIComponent(data[this.mimeType]!);
			this.plotUri = `data:${this.mimeType};utf8,${svgData}`;
		} else {
			this.plotUri = `data:${this.mimeType};base64,${data[this.mimeType]!}`;
		}

		// If the output is empty, don't render any output lines; otherwise, process the output into
		// output lines.
		this.outputLines = !output ? [] : ANSIOutput.processOutput(output);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Trim scrollback.
	 * @param scrollbackSize A number representing the scrollback size.
	 * @returns A TrimScrollbackResult indicating the result of the trim scrollback operation.
	 */
	public override trimScrollback(scrollbackSize: number): TrimScrollbackResult {
		// We should never be called with a scrollback size <= 0.
		if (scrollbackSize <= 0) {
			return {
				trimmed: false,
				remainingScrollbackSize: 0
			};
		}

		// Counts as one scrollback item; nothing is trimmed in place.
		return {
			trimmed: false,
			remainingScrollbackSize: scrollbackSize - 1
		};
	}

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		return formatOutputLinesForClipboard(this.outputLines, commentPrefix);
	}

	//#endregion Public Methods
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * Formats an array of output lines for the clipboard.
 * @param outputLines The output lines.
 * @param prefix The optional prefix to use.
 * @returns The formatted output lines for the clipboard.
 */
export const formatOutputLinesForClipboard = (outputLines: readonly ANSIOutputLine[], prefix?: string): string[] => {
	// Map the output lines to formatted output lines.
	return outputLines.map(outputLine => {
		// Create the formatted output line.
		const formattedOutputLine = outputLine.outputRuns.map(outputRun => {
			if (outputRun.hyperlink) {
				return outputRun.text + ' (' + outputRun.hyperlink + ') ';
			} else {
				return outputRun.text;
			}
		}).join('');

		// Return the formatted output line.
		return prefix ? prefix + formattedOutputLine : formattedOutputLine;
	});
};

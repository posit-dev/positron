/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IBuffer, IMarker } from '@xterm/xterm';

/** The longest line returned, in characters. Longer lines are cut and marked. */
export const MAX_LINE_LENGTH = 1_000;

/** Ends a line that was cut at `MAX_LINE_LENGTH`. */
export const TRUNCATED_MARKER = ' [truncated]';

export interface ICommandOutput {
	readonly lines: string[];
	/** Whether the output's first lines scrolled out of the buffer. */
	readonly trimmed: boolean;
}

/**
 * A command's output as the terminal shows it: the buffer lines from `start`
 * up to `end`, or to the cursor while the command runs. Wrapped lines are
 * joined, and trailing blank lines are dropped. If `start` scrolled out of the
 * buffer, the output begins at the buffer's first line. A command with no
 * `start`, such as one that ended without running, has no output.
 */
export function readCommandOutput(buffer: IBuffer, start: IMarker | undefined, end: IMarker | undefined): ICommandOutput {
	if (!start) {
		return { lines: [], trimmed: false };
	}
	const trimmed = start.isDisposed || start.line < 0;
	if (end && (end.isDisposed || end.line < 0)) {
		return { lines: [], trimmed: true };
	}
	const first = trimmed ? 0 : start.line;
	const last = end ? end.line : buffer.baseY + buffer.cursorY + 1;
	const lines: string[] = [];
	let current = '';
	for (let y = first; y < last; y++) {
		const line = buffer.getLine(y);
		if (!line) {
			continue;
		}
		// A wrapped line continues on the next row, which carries the flag.
		const wraps = y + 1 < last && buffer.getLine(y + 1)?.isWrapped === true;
		current += line.translateToString(!wraps);
		if (!wraps) {
			lines.push(current);
			current = '';
		}
	}
	while (lines.length && !lines[lines.length - 1].trim()) {
		lines.pop();
	}
	return { lines, trimmed };
}

/** Cuts a line longer than `MAX_LINE_LENGTH`, marking it. */
export function truncateLine(line: string): string {
	return line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + TRUNCATED_MARKER : line;
}

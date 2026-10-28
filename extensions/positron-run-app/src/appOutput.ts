/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Keep this module free of `vscode` imports, direct or indirect, so Vitest can
// load it.

import { removeAnsiEscapeCodes } from './utils';

/** How many lines an app's output keeps, dropping the oldest: the console's default scrollback. */
export const MAX_LINES = 10_000;

/** The longest line kept, in characters. Longer lines are cut and marked. */
export const MAX_LINE_LENGTH = 1_000;

/** How long an unfinished escape sequence is held for the next chunk before it is dropped. */
export const MAX_PENDING_ESCAPE = 256;

/** How many lines a read returns by default. */
export const DEFAULT_READ_LINES = 100;

/** The most lines a read returns. */
export const MAX_READ_LINES = 1_000;

/** Ends a line that was cut at `MAX_LINE_LENGTH`. */
export const TRUNCATED_MARKER = ' [truncated]';

const ESC = '\x1b';
const BEL = '\x07';

/** OSC sequences ended by ST (`ESC \`), which `removeAnsiEscapeCodes` doesn't match. Never spans a BEL. */
const OSC_ST_SEQUENCE = /\x1b\][^\x07]*?\x1b\\/g;

/**
 * What `removeAnsiEscapeCodes` leaves of other escape sequences: character set
 * designations (`ESC ( B`, which `tput sgr0` writes) and two-character
 * sequences (`ESC 7`, `ESC =`).
 */
const OTHER_ESCAPE_SEQUENCE = /\x1b(?:[()*+].|[^\[\]])/g;

/** Control characters that are dropped: all but tab, line feed, and carriage return. */
const SPECIAL_CHARACTER = /[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Remove the escape sequences from complete text. */
export function removeEscapes(text: string): string {
	return removeAnsiEscapeCodes(text.replace(OSC_ST_SEQUENCE, '')).replace(OTHER_ESCAPE_SEQUENCE, '');
}

/**
 * Where `text` ends in an escape sequence that is not finished yet, so the rest
 * of it may be in the next chunk.
 *
 * @returns The index of the unfinished sequence's `ESC`, or -1 if there is none.
 */
function unfinishedEscapeStart(text: string): number {
	let i = text.indexOf(ESC);
	while (i >= 0 && i < text.length) {
		const next = text[i + 1];
		if (next === undefined) {
			return i;
		}
		let end: number;
		if (next === '[') {
			// CSI: parameter and intermediate bytes, then a final byte.
			end = i + 2;
			while (end < text.length && text.charCodeAt(end) >= 0x20 && text.charCodeAt(end) <= 0x3f) {
				end++;
			}
			if (end >= text.length) {
				return i;
			}
			const code = text.charCodeAt(end);
			if (code >= 0x40 && code <= 0x7e) {
				end++;
			}
		} else if (next === ']') {
			// OSC: ended by BEL or ST.
			const bel = text.indexOf(BEL, i + 2);
			const st = text.indexOf(`${ESC}\\`, i + 2);
			if (bel < 0 && st < 0) {
				return i;
			}
			end = st < 0 || (bel >= 0 && bel < st) ? bel + 1 : st + 2;
		} else if ('()*+'.includes(next)) {
			if (i + 2 >= text.length) {
				return i;
			}
			end = i + 3;
		} else {
			end = i + 2;
		}
		i = text.indexOf(ESC, end);
	}
	return -1;
}

/** Which lines to read. */
export interface ReadOptions {
	/** How many lines, at most. Defaults to `DEFAULT_READ_LINES`, at most `MAX_READ_LINES`. */
	readonly lines?: number;
	/** The number of the first line to read, reading forward. Omit for the most recent lines. */
	readonly offset?: number;
}

/** Lines read from an app's output. */
export interface OutputLines {
	/** The lines, joined with newlines. */
	readonly text: string;
	/** The number of the first returned line, counted from 1 over the app's whole output; 0 when none. */
	readonly firstLine: number;
	/** The number of the last returned line; 0 when none. */
	readonly lastLine: number;
	/** Every line the app has printed, including dropped ones. */
	readonly totalLines: number;
	/** Lines no longer kept, from the start of the app's output. */
	readonly droppedLines: number;
	/** Whether kept lines older than `firstLine` exist. */
	readonly moreBefore: boolean;
}

/** How many characters `text` takes in a JSON string. */
function serializedLength(text: string): number {
	return JSON.stringify(text).length - 2;
}

/**
 * An app's output as plain text lines: escape sequences stripped, line endings
 * normalized, trailing whitespace dropped, and a line redrawn with `\r` (a
 * progress bar) kept as its last state. Keeps the most recent `MAX_LINES` lines.
 *
 * Lines are numbered from 1 over the app's whole output, so a line's number
 * doesn't change as older lines are dropped.
 */
export class AppOutput {
	/** Completed lines, oldest first. */
	private readonly _lines: string[] = [];
	/** How many lines have been dropped from the front of `_lines`. */
	private _dropped = 0;
	/** The line being written, with no newline yet. */
	private _current = '';
	/** Whether `_current` lost characters to `MAX_LINE_LENGTH`. */
	private _currentTruncated = false;
	/** A `\r` was seen and nothing has followed it yet. */
	private _pendingCR = false;
	/** An escape sequence cut off at the end of a chunk, held until the next one. */
	private _pendingEscape = '';

	/** Every line the app has printed, including dropped ones and the line being written. */
	get totalLines(): number {
		return this._dropped + this._lines.length + (this._currentLine() ? 1 : 0);
	}

	append(chunk: string): void {
		let text = this._pendingEscape + chunk;
		this._pendingEscape = '';

		const escapeStart = unfinishedEscapeStart(text);
		if (escapeStart >= 0) {
			const tail = text.slice(escapeStart);
			// A longer tail isn't an escape sequence worth waiting for, and
			// holding it would hold back all later output.
			if (tail.length <= MAX_PENDING_ESCAPE) {
				this._pendingEscape = tail;
			}
			text = text.slice(0, escapeStart);
		}

		text = removeEscapes(text);

		let start = 0;
		SPECIAL_CHARACTER.lastIndex = 0;
		for (; ;) {
			const match = SPECIAL_CHARACTER.exec(text);
			const end = match ? match.index : text.length;
			if (end > start) {
				this._write(text.slice(start, end));
			}
			if (!match) {
				break;
			}
			const character = match[0];
			if (character === '\r') {
				this._pendingCR = true;
			} else if (character === '\n') {
				this._pushLine();
			} else {
				// Another control character: drop it, but it still ends a redraw.
				this._clearIfRedrawn();
			}
			start = end + 1;
		}
	}

	/** Read the most recent lines, or the lines from `offset`, within `budget` characters of JSON string. */
	read(options: ReadOptions, budget: number): OutputLines {
		const count = Math.min(Math.max(Math.floor(options.lines ?? DEFAULT_READ_LINES), 1), MAX_READ_LINES);
		const oldest = this._dropped + 1;
		const newest = this.totalLines;
		const droppedLines = this._dropped;

		const lines: string[] = [];
		let size = 0;
		const fits = (line: string) => {
			const added = serializedLength(line) + (lines.length ? 2 : 0);
			if (lines.length && size + added > budget) {
				return false;
			}
			size += added;
			return true;
		};

		let firstLine = 0;
		let lastLine = 0;
		if (options.offset === undefined) {
			for (let n = newest; n >= oldest && lines.length < count; n--) {
				const line = this._line(n);
				if (!fits(line)) {
					break;
				}
				lines.unshift(line);
				firstLine = n;
				lastLine = lastLine || n;
			}
		} else {
			for (let n = Math.max(Math.floor(options.offset), oldest); n <= newest && lines.length < count; n++) {
				const line = this._line(n);
				if (!fits(line)) {
					break;
				}
				lines.push(line);
				firstLine = firstLine || n;
				lastLine = n;
			}
		}

		return {
			text: lines.join('\n'),
			firstLine,
			lastLine,
			totalLines: newest,
			droppedLines,
			// With no lines returned, any kept line counts as older.
			moreBefore: (firstLine || newest + 1) > oldest,
		};
	}

	/** The line numbered `n`, which must be kept or be the line being written. */
	private _line(n: number): string {
		const index = n - this._dropped - 1;
		return index < this._lines.length ? this._lines[index] : this._currentLine();
	}

	/**
	 * The line being written, as it reads. Trailing whitespace is dropped: a
	 * shell such as zsh pads the end of a command's output with spaces.
	 */
	private _currentLine(): string {
		const line = this._current.trimEnd();
		return line && this._currentTruncated ? line + TRUNCATED_MARKER : line;
	}

	/** Clear the line if a `\r` before this character means it's being redrawn. */
	private _clearIfRedrawn(): void {
		if (this._pendingCR) {
			this._current = '';
			this._currentTruncated = false;
			this._pendingCR = false;
		}
	}

	/** Append printable text to the line being written, up to `MAX_LINE_LENGTH`. */
	private _write(text: string): void {
		this._clearIfRedrawn();
		const room = MAX_LINE_LENGTH - this._current.length;
		if (text.length > room) {
			this._currentTruncated = true;
		}
		if (room > 0) {
			this._current += text.slice(0, room);
		}
	}

	private _pushLine(): void {
		this._lines.push(this._currentLine());
		this._current = '';
		this._currentTruncated = false;
		this._pendingCR = false;
		while (this._lines.length > MAX_LINES) {
			this._lines.shift();
			this._dropped++;
		}
	}
}

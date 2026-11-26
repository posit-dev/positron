/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** The most lines a command's output keeps, dropping the oldest. */
export const MAX_RETAINED_LINES = 10_000;

/** The longest line kept, in characters. Longer lines are cut and marked. */
export const MAX_LINE_LENGTH = 1_000;

/** How many lines past `MAX_RETAINED_LINES` accumulate before the oldest are dropped. */
const DROP_BATCH = 1_000;

/** Ends a line that was cut at `MAX_LINE_LENGTH`. */
export const TRUNCATED_MARKER = ' [truncated]';

/** How long an unfinished escape sequence is held for the next chunk before it is dropped. */
const MAX_PENDING_ESCAPE = 4_096;

const ESC = '\x1b';
const BEL = '\x07';

/** A piece of a terminal's data stream, with escape sequences removed. */
export type ShellStreamToken =
	| { readonly type: 'text'; readonly text: string }
	/** The shell reported the command line it is about to run (OSC 633;E). */
	| { readonly type: 'commandLine'; readonly commandLine: string }
	/** The command started running; its output follows (OSC 633;C or 133;C). */
	| { readonly type: 'executed' }
	/** The command finished (OSC 633;D or 133;D). */
	| { readonly type: 'finished'; readonly exitCode: number | undefined };

/**
 * Splits a terminal's raw data stream into text and the shell integration
 * markers that bound each command. Removes every escape sequence, including
 * ones split across chunks.
 */
export class ShellStreamParser {
	private _pending = '';

	parse(data: string): ShellStreamToken[] {
		const input = this._pending + data;
		this._pending = '';
		const tokens: ShellStreamToken[] = [];
		let text = '';
		const flushText = () => {
			if (text) {
				tokens.push({ type: 'text', text });
				text = '';
			}
		};

		let i = 0;
		while (i < input.length) {
			const esc = input.indexOf(ESC, i);
			if (esc < 0) {
				text += input.slice(i);
				break;
			}
			text += input.slice(i, esc);
			const end = escapeEnd(input, esc);
			if (end < 0) {
				const rest = input.slice(esc);
				if (rest.length <= MAX_PENDING_ESCAPE) {
					this._pending = rest;
				}
				break;
			}
			if (input[esc + 1] === ']') {
				const token = parseShellIntegrationSequence(input.slice(esc + 2, oscPayloadEnd(input, end)));
				if (token) {
					flushText();
					tokens.push(token);
				}
			}
			i = end;
		}
		flushText();
		return tokens;
	}
}

/**
 * Where the escape sequence at `start` ends (exclusive).
 *
 * @returns The index after the sequence, or -1 if it isn't finished yet.
 */
function escapeEnd(text: string, start: number): number {
	const next = text[start + 1];
	if (next === undefined) {
		return -1;
	}
	if (next === '[') {
		// CSI: parameter and intermediate bytes, then a final byte.
		let i = start + 2;
		while (i < text.length) {
			const code = text.charCodeAt(i);
			if (code >= 0x40 && code <= 0x7e) {
				return i + 1;
			}
			if (code < 0x20 || code > 0x3f) {
				// Malformed: drop the introducer only.
				return i;
			}
			i++;
		}
		return -1;
	}
	if (next === ']' || next === 'P' || next === '_' || next === '^') {
		// OSC, DCS, APC, PM: ended by BEL (OSC only) or ST.
		for (let i = start + 2; i < text.length; i++) {
			if (text[i] === BEL && next === ']') {
				return i + 1;
			}
			if (text[i] === ESC) {
				if (i + 1 >= text.length) {
					return -1;
				}
				if (text[i + 1] === '\\') {
					return i + 2;
				}
			}
		}
		return -1;
	}
	if ('()*+'.includes(next)) {
		// Character set designation.
		return start + 3 <= text.length ? start + 3 : -1;
	}
	return start + 2;
}

/** The end of an OSC sequence's payload, given the end of the sequence. */
function oscPayloadEnd(text: string, end: number): number {
	return text[end - 1] === BEL ? end - 1 : end - 2;
}

function parseShellIntegrationSequence(payload: string): ShellStreamToken | undefined {
	const [code, kind, ...args] = payload.split(';');
	if (code !== '633' && code !== '133') {
		return undefined;
	}
	switch (kind) {
		case 'C':
			return { type: 'executed' };
		case 'D': {
			const exitCode = args.length && args[0] !== '' ? Number(args[0]) : NaN;
			return { type: 'finished', exitCode: Number.isInteger(exitCode) ? exitCode : undefined };
		}
		case 'E':
			return code === '633' && args.length ? { type: 'commandLine', commandLine: deserializeMessage(args[0]) } : undefined;
		default:
			return undefined;
	}
}

/** Decodes a value escaped by the shell integration scripts. */
function deserializeMessage(message: string): string {
	return message.replace(/\\(\\|x([0-9a-f]{2}))/gi, (_, escaped: string, hex?: string) =>
		hex ? String.fromCharCode(parseInt(hex, 16)) : escaped);
}

/** Control characters that are dropped: all but tab, line feed, and carriage return. */
const DROPPED_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** {@link OutputLines} as saved across a window reload. */
export interface ISerializedOutputLines {
	readonly dropped: number;
	readonly lines: string[];
	readonly current: string;
}

/**
 * A command's output as lines. A carriage return not followed by a line feed
 * starts the line over, so progress bars keep only their last state. Keeps at
 * least the newest `MAX_RETAINED_LINES` lines, numbered from the start of the
 * output.
 */
export class OutputLines {
	private readonly _lines: string[] = [];
	private _dropped = 0;
	private _current = '';
	private _pendingCarriageReturn = false;

	/** Restores output saved with {@link serialize}. */
	static deserialize(saved: ISerializedOutputLines): OutputLines {
		const output = new OutputLines();
		output._lines.push(...saved.lines);
		output._dropped = saved.dropped;
		output._current = saved.current;
		return output;
	}

	/** The output to save, keeping at most the newest `maxLines` complete lines. */
	serialize(maxLines: number): ISerializedOutputLines {
		const excess = Math.max(0, this._lines.length - maxLines);
		return { dropped: this._dropped + excess, lines: this._lines.slice(excess), current: this._current };
	}

	/** How many lines were dropped from the start to stay within `MAX_RETAINED_LINES`. */
	get droppedLines(): number {
		return this._dropped;
	}

	/** How many lines the output has, counting dropped lines and an unfinished last line. */
	get lineCount(): number {
		return this._dropped + this._lines.length + (this._current ? 1 : 0);
	}

	append(text: string): void {
		for (const ch of text.replace(DROPPED_CONTROL, '')) {
			if (this._pendingCarriageReturn) {
				this._pendingCarriageReturn = false;
				if (ch !== '\n') {
					this._current = '';
				}
			}
			if (ch === '\n') {
				this._pushLine();
			} else if (ch === '\r') {
				this._pendingCarriageReturn = true;
			} else if (this._current.length <= MAX_LINE_LENGTH) {
				this._current += ch;
			}
		}
	}

	/**
	 * Ends the output; an unfinished last line becomes a line. Trailing blank
	 * lines are dropped: shells and prompts write them after a command's own
	 * output, before the shell reports the command finished.
	 */
	end(): void {
		this._pushLine();
		while (this._lines.length && !this._lines[this._lines.length - 1].trim()) {
			this._lines.pop();
		}
		this._pendingCarriageReturn = false;
	}

	/**
	 * Reads up to `limit` lines starting at line `offset` (0-based, counting
	 * dropped lines). Offsets inside the dropped lines start at the first kept
	 * line.
	 */
	read(offset: number, limit: number): { offset: number; lines: string[] } {
		const start = Math.max(offset, this._dropped);
		const all = this._current ? [...this._lines, this._current] : this._lines;
		const lines = all.slice(start - this._dropped, start - this._dropped + limit).map(truncateLine);
		return { offset: start, lines };
	}

	private _pushLine(): void {
		this._lines.push(this._current);
		this._current = '';
		// Drop in batches so a long stream doesn't shift the array on every line.
		const excess = this._lines.length - MAX_RETAINED_LINES;
		if (excess >= DROP_BATCH) {
			this._lines.splice(0, excess);
			this._dropped += excess;
		}
	}
}

function truncateLine(line: string): string {
	return line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + TRUNCATED_MARKER : line;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reads a V8 heap snapshot off disk without ever holding it as one JS string.
 *
 * A busy extension host produces a snapshot past V8's 512 MB maximum string
 * length, where `JSON.parse(readFileSync(path, 'utf8'))` throws
 * "Cannot create a string longer than 0x1fffffe8 characters" before the parse
 * begins. That is a limit on a single string, so more heap does not lift it.
 *
 * Instead: find each top-level member's byte range in the Buffer, JSON-parse
 * only the small `snapshot` metadata, and read the large numeric arrays
 * straight out of the bytes.
 */

import { readFileSync } from 'fs';
import { HeapSnapshotJson } from './heap-attribute.js';

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const COLON = 0x3a;
const MINUS = 0x2d;
const ZERO = 0x30;
const NINE = 0x39;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const SPACE = 0x20;

/** Members the attribution needs. `strings` is never read: nothing uses it. */
const REQUIRED_MEMBERS = ['snapshot', 'nodes', 'edges'];

/** Index just past the closing quote of the string starting at `start`. */
function skipString(buffer: Buffer, start: number): number {
	for (let i = start + 1; i < buffer.length; i++) {
		if (buffer[i] === BACKSLASH) { i++; continue; }
		if (buffer[i] === QUOTE) { return i + 1; }
	}
	throw new Error('heap snapshot ended inside a string');
}

/** Index just past the JSON value starting at `start`. */
function skipValue(buffer: Buffer, start: number): number {
	const first = buffer[start];
	if (first === QUOTE) {
		return skipString(buffer, start);
	}
	if (first === OPEN_BRACE || first === OPEN_BRACKET) {
		// Counting only this bracket's own pair is enough: JSON cannot close an
		// object with `]`, so an inner array of a different kind never interferes.
		const close = first === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET;
		let depth = 0;
		for (let i = start; i < buffer.length; i++) {
			const byte = buffer[i];
			if (byte === QUOTE) { i = skipString(buffer, i) - 1; continue; }
			if (byte === first) { depth++; } else if (byte === close) {
				depth--;
				if (depth === 0) { return i + 1; }
			}
		}
		throw new Error('heap snapshot ended inside a nested value');
	}
	// A number, true, false or null: runs to the next structural delimiter.
	let i = start;
	while (i < buffer.length && buffer[i] !== COMMA && buffer[i] !== CLOSE_BRACE && buffer[i] !== CLOSE_BRACKET) { i++; }
	return i;
}

/** Byte range [start, end) of each top-level member's value, by key. */
function topLevelMembers(buffer: Buffer): Map<string, [number, number]> {
	const members = new Map<string, [number, number]>();
	let i = 0;
	while (i < buffer.length && buffer[i] !== OPEN_BRACE) { i++; }
	if (i === buffer.length) {
		throw new Error('heap snapshot is not a JSON object');
	}
	i++;
	while (i < buffer.length) {
		while (i < buffer.length && buffer[i] !== QUOTE && buffer[i] !== CLOSE_BRACE) { i++; }
		if (i >= buffer.length || buffer[i] === CLOSE_BRACE) { break; }
		const keyEnd = skipString(buffer, i);
		const key = buffer.toString('utf8', i + 1, keyEnd - 1);
		i = keyEnd;
		while (i < buffer.length && buffer[i] !== COLON) { i++; }
		i++;
		while (i < buffer.length && buffer[i] <= SPACE) { i++; }
		const valueEnd = skipValue(buffer, i);
		members.set(key, [i, valueEnd]);
		i = valueEnd;
	}
	return members;
}

/**
 * Reads a flat JSON array of integers into a typed array.
 *
 * Counted first and filled second so the result is allocated once at its exact
 * size, rather than growing an array of tens of millions of elements.
 */
function readNumberArray(buffer: Buffer, start: number, end: number): Float64Array {
	let count = 0;
	for (let i = start; i < end; i++) {
		if (buffer[i] >= ZERO && buffer[i] <= NINE) {
			count++;
			while (i < end && buffer[i] >= ZERO && buffer[i] <= NINE) { i++; }
		}
	}
	const values = new Float64Array(count);
	let next = 0;
	for (let i = start; i < end; i++) {
		const byte = buffer[i];
		if (byte !== MINUS && (byte < ZERO || byte > NINE)) { continue; }
		const negative = byte === MINUS;
		if (negative) { i++; }
		let value = 0;
		while (i < end && buffer[i] >= ZERO && buffer[i] <= NINE) {
			value = value * 10 + (buffer[i] - ZERO);
			i++;
		}
		values[next++] = negative ? -value : value;
		i--;
	}
	return values;
}

/** Parses the heap snapshot at `path` into the subset attribution reads. */
export function readHeapSnapshot(path: string): HeapSnapshotJson {
	const buffer = readFileSync(path);
	const members = topLevelMembers(buffer);

	const missing = REQUIRED_MEMBERS.filter(key => !members.has(key));
	if (missing.length > 0) {
		throw new Error(`heap snapshot is missing ${missing.join(', ')}`);
	}

	const [metaStart, metaEnd] = members.get('snapshot')!;
	const [nodesStart, nodesEnd] = members.get('nodes')!;
	const [edgesStart, edgesEnd] = members.get('edges')!;
	const locations = members.get('locations');

	return {
		// Kilobytes of metadata, so a plain parse is safe here and nowhere else.
		snapshot: JSON.parse(buffer.toString('utf8', metaStart, metaEnd)),
		nodes: readNumberArray(buffer, nodesStart, nodesEnd),
		edges: readNumberArray(buffer, edgesStart, edgesEnd),
		locations: locations ? readNumberArray(buffer, locations[0], locations[1]) : undefined
	};
}

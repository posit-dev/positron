/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Keep this module free of `vscode` imports, direct or indirect, so Vitest can
// load it.

import { MAX_LINE_LENGTH, removeEscapes, TRUNCATED_MARKER } from './appOutput';

/** Traceback frames kept from the start and the end of a long traceback. */
const ERROR_HEAD_FRAMES = 10;
const ERROR_TAIL_FRAMES = 40;

/** The error that ended a console app's execution. Shaped like the console history's. */
export interface AppError {
	readonly name: string;
	readonly message: string;
	readonly traceback: readonly string[];
}

/**
 * The error that ended a console execution, as an agent reads it. The runtime's
 * error arrives as a plain object whose `stack` is its traceback; an `Error` is
 * from failing to run the code at all, and its JavaScript stack would be noise.
 */
export function toAppError(error: unknown): AppError {
	if (error instanceof Error) {
		return { name: error.name, message: error.message, traceback: [] };
	}
	const { name, message, stack } = (error ?? {}) as { name?: unknown; message?: unknown; stack?: unknown };
	return {
		name: typeof name === 'string' ? name : 'Error',
		message: typeof message === 'string' ? message : String(error),
		traceback: typeof stack === 'string' && stack ? stack.split('\n') : [],
	};
}

/**
 * An `AppError` as it's kept: its traceback split around the frames left out,
 * so a read can leave out more to fit.
 */
export interface KeptError {
	readonly name: string;
	readonly message: string;
	readonly head: readonly string[];
	readonly tail: readonly string[];
	readonly omitted: number;
}

/** Cut text at `MAX_LINE_LENGTH`, as `AppOutput` cuts lines. */
function cut(text: string): string {
	return text.length > MAX_LINE_LENGTH ? text.slice(0, MAX_LINE_LENGTH) + TRUNCATED_MARKER : text;
}

/** An error to keep: escapes stripped, and its message and traceback bounded. */
export function keepError(error: AppError): KeptError {
	const frames = error.traceback.map(frame => cut(removeEscapes(frame)));
	const head = frames.slice(0, ERROR_HEAD_FRAMES);
	const tail = frames.slice(ERROR_HEAD_FRAMES).slice(-ERROR_TAIL_FRAMES);
	return {
		name: cut(removeEscapes(error.name)),
		message: cut(removeEscapes(error.message)),
		head,
		tail,
		omitted: frames.length - head.length - tail.length,
	};
}

/**
 * A kept error as an agent reads it, keeping only `headCount` frames from the
 * start and `tailCount` from the end, and saying how many were left out.
 */
function fromKeptError(error: KeptError, headCount = error.head.length, tailCount = error.tail.length): AppError {
	const omitted = error.omitted + error.head.length - headCount + error.tail.length - tailCount;
	return {
		name: error.name,
		message: error.message,
		traceback: [
			...error.head.slice(0, headCount),
			...omitted ? [`[${omitted} frames left out]`] : [],
			...error.tail.slice(error.tail.length - tailCount),
		],
	};
}

/** A kept error that fits in `budget` characters, serialized, leaving out frames from the middle. */
export function fitError(error: KeptError, budget: number): AppError {
	let headCount = error.head.length;
	let tailCount = error.tail.length;
	let fitted = fromKeptError(error);
	while (JSON.stringify(fitted).length > budget && headCount + tailCount > 0) {
		// Drop from whichever end has more than its share, keeping the
		// ratio of frames from the start to frames from the end.
		if (tailCount * ERROR_HEAD_FRAMES >= headCount * ERROR_TAIL_FRAMES) {
			tailCount--;
		} else {
			headCount--;
		}
		fitted = fromKeptError(error, headCount, tailCount);
	}
	return fitted;
}

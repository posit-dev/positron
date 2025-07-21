/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../lifecycle.js';

export function getFirstStackFrameOutsideOf(stack: string, pattern?: RegExp): ILocation | undefined {
	const lines = stack.split('\n');

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];

		if (pattern && pattern.test(line)) {
			continue;
		}

		const showFramesUpMatch = line.match(/\$show(\d+)FramesUp/);
		if (showFramesUpMatch) {
			const n = parseInt(showFramesUpMatch[1], 10);
			i += (n - 1);
			continue;
		}

		const result = parseLine(line);
		if (result) {
			return result;
		}
	}

	return undefined;
}

export interface ILocation {
	fileName: string;
	line: number;
	column: number;
	id: string;
}

function parseLine(stackLine: string): ILocation | undefined {
	const match = stackLine.match(/\((.*):(\d+):(\d+)\)/);
	if (match) {
		return {
			fileName: match[1],
			line: parseInt(match[2]),
			column: parseInt(match[3]),
			id: stackLine,
		};
	}

	const match2 = stackLine.match(/at ([^\(\)]*):(\d+):(\d+)/);

	if (match2) {
		return {
			fileName: match2[1],
			line: parseInt(match2[2]),
			column: parseInt(match2[3]),
			id: stackLine,
		};
	}

	return undefined;
}

export class Debouncer implements IDisposable {
	private _timeout: Timeout | undefined = undefined;

	public debounce(fn: () => void, timeoutMs: number): void {
		if (this._timeout !== undefined) {
			clearTimeout(this._timeout);
		}
		this._timeout = setTimeout(() => {
			this._timeout = undefined;
			fn();
		}, timeoutMs);
	}

	dispose(): void {
		if (this._timeout !== undefined) {
			clearTimeout(this._timeout);
		}
	}
}

export class Throttler implements IDisposable {
	private _timeout: Timeout | undefined = undefined;

	public throttle(fn: () => void, timeoutMs: number): void {
		if (this._timeout === undefined) {
			this._timeout = setTimeout(() => {
				this._timeout = undefined;
				fn();
			}, timeoutMs);
		}
	}

	dispose(): void {
		if (this._timeout !== undefined) {
			clearTimeout(this._timeout);
		}
	}
}

export function deepAssign<T>(target: T, source: T): void {
	for (const key in source) {
		if (!!target[key] && typeof target[key] === 'object' && !!source[key] && typeof source[key] === 'object') {
			deepAssign(target[key], source[key]);
		} else {
			target[key] = source[key];
		}
	}
}

export function deepAssignDeleteNulls<T>(target: T, source: T): void {
	for (const key in source) {
		if (source[key] === null) {
			delete target[key];
		} else if (!!target[key] && typeof target[key] === 'object' && !!source[key] && typeof source[key] === 'object') {
			deepAssignDeleteNulls(target[key], source[key]);
		} else {
			target[key] = source[key];
		}
	}
}

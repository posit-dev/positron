/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';

export class PromiseHandles<T> {
	resolve!: (value: T | Promise<T>) => void;
	reject!: (error: unknown) => void;
	promise: Promise<T>;

	constructor() {
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}


export function readLines(pth: string): Array<string> {
	const bigString = fs.readFileSync(pth, 'utf8');
	return bigString.split(/\r?\n/);
}

// extractValue('KEY=VALUE', 'KEY')      --> 'VALUE'
// extractValue('KEY:VALUE', 'KEY', ':') --> 'VALUE'
// extractValue('KEE:VALUE', 'KEY')      --> ''
export function extractValue(str: string, key: string, delim: string = '='): string {
	const re = `${key}${delim}(.*)`;
	if (!str.startsWith(key)) {
		return '';
	}
	const m = str.match(re);
	return m?.[1] ?? '';
}

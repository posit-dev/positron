/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * A promise with exposed and imperatively callable resolve and reject methods.
 */
export class DeferredPromise<T> {
	complete!: (value: T) => void;
	error!: (error: unknown) => void;
	isSettled: boolean = false;
	p: Promise<T>;
	value: T | undefined;

	constructor() {
		this.p = new Promise((resolve, reject) => {
			this.complete = (val) => {
				this.isSettled = true;
				this.value = val;
				resolve(val);
			};
			this.error = (reason) => {
				this.isSettled = true;
				reject(reason);
			};
		});
	}
}

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

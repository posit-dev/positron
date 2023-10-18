/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function noop() { }

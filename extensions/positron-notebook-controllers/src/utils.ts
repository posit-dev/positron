/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatCount(count: number, unit: string): string {
	if (count === 1) {
		return `${count} ${unit}`;
	}
	return `${count} ${unit}s`;
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shape of the arg passed to `positronNotebook.cell.copyOutputJson` to target
 * a specific JSON output.
 */
export interface CopyJsonMenuArg {
	jsonText: string;
}

export function isCopyJsonMenuArg(arg: unknown): arg is CopyJsonMenuArg {
	return typeof arg === 'object' && arg !== null && typeof (arg as CopyJsonMenuArg).jsonText === 'string';
}

export function serializeJsonOutput(data: unknown): string {
	return JSON.stringify(data, null, 2) ?? String(data);
}

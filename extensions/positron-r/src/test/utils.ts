/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

export function createUniqueId(): string {
	return Math.floor(Math.random() * 0x100000000).toString(16);
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { LANGUAGE_ORDER_KEY } from '../../../services/languageRuntime/common/languageOrder.js';

// List settings that always show every allowed value, so the user only reorders them.
const REORDER_ONLY_SETTINGS = new Set([LANGUAGE_ORDER_KEY]);

export function isReorderOnlyList(key: string): boolean {
	return REORDER_ONLY_SETTINGS.has(key);
}

/**
 * Appends allowed values missing from the saved list, in allowed order, so a newly
 * installed language shows up as a row. Other settings are returned unchanged.
 */
export function withMissingValues(key: string, allowed: readonly string[] | undefined, value: readonly string[]): string[] {
	if (!isReorderOnlyList(key) || !allowed) {
		return [...value];
	}
	return [...value, ...allowed.filter(v => !value.includes(v))];
}

/** The rows to show: each value from `withMissingValues`, labeled from `allowedLabels` or else by itself. */
export function reorderRows(key: string, allowed: readonly string[] | undefined, allowedLabels: readonly string[] | undefined, value: readonly string[]): { value: string; label: string }[] {
	return withMissingValues(key, allowed, value).map(v => ({
		value: v,
		label: allowedLabels?.[allowed?.indexOf(v) ?? -1] ?? v,
	}));
}

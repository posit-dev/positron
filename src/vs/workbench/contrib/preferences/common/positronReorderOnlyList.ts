/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { LANGUAGE_ORDER_KEY } from '../../../services/languageRuntime/common/languageOrder.js';
import { getInstalledLanguageIds } from '../../../services/languageRuntime/common/languageOrderConfiguration.js';

// List settings the user only reorders, each with the values every scope's list shows.
const REORDER_ONLY_SETTINGS = new Map<string, () => readonly string[]>([[LANGUAGE_ORDER_KEY, getInstalledLanguageIds]]);

export function isReorderOnlyList(key: string): boolean {
	return REORDER_ONLY_SETTINGS.has(key);
}

/** Values to add when a scope's saved value leaves them out. Other allowed values show only where saved. */
export function reorderListDefaults(key: string): readonly string[] {
	return REORDER_ONLY_SETTINGS.get(key)?.() ?? [];
}

/**
 * The rows to show: the saved values, then any of `defaults` missing from them (so a newly
 * installed language shows up). Each is labeled from `allowedLabels`, or else by itself.
 */
export function reorderRows(allowed: readonly string[] | undefined, allowedLabels: readonly string[] | undefined, defaults: readonly string[], value: readonly string[]): { value: string; label: string }[] {
	const missing = defaults.filter(v => !value.includes(v));
	return [...value, ...missing].map(v => ({
		value: v,
		label: allowedLabels?.[allowed?.indexOf(v) ?? -1] ?? v,
	}));
}

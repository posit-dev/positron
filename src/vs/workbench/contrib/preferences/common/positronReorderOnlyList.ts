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
 * The rows to show: the saved values, then any allowed values missing from them (so a
 * newly installed language shows up). Each is labeled from `allowedLabels`, or else by itself.
 */
export function reorderRows(allowed: readonly string[] | undefined, allowedLabels: readonly string[] | undefined, value: readonly string[]): { value: string; label: string }[] {
	const missing = allowed?.filter(v => !value.includes(v)) ?? [];
	return [...value, ...missing].map(v => ({
		value: v,
		label: allowedLabels?.[allowed?.indexOf(v) ?? -1] ?? v,
	}));
}

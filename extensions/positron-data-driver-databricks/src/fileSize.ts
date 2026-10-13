/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This file is copied, unchanged, into each data driver that lists files (Databricks volumes,
// Snowflake stages), because an extension can't import from another. fileSize-copies.vitest.ts keeps
// the copies identical, so a file's size reads the same in every driver's tree.

/** Formats a byte count for display next to a file name, e.g. "1.5 MB". */
export function formatFileSize(bytes: number): string {
	if (!isFinite(bytes) || bytes < 0) {
		return '';
	}
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	// Whole bytes need no decimal; every larger unit reads better with one.
	return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

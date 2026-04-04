/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal stub for the git extension API used by vitest tests that transitively
 * depend on extension code importing from '../../git/src/api/git.js'.
 * The imports are type-only so this module only needs to export empty values.
 */

export const Status = {
	INDEX_MODIFIED: 0,
	INDEX_ADDED: 1,
	INDEX_DELETED: 2,
	INDEX_RENAMED: 3,
	INDEX_COPIED: 4,
	MODIFIED: 5,
	DELETED: 6,
	UNTRACKED: 7,
	IGNORED: 8,
	INTENT_TO_ADD: 9,
	ADDED_BY_US: 10,
	ADDED_BY_THEM: 11,
	DELETED_BY_US: 12,
	DELETED_BY_THEM: 13,
	BOTH_ADDED: 14,
	BOTH_DELETED: 15,
	BOTH_MODIFIED: 16,
} as const;

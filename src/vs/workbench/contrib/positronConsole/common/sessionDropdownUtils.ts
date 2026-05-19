/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeMetadata } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * Builds the ordered list of runtime metadata for the console session dropdown.
 *
 * The foreground runtime is placed first (enabling +Enter to clone the active
 * session). Remaining sessions are sorted by most-recently-used, deduplicated
 * by runtimeId, and capped at 5 total entries.
 */
export function buildRuntimesDropdown(
	foregroundRuntime: ILanguageRuntimeMetadata | undefined,
	activeSessions: ILanguageRuntimeSession[]
): ILanguageRuntimeMetadata[] {
	// Sort by lastUsed descending, map to metadata, deduplicate by runtimeId
	// (excluding the foreground runtime so it can be prepended separately).
	const runtimes = [...activeSessions]
		.sort((a, b) => b.lastUsed - a.lastUsed)
		.map(session => session.runtimeMetadata)
		.filter((runtime, index, arr) =>
			runtime.runtimeId !== foregroundRuntime?.runtimeId &&
			arr.findIndex(r => r.runtimeId === runtime.runtimeId) === index
		);

	// Prepend the foreground runtime so +Enter clones the active session.
	if (foregroundRuntime) {
		runtimes.unshift(foregroundRuntime);
	}

	// Cap at 5 to avoid cluttering the dropdown.
	return runtimes.slice(0, 5);
}
